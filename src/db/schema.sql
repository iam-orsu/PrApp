-- GitHub App installations
CREATE TABLE IF NOT EXISTS installations (
  id SERIAL PRIMARY KEY,
  github_installation_id BIGINT NOT NULL UNIQUE,
  github_app_id BIGINT NOT NULL,
  owner_login VARCHAR(255) NOT NULL,
  owner_type VARCHAR(20) NOT NULL, -- 'User' or 'Organization'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Repositories that have the app installed
CREATE TABLE IF NOT EXISTS repositories (
  id SERIAL PRIMARY KEY,
  installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  github_repo_id BIGINT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(511) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_repo_per_install UNIQUE(installation_id, github_repo_id)
);

-- Pull requests being tracked
CREATE TABLE IF NOT EXISTS pull_requests (
  id SERIAL PRIMARY KEY,
  installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_pr_id BIGINT NOT NULL,
  pr_number INTEGER NOT NULL,
  title VARCHAR(1024),
  state VARCHAR(20) NOT NULL, -- 'open', 'closed', 'merged'
  head_sha VARCHAR(40),
  check_run_id BIGINT,
  check_run_external_id VARCHAR(255),
  last_processed_at TIMESTAMP,
  last_processed_commit_sha VARCHAR(40),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_pr_per_repo UNIQUE(installation_id, repository_id, github_pr_id)
);

-- Webhook delivery tracking (for idempotency)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  installation_id INTEGER REFERENCES installations(id) ON DELETE CASCADE,
  github_delivery_id VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  action VARCHAR(100),
  payload_hash VARCHAR(64), -- SHA256 hash of payload for deduplication
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Processing queue for retries
CREATE TABLE IF NOT EXISTS processing_queue (
  id SERIAL PRIMARY KEY,
  installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Summary history for tracking changes
CREATE TABLE IF NOT EXISTS pr_summaries (
  id SERIAL PRIMARY KEY,
  pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  summary_html TEXT,
  processed_commits_count INTEGER,
  diff_size_bytes INTEGER,
  processing_duration_ms INTEGER,
  deepseek_model VARCHAR(100),
  deepseek_tokens_used INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_installations_github_id ON installations(github_installation_id);
CREATE INDEX IF NOT EXISTS idx_repositories_installation ON repositories(installation_id);
CREATE INDEX IF NOT EXISTS idx_repositories_github_id ON repositories(github_repo_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_installation ON pull_requests(installation_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_github_id ON pull_requests(github_pr_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_github_id ON webhook_deliveries(github_delivery_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_processed ON webhook_deliveries(processed);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_pr ON processing_queue(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_summaries_pr ON pr_summaries(pr_id);
