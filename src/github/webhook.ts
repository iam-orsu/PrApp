import * as crypto from 'crypto';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

interface WebhookEvent {
  action?: string;
  installation?: {
    id: number;
  };
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      type: string;
    };
  };
  pull_request?: {
    id: number;
    number: number;
    title: string;
    head: {
      sha: string;
    };
    state: string;
  };
  review?: {
    id: number;
    state: string;
  };
  push?: unknown;
}

export interface ValidatedWebhookEvent extends WebhookEvent {
  _deliveryId: string;
  _timestamp: number;
}

export function validateWebhookSignature(
  payload: string,
  signature: string
): boolean {
  if (!signature.startsWith('sha256=')) {
    logger.warn('Invalid signature format', { signature });
    return false;
  }

  const hash = crypto
    .createHmac('sha256', config.github.webhookSecret)
    .update(payload)
    .digest('hex');

  const expected = signature.slice(7); // Remove 'sha256=' prefix

  // Use timing-safe comparison to prevent timing attacks
  const hashBuffer = Buffer.from(hash);
  const expectedBuffer = Buffer.from(expected);

  if (hashBuffer.length !== expectedBuffer.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < hashBuffer.length; i++) {
    result |= hashBuffer[i] ^ expectedBuffer[i];
  }

  return result === 0;
}

export function parseWebhookEvent(payload: string): ValidatedWebhookEvent {
  const event = JSON.parse(payload) as WebhookEvent;

  return {
    ...event,
    _deliveryId: '', // Will be set by caller
    _timestamp: Date.now(),
  };
}

export function isRelevantEvent(event: WebhookEvent): boolean {
  if (!event.installation?.id) {
    logger.debug('Event missing installation ID');
    return false;
  }

  if (!event.repository?.id) {
    logger.debug('Event missing repository ID');
    return false;
  }

  // We handle these specific events
  const relevantActions = {
    pull_request: ['opened', 'synchronize', 'edited', 'reopened'],
    pull_request_review: ['submitted', 'edited'],
  };

  // Check if this looks like a PR-related event
  if (event.pull_request && event.action) {
    const prActions = relevantActions.pull_request as string[];
    return prActions.includes(event.action);
  }

  if (event.review && event.action) {
    const reviewActions = relevantActions.pull_request_review as string[];
    return reviewActions.includes(event.action);
  }

  return false;
}

export function getEventType(event: WebhookEvent): string {
  // Infer event type from payload structure
  if (event.pull_request && event.review) {
    return 'pull_request_review';
  }
  if (event.pull_request) {
    return 'pull_request';
  }
  if (event.push) {
    return 'push';
  }
  return 'unknown';
}
