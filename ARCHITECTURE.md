# PR Summary GitHub App - Architecture

## System Overview

```
┌─────────────────┐
│   GitHub        │
│  Repositories   │
└────────┬────────┘
         │ Webhook Events
         │ (pull_request, pull_request_review)
         │
         ▼
┌─────────────────────────────────────────────────────┐
│           HTTPS (Let's Encrypt)                     │
│  https://your-domain.com/webhook                    │
└────────┬────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│   Nginx (Reverse Proxy)                  │
│   - TLS/SSL termination                  │
│   - Load balancing                       │
│   - Rate limiting                        │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│   Node.js Express Application            │
│   ├─ Webhook Handler                     │
│   ├─ GitHub API Integration              │
│   ├─ PR Processing Pipeline              │
│   ├─ Health Checks                       │
│   └─ Logging/Monitoring                  │
└────────┬─────────────────────────────────┘
         │
         ├──────────────────────┬──────────────────────┐
         ▼                      ▼                      ▼
    ┌─────────┐         ┌──────────────┐       ┌────────────┐
    │PostgreSQL         │ DeepSeek API │       │GitHub API  │
    │Database │         │ (Summarizer) │       │(Data Fetch)│
    └─────────┘         └──────────────┘       └────────────┘
```

## Component Architecture

### 1. GitHub Webhook Layer

**File**: `src/github/webhook.ts`

```typescript
Input:  HTTP POST request with signature header
        ├─ X-GitHub-Delivery (unique ID)
        ├─ X-Hub-Signature-256 (HMAC-SHA256)
        └─ JSON payload

Process:
  1. Validate HMAC signature (prevent tampering)
  2. Parse webhook JSON
  3. Check if event type is relevant
  4. Check for duplicate delivery (idempotency)
  5. Extract installation/repository/PR info

Output: ValidatedWebhookEvent object
```

### 2. Webhook Handler & Routing

**File**: `src/routes/webhook.ts`

```
Handles:
  ├─ pull_request.opened
  ├─ pull_request.synchronize
  ├─ pull_request.edited
  ├─ pull_request.reopened
  └─ pull_request_review.submitted

For each relevant event:
  1. Record delivery ID (prevents duplicate processing)
  2. Create/update installation record
  3. Create/update repository record
  4. Create/update PR record
  5. Queue for processing
  6. (V1: Process immediately)
```

### 3. GitHub Authentication

**File**: `src/github/auth.ts`

```
OAuth Flow:
  GitHub App → RSA Private Key → JWT (10 min expiry)
              ↓
         POST /app/installations/{id}/access_tokens
              ↓
         Installation Access Token (1 hour expiry)
              ↓
         Cached for reuse within installation

Key Features:
  - Token caching (avoid excessive generation)
  - Automatic expiration handling
  - Timing-safe comparison for security
```

### 4. GitHub API Integration

**File**: `src/github/api.ts`

```
APIs Called:
  ├─ GET /repos/{owner}/{repo}/pulls/{pr_number}
  │  └─ PR metadata, state, title, description
  │
  ├─ GET /repos/{owner}/{repo}/pulls/{pr_number}/commits
  │  └─ All commits (max 250)
  │
  ├─ GET /repos/{owner}/{repo}/pulls/{pr_number}/files
  │  └─ Files and diffs (max 3000 files)
  │
  ├─ GET /repos/{owner}/{repo}/pulls/{pr_number}/reviews
  │  └─ Reviews and review state
  │
  ├─ GET /repos/{owner}/{repo}/issues/{pr_number}/comments
  │  └─ PR conversation comments
  │
  ├─ POST /repos/{owner}/{repo}/check-runs
  │  └─ Create new Check Run
  │
  └─ PATCH /repos/{owner}/{repo}/check-runs/{id}
     └─ Update existing Check Run

Rate Limiting:
  - 5,000 req/hour per installation token
  - Exponential backoff on 429 responses
  - Token caching to reduce API calls
```

### 5. PR Processing Pipeline

**File**: `src/processing/processor.ts`

```
Process Flow:
  1. Verify installation exists
  2. Verify repository exists
  3. Collect PR context:
     ├─ Basic PR data
     ├─ All commits
     ├─ All files and diffs
     ├─ Reviews
     └─ Comments
  
  4. Build AI prompt with:
     ├─ Full PR information
     ├─ Commit messages
     ├─ Relevant diffs (truncated if needed)
     ├─ Reviews and feedback
     └─ Discussion context
  
  5. Call DeepSeek API
  
  6. Create or Update Check Run:
     ├─ Status: completed
     ├─ Conclusion: neutral
     └─ Output: AI summary
  
  7. Store summary in database
  8. Update PR last_processed_commit_sha

Error Handling:
  - If GitHub API fails → Exponential backoff
  - If DeepSeek fails → Graceful degradation (record error, don't block PR)
  - If database fails → Unprocessed delivery stays queued
```

