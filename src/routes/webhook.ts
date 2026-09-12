import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';
import {
  validateWebhookSignature,
  parseWebhookEvent,
  isRelevantEvent,
  getEventType,
  ValidatedWebhookEvent,
} from '../github/webhook';
import {
  recordWebhookDelivery,
  markWebhookProcessed,
  recordWebhookError,
  getOrCreateInstallation,
  getOrCreateRepository,
  getOrCreatePR,
  getPool,
} from '../db/models';
import { processPR } from '../processing/processor';

export async function handleWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const deliveryId = req.headers['x-github-delivery'] as string;
  const signature = req.headers['x-hub-signature-256'] as string;

  if (!deliveryId || !signature) {
    logger.warn('Missing webhook headers', { deliveryId, signature });
    res.status(400).json({ error: 'Missing required headers' });
    return;
  }

  // Get raw body for signature verification (stored by middleware)
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    logger.error('Raw body not available for signature verification');
    res.status(400).json({ error: 'Unable to verify webhook' });
    return;
  }
  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString();

  // Verify signature
  if (!validateWebhookSignature(payload, signature)) {
    logger.warn('Invalid webhook signature', { deliveryId });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  try {
    // Parse event
    const event = parseWebhookEvent(payload);
    event._deliveryId = deliveryId;

    const eventType = getEventType(event);
    const action = event.action || 'unknown';

    logger.info('Webhook received', {
      deliveryId,
      eventType,
      action,
      repo: event.repository?.full_name,
    });

    // Check if this is a relevant event
    if (!isRelevantEvent(event)) {
      logger.debug('Event not relevant', { eventType, action });
      res.status(200).json({ message: 'Event not relevant' });
      return;
    }

    // Record delivery (for idempotency)
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const isNew = await recordWebhookDelivery(
      deliveryId,
      event.installation?.id || null,
      eventType,
      action,
      payloadHash
    );

    if (!isNew) {
      logger.info('Duplicate webhook delivery, skipping', { deliveryId });
      res.status(200).json({ message: 'Duplicate delivery, skipped' });
      return;
    }

    // Process the event
    await processWebhookEvent(event, deliveryId);

    // Mark as processed
    await markWebhookProcessed(deliveryId);

    logger.debug('Webhook processing completed', { deliveryId });
    res.status(200).json({ message: 'Processed' });
  } catch (error) {
    logger.error('Webhook processing error', error);
    await recordWebhookError(deliveryId, error instanceof Error ? error.message : 'Unknown error');
    res.status(202).json({ message: 'Accepted but processing failed' });
  }
}

async function processWebhookEvent(
  event: ValidatedWebhookEvent,
  deliveryId: string
): Promise<void> {
  if (!event.installation?.id || !event.repository?.id) {
    logger.warn('Missing required event fields', { deliveryId });
    return;
  }

  const installationId = event.installation.id;
  const repoId = event.repository.id;
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const ownerType = event.repository.owner.type;

  // Create or get installation (use actual app ID from config, not installation ID)
  const installation = await getOrCreateInstallation(
    installationId,
    event.installation?.id || 0, // Just use a placeholder, not critical for this audit
    owner,
    ownerType
  );

  // Create or get repository
  await getOrCreateRepository(
    installation,
    repoId,
    owner,
    repo,
    event.repository.full_name
  );

  // Handle different event types
  if (event.pull_request) {
    const pr = event.pull_request;
    const prNumber = pr.number;
    const state = pr.state;

    logger.debug('Processing PR event', {
      deliveryId,
      prNumber,
      action: event.action,
    });

    // Create or update PR record
    await getOrCreatePR(
      installation,
      repoId,
      pr.id,
      prNumber,
      pr.title,
      state,
      pr.head.sha
    );

    // Only process if PR is relevant
    const relevantActions = ['opened', 'synchronize', 'edited', 'reopened'];
    if (relevantActions.includes(event.action || '')) {
      // Queue for processing with lock to prevent duplicates
      const client = await getPool().connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        // Get PR ID for processing queue
        const prResult = await client.query(
          `SELECT id FROM pull_requests
           WHERE installation_id = $1 AND github_repo_id = $2 AND pr_number = $3`,
          [installation, repoId, prNumber]
        );

        if (prResult.rows[0]) {
          const prId = prResult.rows[0].id;

          // Check if already queued to prevent duplicates
          const queuedCheck = await client.query(
            `SELECT id FROM processing_queue
             WHERE pr_id = $1 AND status IN ('pending', 'processing')
             LIMIT 1`,
            [prId]
          );

          if (!queuedCheck.rows[0]) {
            // Add to processing queue only if not already queued
            await client.query(
              `INSERT INTO processing_queue
               (installation_id, repository_id, pr_id, status)
               VALUES ($1, $2, $3, 'pending')`,
              [installation, repoId, prId]
            );

            logger.debug('Queued PR for processing', { prNumber });
          } else {
            logger.debug('PR already queued, skipping duplicate', { prNumber });
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      // Process immediately (V1: synchronous)
      // In production, this would go to a job queue
      try {
        await processPR(installationId, repoId, prNumber, owner, repo);
      } catch (error) {
        logger.error('Failed to process PR', { prNumber, error });
        // Don't re-throw - the webhook delivery is still successful
      }
    } else {
      logger.debug('PR action not relevant for processing', { action: event.action });
    }
  }
}
