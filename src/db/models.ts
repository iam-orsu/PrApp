import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool;

export function initDatabase(dbUrl: string): void {
  pool = new Pool({ connectionString: dbUrl });
  logger.info('Database pool initialized');
}

export function getPool(): Pool {
  return pool;
}

// Installation management
export async function getOrCreateInstallation(
  githubInstallationId: number,
  githubAppId: number,
  ownerLogin: string,
  ownerType: string
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO installations
     (github_installation_id, github_app_id, owner_login, owner_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (github_installation_id)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [githubInstallationId, githubAppId, ownerLogin, ownerType]
  );
  return result.rows[0].id;
}

export async function getInstallation(
  githubInstallationId: number
): Promise<{ id: number } | null> {
  const result = await pool.query(
    'SELECT id FROM installations WHERE github_installation_id = $1',
    [githubInstallationId]
  );
  return result.rows[0] || null;
}

// Repository management
export async function getOrCreateRepository(
  installationId: number,
  githubRepoId: number,
  owner: string,
  name: string,
  fullName: string
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO repositories
     (installation_id, github_repo_id, owner, name, full_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (installation_id, github_repo_id)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [installationId, githubRepoId, owner, name, fullName]
  );
  return result.rows[0].id;
}

export async function getRepository(
  installationId: number,
  githubRepoId: number
): Promise<{ id: number } | null> {
  const result = await pool.query(
    'SELECT id FROM repositories WHERE installation_id = $1 AND github_repo_id = $2',
    [installationId, githubRepoId]
  );
  return result.rows[0] || null;
}

// PR management
export async function getOrCreatePR(
  installationId: number,
  repositoryId: number,
  githubPrId: number,
  prNumber: number,
  title: string,
  state: string,
  headSha: string
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO pull_requests
     (installation_id, repository_id, github_pr_id, pr_number, title, state, head_sha)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (installation_id, repository_id, github_pr_id)
     DO UPDATE SET
       state = $6,
       head_sha = $7,
       title = $5,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [installationId, repositoryId, githubPrId, prNumber, title, state, headSha]
  );
  return result.rows[0].id;
}

export async function getPR(
  installationId: number,
  repositoryId: number,
  prNumber: number
): Promise<{
  id: number;
  check_run_id: number | null;
  last_processed_commit_sha: string | null;
  state: string;
} | null> {
  const result = await pool.query(
    `SELECT id, check_run_id, last_processed_commit_sha, state
     FROM pull_requests
     WHERE installation_id = $1 AND repository_id = $2 AND pr_number = $3`,
    [installationId, repositoryId, prNumber]
  );
  return result.rows[0] || null;
}

// Webhook delivery tracking (for idempotency)
export async function recordWebhookDelivery(
  deliveryId: string,
  installationId: number | null,
  eventType: string,
  action: string | undefined,
  payloadHash: string
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO webhook_deliveries
       (github_delivery_id, installation_id, event_type, action, payload_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [deliveryId, installationId, eventType, action, payloadHash]
    );
    return true;
  } catch (error: any) {
    if (error.code === '23505') {
      // Unique constraint violation - delivery already processed
      logger.debug('Webhook delivery already recorded', { deliveryId });
      return false;
    }
    throw error;
  }
}

export async function markWebhookProcessed(
  deliveryId: string
): Promise<void> {
  await pool.query(
    `UPDATE webhook_deliveries
     SET processed = true, processed_at = CURRENT_TIMESTAMP
     WHERE github_delivery_id = $1`,
    [deliveryId]
  );
}

export async function recordWebhookError(
  deliveryId: string,
  error: string
): Promise<void> {
  await pool.query(
    `UPDATE webhook_deliveries
     SET error_message = $1
     WHERE github_delivery_id = $2`,
    [error, deliveryId]
  );
}

// Check run tracking
export async function updateCheckRunId(
  prId: number,
  checkRunId: number,
  externalId: string
): Promise<void> {
  await pool.query(
    `UPDATE pull_requests
     SET check_run_id = $1, check_run_external_id = $2
     WHERE id = $3`,
    [checkRunId, externalId, prId]
  );
}

// Summary storage
export async function storeSummary(
  prId: number,
  summaryText: string,
  summaryHtml: string | null,
  processedCommitsCount: number,
  diffSizeBytes: number,
  processingDurationMs: number,
  deepseekModel: string,
  deepseekTokensUsed: number
): Promise<void> {
  await pool.query(
    `INSERT INTO pr_summaries
     (pr_id, summary_text, summary_html, processed_commits_count, diff_size_bytes,
      processing_duration_ms, deepseek_model, deepseek_tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      prId,
      summaryText,
      summaryHtml,
      processedCommitsCount,
      diffSizeBytes,
      processingDurationMs,
      deepseekModel,
      deepseekTokensUsed,
    ]
  );
}

// Processing queue
export async function isProcessingInProgress(prId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM processing_queue
     WHERE pr_id = $1 AND status = 'processing'
     LIMIT 1`,
    [prId]
  );
  return result.rows.length > 0;
}

export async function getQueuedJob(
  installationId: number
): Promise<{
  id: number;
  pr_id: number;
  repository_id: number;
} | null> {
  const result = await pool.query(
    `SELECT id, pr_id, repository_id FROM processing_queue
     WHERE installation_id = $1 AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [installationId]
  );
  return result.rows[0] || null;
}

export async function markJobProcessing(jobId: number): Promise<void> {
  await pool.query(
    `UPDATE processing_queue
     SET status = 'processing', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [jobId]
  );
}

export async function markJobCompleted(jobId: number): Promise<void> {
  await pool.query(
    `UPDATE processing_queue
     SET status = 'completed', updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [jobId]
  );
}

export async function markJobFailed(
  jobId: number,
  error: string,
  retryCount: number,
  maxRetries: number
): Promise<void> {
  const newStatus = retryCount < maxRetries ? 'pending' : 'failed';
  await pool.query(
    `UPDATE processing_queue
     SET status = $1, error_message = $2, retry_count = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [newStatus, error, retryCount + 1, jobId]
  );
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed');
}