### 6. AI Processing Layer

**File**: `src/ai/deepseek.ts`

```
Prompt Engineering:
  System Prompt:
    - Define role as PR analyzer
    - Strong constraints against hallucination
    - Require grounding in provided data
    - Format specification
  
  Context Building:
    - PR title, description
    - Commit messages (all of them)
    - File names and change counts
    - Diffs (truncated intelligently):
      * Include diffs for small files
      * Truncate large files
      * Skip if total exceeds MAX_DIFF_SIZE
    - Reviews (if any)
    - Comments (recent ones)
  
  API Call:
    - Model: deepseek-chat
    - Temperature: 0.7 (some creativity for readability)
    - Max tokens: 2000
    - Timeout: 60s

Output:
  - Markdown-formatted summary
  - Token usage for logging
  - Structured for Check Run output
```

### 7. Database Layer

**File**: `src/db/models.ts` + `src/db/schema.sql`

```
Tables:
  ├─ installations
  │  └─ Track GitHub App installations per org/user
  │
  ├─ repositories
  │  └─ Track which repos have the app
  │
  ├─ pull_requests
  │  ├─ PR metadata
  │  ├─ Current state
  │  ├─ Check Run ID (for updates)
  │  └─ Last processed commit SHA (for idempotency)
  │
  ├─ webhook_deliveries
  │  ├─ GitHub delivery ID (prevents duplicates)
  │  ├─ Payload hash (deduplication)
  │  ├─ Processing status
  │  └─ Errors for retry
  │
  ├─ processing_queue
  │  ├─ PR to process
  │  ├─ Status (pending, processing, completed, failed)
  │  ├─ Retry count/tracking
  │  └─ (V2: Async job queue)
  │
  └─ pr_summaries
     ├─ Full summary text
     ├─ Processing metadata
     ├─ Tokens used
     └─ Timestamps

Key Constraints:
  - installation_id + repo_id + pr_number = unique
  - github_delivery_id = unique (prevents duplicates)
  - Indexes on all foreign keys and common queries
```

### 8. Express Server & Health Checks

**File**: `src/index.ts`

```
Endpoints:
  ├─ POST /webhook
  │  └─ Webhook event handler
  │
  ├─ GET /health
  │  └─ Health check (returns 200 + status JSON)
  │
  └─ 404 handler for unknown routes

Middleware:
  ├─ express.json() - Parse JSON bodies
  ├─ express.raw() - Preserve raw body for signature verification
  ├─ Error handling - Structured error responses

Health Check:
  - Database connectivity
  - DeepSeek API connectivity
  - GitHub API connectivity
  (V2: More detailed health metrics)
```

## Data Flow Examples

### Happy Path: PR Created

```
1. Developer creates PR on GitHub
   ↓
2. GitHub sends webhook: pull_request.opened
   ↓
3. App receives webhook
   ├─ Validates signature
   ├─ Checks for duplicate delivery (not a duplicate)
   ├─ Creates installation + repo + PR records
   └─ Queues PR for processing
   ↓
4. PR Processing:
   ├─ Fetch PR data, commits, files, reviews, comments
   ├─ Build context with diffs
   ├─ Send to DeepSeek
   ├─ Create Check Run with summary
   └─ Store summary in database
   ↓
5. Developer sees Check Run on GitHub
   └─ Clicks to view full summary
```

### Edge Case: Rapid Commits

```
1. Developer pushes 3 commits rapidly
   ↓
2. Webhook 1: pull_request.synchronize (commit 1)
   └─ Creates Check Run with summary
   ↓
3. Webhook 2: pull_request.synchronize (commit 2)
   ├─ Database lock prevents concurrent processing
   ├─ Waits for Webhook 1 to complete
   └─ Updates existing Check Run (not new comment)
   ↓
4. Webhook 3: pull_request.synchronize (commit 3)
   ├─ Waits for Webhook 2
   └─ Updates Check Run again
   ↓
Result: One evolving summary, not 3 separate comments
```

### Edge Case: Duplicate Webhook

```
1. Webhook sent to app (delivery ID: abc123)
   ├─ Recorded in database
   └─ Processed normally
   ↓
2. GitHub retries same webhook (same delivery ID: abc123)
   ├─ App looks up delivery ID in database
   ├─ Finds it's already recorded
   ├─ Returns 200 OK without processing
   └─ GitHub considers delivery successful
   ↓
Result: No duplicate processing, no duplicate summaries
```

