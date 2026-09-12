# PR Summary - AI-Powered GitHub Pull Request Analyzer

A GitHub App that automatically generates AI-powered summaries of pull requests, helping developers understand changes without manually reviewing every commit and file change.

## Features

- 🤖 **Automatic PR Summarization** - Analyzes PRs and generates clear, grounded summaries
- 📊 **Check Run Integration** - Summaries appear in GitHub's Checks tab, not cluttering comments
- 🔄 **Evolving Summary** - One PR = one evolving summary that updates as the PR changes
- 🛡️ **Idempotent Processing** - Handles duplicate webhooks and concurrent events safely
- 📈 **Large PR Support** - Intelligently truncates massive diffs while preserving context
- ⚡ **Production Ready** - Graceful degradation when AI or GitHub services fail
- 🔒 **Secure** - Webhook signature validation, API key protection, data isolation

## What It Does

When you create or update a Pull Request:

1. GitHub notifies the app via webhook
2. App collects PR context (commits, files, reviews, comments)
3. AI analyzes the complete picture
4. Summary appears in the PR's Checks tab

Example summary:
```
## Summary
This PR adds OAuth2 authentication to the user service, following the existing token-based pattern.

## What Changed
- Added OAuth2Provider interface and implementations
- Modified UserService to use provider pattern
- Updated tests for new functionality

## Evolution & Reviews
Initial implementation added core OAuth provider. Reviewer requested improved error handling, 
which was added in commit 2. Tests were added in commit 3.

## Current State
Ready to merge. All reviews approved.
```

## Tech Stack

- **Runtime**: Node.js 20
- **Language**: TypeScript
- **Database**: PostgreSQL
- **API Client**: Octokit (GitHub API)
- **Reverse Proxy**: Nginx with Let's Encrypt
- **Container**: Docker & Docker Compose
- **AI**: DeepSeek API

## Quick Start

**One-command deployment. ~30 minutes start to finish.**

### Prerequisites

- [ ] VPS with public IP (2GB RAM)
- [ ] Domain name (DNS pointing to VPS)
- [ ] GitHub App (created and configured)
- [ ] DeepSeek API key
- [ ] SSH access to VPS

### Deploy in 3 Steps

1. **Create GitHub App** (~15 min)
   - Go to: https://github.com/settings/apps
   - Create app with webhook pointing to `https://your-domain.com/webhook`
   - Save App ID, Private Key, Webhook Secret

2. **Configure .env** (~5 min)
   ```bash
   cp .env.example .env
   # Edit with GitHub App credentials and DeepSeek API key
   ```

3. **Deploy** (~8 min)
   ```bash
   sudo ./deploy.sh
   ```

That's it! The script handles:
- Docker installation
- SSL certificate acquisition  
- Container startup
- Database migrations
- HTTPS verification
- Certificate auto-renewal

### Test

Create a PR in your GitHub repository → Check the "Checks" tab → See the AI summary!

For detailed instructions, see:
- [QUICK_START.md](./QUICK_START.md) - 30-minute setup
- [DEPLOY.md](./DEPLOY.md) - Comprehensive guide

## Architecture

```
GitHub webhook → Nginx (HTTPS) → Express.js app → PostgreSQL
                                      ↓
                                  DeepSeek API
                                      ↓
                                  Check Run created
```

### Key Components

- **GitHub Integration** - Webhook handling, JWT auth, API calls
- **AI Processing** - DeepSeek integration with smart prompting
- **Database** - PostgreSQL for state, webhooks, summaries
- **Deployment** - Docker Compose with automatic HTTPS via Let's Encrypt
- **Monitoring** - Health checks, structured logging

## Deployment

See [DEPLOY.md](./DEPLOY.md) for complete deployment instructions.

Key files:
- `Dockerfile` - Application container
- `docker-compose.yml` - Service orchestration
- `deploy.sh` - One-command deployment
- `obtain-cert.sh` - SSL certificate automation

## Security Considerations

### What's Sent to DeepSeek

The app sends the complete PR context to DeepSeek:
- PR title and description
- All commit messages
- File names and status
- Full code diffs
- Review text
- PR discussion

**This is necessary for the AI to understand the PR.** Review DeepSeek's privacy policy.

### What's Protected

- GitHub App private key: Stored in .env, never logged
- Webhook secret: Used for signature verification only
- DeepSeek API key: Stored in .env, never logged
- Installation tokens: Automatically rotated, cached briefly
- Database credentials: Stored in .env

### Tenant Isolation

- Each GitHub installation is isolated
- Database queries always filter by installation_id
- Webhooks are validated with HMAC signatures

## Edge Cases Handled

| Issue | Solution |
|-------|----------|
| 10+ commits on one PR | Single evolving summary via Check Run updates |
| Duplicate webhooks | Delivery ID deduplication in database |
| Concurrent webhook events | Per-PR database locking |
| Huge diffs (>3000 files) | Intelligent truncation with file prioritization |
| DeepSeek timeout/failure | Graceful degradation; PR still works |
| GitHub API rate limits | Exponential backoff + token caching |
| Force-pushes | Re-fetch and re-analyze automatically |
| PR closed/reopened | Appropriate state handling |
| Multiple contributors | All commits and reviews included |

## Development

### Prerequisites

- Node.js 20+
- TypeScript
- Docker & Docker Compose

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run migrations
npm run migrate

# Start development server
npm run dev
```

### Testing

```bash
npm test
```

Current test coverage:
- Webhook signature validation
- GitHub API integration
- DeepSeek API integration
- Database models
- PR processing pipeline

## Limitations & Future Work

### V1 Limitations
- No intelligent batching (every commit triggers re-analysis)
- No per-team customization
- No UI for summary configuration
- No analytics dashboard

### Future (V2+)
- Smart batching/debouncing of rapid commits
- Customizable summary formats
- Admin dashboard for monitoring
- Webhook retry queue
- PR quality metrics
- Integration with code review tools

## Cost Estimation

Monthly costs (rough estimates):
- VPS (2GB RAM): $5-20
- DeepSeek API: $0.01 per PR × 100 PRs/month = $1
- Let's Encrypt: Free
- Domain: $10-15

**Total: ~$20-35/month**

## Troubleshooting

See [DEPLOY.md Troubleshooting Section](./DEPLOY.md#troubleshooting).

Common issues:
- HTTPS not working → Check certificate with `ls -la letsencrypt/`
- Webhooks not received → Verify URL in GitHub settings is exact HTTPS URL
- DeepSeek errors → Check API key and account credits
- Database errors → Check PostgreSQL logs with `docker-compose logs postgres`

## Contributing

This is the initial release. Contributions welcome!

Areas for improvement:
- Better error messages
- More comprehensive logging
- Performance optimizations
- Additional test coverage

## License

MIT

## Support

- Documentation: [DEPLOY.md](./DEPLOY.md)
- Issues: Check GitHub webhook deliveries in your app settings
- Logs: `docker-compose logs -f`

---

**Built with ❤️ using TypeScript, Node.js, and DeepSeek**