### Edge Case: DeepSeek Fails

```
1. Webhook received, context collected
   ↓
2. DeepSeek API times out/rate-limits
   ├─ Exception caught in processor
   ├─ Error logged with context
   └─ Delivery marked as processed (with error)
   ↓
3. Check Run created with error state:
   ├─ Status: completed
   ├─ Conclusion: neutral
   └─ Output: "Summary temporarily unavailable..."
   ↓
4. PR still works normally
   └─ Developer can review and merge
```

## Security Architecture

### Authentication

```
GitHub App → Private Key → JWT (10 min)
            ↓
        Installation Token → API calls
                           └─ 1 hour expiry
                           └─ Per-installation scope
```

### Webhook Security

```
GitHub sends:
  ├─ Payload
  └─ X-Hub-Signature-256: sha256={HMAC-SHA256(secret, payload)}

App verifies:
  ├─ HMAC matches (timing-safe comparison)
  ├─ Payload hasn't been tampered with
  └─ Request came from GitHub
```

### Data Isolation

```
Every query uses installation_id as primary filter:
  
  SELECT * FROM pull_requests
  WHERE installation_id = ? AND ...
        ↑
        Must match authenticated installation
  
This prevents installation A from seeing installation B's data
```

### Secrets Protection

```
Never logged/exposed:
  ├─ GitHub private key
  ├─ GitHub webhook secret
  ├─ GitHub installation tokens
  ├─ DeepSeek API key
  ├─ Database password
  └─ User passwords

Stored securely:
  ├─ .env file (not in git)
  ├─ Environment variables (not accessible between containers)
  ├─ Separate volumes for certificates
  └─ Non-root user in container
```

## Scalability Considerations

### Current (V1)

```
Single Node.js process handles:
  - All webhook events
  - All GitHub API calls
  - All DeepSeek API calls
  - All database operations

Suitable for: 10-100 PRs per day
```

### Future (V2+)

```
Potential improvements:
  ├─ Job queue (Redis/RabbitMQ)
  │  └─ Async processing of PRs
  │  └─ Worker pool for parallelism
  │  └─ Retry logic with exponential backoff
  │
  ├─ Caching layer (Redis)
  │  └─ Cache GitHub API responses
  │  └─ Cache tokens longer
  │  └─ Cache DeepSeek outputs
  │
  ├─ Load balancing
  │  └─ Multiple app instances
  │  └─ Shared database
  │  └─ Health checks for failover
  │
  └─ Monitoring & Observability
     └─ Prometheus metrics
     └─ Distributed tracing
     └─ Error tracking (Sentry)
```

## Error Handling Strategy

```
By severity:

1. Critical (app stops):
   └─ Missing required env vars
   └─ Database connection fails
   → Exit process, Kubernetes/Docker restarts

2. Non-blocking (request fails):
   └─ GitHub API 404 (repo deleted)
   └─ DeepSeek timeout
   → Log error, return HTTP 202
   → GitHub marks delivery as success
   → App logs show the failure

3. Recoverable (automatic retry):
   └─ GitHub API rate limit
   → Exponential backoff
   → Retry with fresh token

4. Informational:
   └─ Duplicate webhook delivery
   └─ Event not relevant
   → Log at debug level, return 200 OK
```

## Testing Strategy

```
Unit Tests:
  ├─ Webhook signature validation
  ├─ Event filtering logic
  ├─ Database operations
  └─ Crypto operations

Integration Tests:
  ├─ GitHub API mocking
  ├─ DeepSeek API mocking
  ├─ Full webhook flow
  └─ Error scenarios

End-to-End Tests:
  ├─ Docker Compose setup
  ├─ Real webhook delivery
  ├─ Full processing pipeline
  └─ Check Run creation on GitHub
  (Manual, requires GitHub account)
```

## Monitoring & Logging

```
Application Logs:
  ├─ INFO: Major operations (webhook received, PR processed)
  ├─ DEBUG: Detailed operations (context collected, API calls)
  ├─ WARN: Recoverable errors (DeepSeek timeout)
  └─ ERROR: Failures (database error, API error)

Database:
  ├─ webhook_deliveries table tracks all webhooks
  ├─ processing_queue tracks failed jobs
  ├─ pr_summaries stores output for audit
  └─ Query logs available via PostgreSQL logs

Health Checks:
  ├─ /health endpoint (app, database, dependencies)
  ├─ Docker health checks (container restart)
  ├─ Nginx health checks (proxy availability)
  └─ PostgreSQL health checks (database uptime)
```
