# PR Summary GitHub App - Deployment Guide

**Complete deployment in one command after prerequisites are configured.**

Time to deployment: **~30 minutes**

---

## Overview: What Gets Automated

When you run `sudo ./deploy.sh`, the script automatically:

- ✅ Validates your configuration
- ✅ Checks DNS is pointing to your server
- ✅ Installs Docker (if not present)
- ✅ Builds application Docker images
- ✅ Obtains Let's Encrypt SSL certificates
- ✅ Starts PostgreSQL, App, and Nginx
- ✅ Runs database migrations
- ✅ Performs health checks
- ✅ Verifies HTTPS is working
- ✅ Configures automatic certificate renewal (cron)
- ✅ Provides status report

**You do NOT need to:**
- Run separate certificate scripts
- Manually install Docker
- Configure Nginx
- Start containers individually
- Setup certificate renewal

---

## Prerequisites Checklist

Before running deployment, you must have:

- [ ] A VPS or cloud server (2GB RAM minimum)
  - Ubuntu 22.04 or newer recommended
  - SSH access as root or sudo user
  
- [ ] A domain name
  - DNS A record pointing to VPS IP
  - Propagated (can take 5-15 minutes)
  
- [ ] GitHub App created with proper settings
  - App ID
  - Private key (.pem file contents)
  - Webhook secret
  - Correct permissions configured
  
- [ ] DeepSeek API key
  - Valid API key
  - Account has API credits
  
- [ ] `.env` file configured
  - Copy from `.env.example`
  - All required variables filled in

---

## Step 1: Domain and DNS Setup

### Verify Your Domain

1. Get your VPS's public IP address:
   ```bash
   # You can find this in your VPS provider's control panel
   # Or on the VPS itself:
   curl -s https://api.ipify.org
   ```

2. Configure DNS at your registrar:
   - Type: A Record
   - Name: `your-domain.com` (or `@`)
   - Value: Your VPS IP address
   
   Example:
   ```
   Type    Name              Value
   A       your-domain.com   192.0.2.1
   ```

3. Wait for DNS propagation (5-15 minutes):
   ```bash
   # Test from your local machine
   nslookup your-domain.com
   # Should return your VPS IP
   ```

4. SSH into your VPS:
   ```bash
   ssh root@your-vps-ip
   # or
   ssh ubuntu@your-vps-ip
   ```

---

## Step 2: GitHub App Creation

### Go to GitHub App Settings

1. Visit: https://github.com/settings/apps
2. Click "New GitHub App"

### Fill in Required Information

**App Details:**
- **App name**: `PR Summary` (or any name you prefer)
- **Homepage URL**: `https://your-domain.com`
- **User authorization callback URL**: Leave blank

**Webhook Settings:**
- Check "Active"
- **Webhook URL**: `https://your-domain.com/webhook`
- **Webhook secret**: Generate a random string
  ```bash
  # Run this on your local machine to generate:
  openssl rand -hex 32
  ```

### Set Permissions (CRITICAL — Do This Exactly)

After filling in basic info, scroll down to the **"Permissions"** section. You'll see expandable dropdowns.

**For each permission, click the dropdown and select the level shown below:**

#### 1. Repository Permissions → Pull requests
- Click the dropdown next to "Pull requests"
- Select: **"Read & Write"**
  
#### 2. Repository Permissions → Contents  
- Click the dropdown next to "Contents"
- Select: **"Read"**

#### 3. Repository Permissions → Checks
- Click the dropdown next to "Checks"  
- Select: **"Read & Write"**

#### 4. Account Permissions → Metadata
- Scroll down to "Account permissions"
- Click the dropdown next to "Metadata"
- Select: **"Read"** (GitHub requires this)

**Result should look like this:**
```
Repository permissions
  Pull requests        → Read & Write ✓
  Contents             → Read ✓
  Checks               → Read & Write ✓

Account permissions
  Metadata             → Read ✓
```

### Subscribe to Webhook Events

Scroll down to **"Subscribe to events"** section.

**Check exactly these two boxes:**
- ✅ **Pull request** (checkbox should be filled)
- ✅ **Pull request review** (checkbox should be filled)

All other checkboxes should be **unchecked**.

### Installation Settings

At the bottom, **"Where can this GitHub App be installed?"**
- Select: **"Any account"** (allows installation on other repos)
- Do NOT check "Only on this account"

### Save Your Credentials

After creation, save these values (you'll need them for `.env`):

1. **App ID**: 
   - Go to your app settings
   - Under "About" section
   - Note the "App ID" number (e.g., 123456)

2. **Private Key**:
   - In "Private keys" section
   - Click "Generate a private key"
   - A `.pem` file will download
   - Open it in a text editor
   - Copy the entire contents (including `-----BEGIN` and `-----END` lines)

3. **Webhook Secret**:
   - Use the random string you generated earlier

---

## Step 3: Configure `.env` File

### On Your VPS

1. Clone or upload the application:
   ```bash
   cd /opt
   git clone https://github.com/iam-orsu/PrApp.git
   cd PrApp
   ```

2. Copy the example configuration:
   ```bash
   cp .env.example .env
   ```

3. Edit the `.env` file:
   ```bash
   nano .env
   ```

### Fill in These Values

```env
# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...entire contents of .pem file...
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here

# Deployment Configuration
DOMAIN=your-domain.com
LETSENCRYPT_EMAIL=your-email@example.com

# DeepSeek Configuration
DEEPSEEK_API_KEY=sk-...your-api-key...

# Database Configuration (can leave defaults)
POSTGRES_USER=pr_app
POSTGRES_PASSWORD=change-to-secure-password
POSTGRES_DB=pr_summary_db

# Optional (defaults are fine)
LOG_LEVEL=info
MAX_DIFF_SIZE=50000
```

**Critical:**
- Change `POSTGRES_PASSWORD` to something secure (not the default)
- Make sure `GITHUB_PRIVATE_KEY` includes the newlines exactly as in the `.pem` file
- Don't share `.env` file (it contains secrets)

---

## Step 4: One-Command Deployment

### Run the Deployment Script

```bash
cd /opt/PrApp
sudo ./deploy.sh
```

### What Happens

The script will:

1. **Validate Configuration** (10 seconds)
   - Check all required variables are set
   - Verify domain DNS is working
   - If DNS isn't set up, it will tell you

2. **Install Docker** (2-3 minutes, if needed)
   - Downloads Docker installer
   - Installs and starts Docker daemon
   - If already installed, skips this step

3. **Prepare Application** (1 minute)
   - Creates directories for data persistence
   - Configures Nginx with your domain

4. **Obtain SSL Certificates** (1-2 minutes)
   - Uses Let's Encrypt via Certbot
   - May prompt to verify email
   - Certificates saved in `letsencrypt/` directory

5. **Start Services** (1 minute)
   - PostgreSQL database
   - Node.js application
   - Nginx reverse proxy

6. **Wait for Services** (30-60 seconds)
   - Waits for database to be ready
   - Runs database migrations
   - Waits for application to start

7. **Verify HTTPS** (30 seconds)
   - Tests that HTTPS is working
   - Tests that HTTP redirects to HTTPS

8. **Setup Auto-Renewal** (10 seconds)
   - Installs a cron job for daily certificate renewal
   - Certificates auto-renew 30 days before expiration

### Expected Output

```
=== Deployment Complete ✓ ===

Your PR Summary GitHub App is now deployed!

Application URL: https://your-domain.com
Health Check: https://your-domain.com/health
Webhook Endpoint: https://your-domain.com/webhook

Next Steps:
1. Create your GitHub App (see above)
2. Install the app on a test repository
3. Create a test PR to verify everything works
```

---

## Step 5: GitHub App Installation

### Install on a Test Repository

1. Go to your GitHub App settings:
   - https://github.com/settings/apps
   - Find your app
   - Click "Install App"

2. Select a test repository (create one if needed):
   - Choose "All repositories" or select specific ones
   - Click "Install" or "Authorize"

3. GitHub will redirect to confirm installation

### Verify Installation

Check the application logs:
```bash
docker compose logs -f app
```

You should see:
```
[INFO] Server running on port 3000
[INFO] Database initialized
```

---

## Step 6: Testing

### Create a Test PR

```bash
# In your test repository
git checkout -b test-feature
echo "test" > test.txt
git add test.txt
git commit -m "Test PR"
git push origin test-feature
```

Then create a Pull Request on GitHub.

### Monitor Processing

Watch the logs:
```bash
docker compose logs -f app
```

You should see:
```
[INFO] Webhook received (eventType: pull_request, action: opened)
[INFO] Starting PR processing
[DEBUG] Collecting PR context
[DEBUG] Generating AI summary
[INFO] PR processing completed
```

### Check the Summary

1. Go to your test PR on GitHub
2. Click the "Checks" tab
3. You should see "PR Summary" check
4. Click it to view the full AI-generated summary

---

## Troubleshooting

### DNS Not Pointing to Server

**Error**: "Domain 'your-domain.com' does not resolve to an IP address"

**Solution**:
1. Update your domain registrar's DNS settings
2. Point your domain's A record to your VPS IP
3. Wait 5-15 minutes for propagation
4. Test with: `nslookup your-domain.com`
5. Re-run: `sudo ./deploy.sh`

### Docker Installation Failed

**Error**: "Docker installation failed"

**Solution**:
1. Try installing manually:
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   ```
2. Verify: `docker --version`
3. Re-run: `sudo ./deploy.sh`

### Let's Encrypt Certificate Failed

**Error**: "Failed to obtain SSL certificate from Let's Encrypt"

**Solution**:
1. Verify domain DNS is working: `nslookup your-domain.com`
2. Verify email is correct in `.env`
3. Check Let's Encrypt isn't rate-limiting (max 50 orders/week)
4. Re-run: `sudo ./deploy.sh` (it will try again)

### Services Not Starting

**Error**: Application or PostgreSQL container won't start

**Solution**:
1. Check logs: `docker compose logs`
2. Check specific service:
   ```bash
   docker compose logs postgres
   docker compose logs app
   docker compose logs nginx
   ```
3. Common issues:
   - Port already in use: `lsof -i :80` or `lsof -i :443`
   - Disk space full: `df -h`
   - Invalid configuration in `.env`: `cat .env`

### HTTPS Not Working

**Error**: `curl https://your-domain.com` fails

**Solution**:
1. Check certificates exist:
   ```bash
   ls -la letsencrypt/live/your-domain.com/
   ```
2. Check Nginx logs:
   ```bash
   docker compose logs nginx
   ```
3. Test HTTP redirect:
   ```bash
   curl -I http://your-domain.com
   # Should see 301/302 redirect
   ```
4. Re-run deployment:
   ```bash
   sudo ./deploy.sh
   ```

### Webhook Not Received

**Error**: App logs don't show webhook events

**Solution**:
1. Verify webhook URL in GitHub App settings:
   - Should be exactly: `https://your-domain.com/webhook`
   - With HTTPS (not HTTP)
   - No trailing slash
   
2. Check GitHub's webhook delivery logs:
   - App settings → "Advanced" tab → "Webhooks"
   - Click "Recent Deliveries"
   - View response status and errors
   
3. Verify HTTPS is working:
   ```bash
   curl https://your-domain.com/health
   # Should return JSON response
   ```

### DeepSeek API Errors

**Error**: "DeepSeek API error"

**Solution**:
1. Verify API key is correct:
   ```bash
   cat .env | grep DEEPSEEK_API_KEY
   ```
2. Check account has credits: https://platform.deepseek.com
3. Check API isn't rate-limited (view logs for details)
4. Restart app:
   ```bash
   docker compose restart app
   ```

---

## Maintenance

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f nginx

# Last 50 lines
docker compose logs --tail=50 app

# Since specific time
docker compose logs --since 10m app
```

### Checking Service Status

```bash
# All services
docker compose ps

# Health check
curl https://your-domain.com/health

# Database connectivity
docker compose exec postgres psql -U pr_app -d pr_summary_db -c "SELECT 1"
```

### Database Backup

```bash
# Create backup
docker compose exec postgres pg_dump -U pr_app pr_summary_db > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U pr_app pr_summary_db
```

### Certificate Status

```bash
# Check expiration date
openssl x509 -in letsencrypt/live/your-domain.com/fullchain.pem -noout -enddate

# Renewal logs
tail -f logs/renewal.log
```

### Updating the Application

```bash
# Pull latest code
git pull

# Redeploy (safe, won't delete database)
sudo ./deploy.sh
```

This is safe to run multiple times.

### Restarting Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart app

# Restart database (careful!)
docker compose restart postgres
```

### Resource Monitoring

```bash
# Real-time resource usage
docker stats

# Disk usage
df -h

# Memory usage
free -h
```

---

## Common Questions

### Q: Will this disrupt my normal PR workflow?

**A**: No. The app only reads PR data and updates a Check Run. It never modifies branches, closes/merges PRs, or interferes with development.

### Q: Is my code sent to DeepSeek?

**A**: Yes. The entire PR context, including file diffs, is sent to DeepSeek for analysis. This is necessary for the feature to work. Review DeepSeek's privacy policy.

### Q: What if DeepSeek is down?

**A**: The app gracefully degrades. It records an error in the Check Run but doesn't block the PR. Developers can still review and merge normally.

### Q: Do I need to renew certificates manually?

**A**: No. A cron job automatically attempts renewal daily. Let's Encrypt certificates auto-renew 30 days before expiration.

### Q: How much does this cost?

**A**: 
- VPS: $5-20/month
- DeepSeek API: ~$0.01 per PR summary
- Let's Encrypt: Free
- Domain: ~$1/month (amortized)
- **Total: ~$7-22/month**

### Q: Can I uninstall?

**A**: Yes:
```bash
# Stop and remove containers
docker compose down -v

# This keeps your database
# To also delete database:
docker volume rm prapp_postgres_data
```

### Q: How do I update the app?

**A**: 
```bash
git pull
sudo ./deploy.sh
```

It's safe to run multiple times and won't delete your database.

---

## Advanced

### Environment Variables

All available options in `.env`:

```env
# Required
GITHUB_APP_ID              GitHub App ID
GITHUB_PRIVATE_KEY         GitHub App private key
GITHUB_WEBHOOK_SECRET      Random secret for webhooks
DOMAIN                     Your domain name
LETSENCRYPT_EMAIL          Email for cert notifications
DEEPSEEK_API_KEY           DeepSeek API key
POSTGRES_PASSWORD          Database password

# Optional (defaults shown)
LOG_LEVEL=info             debug, info, warn, error
MAX_DIFF_SIZE=50000        Max diff size to include in AI
MAX_CONCURRENT_JOBS=5      Concurrent processing jobs
DEEPSEEK_TIMEOUT=60000     DeepSeek timeout in ms
DEEPSEEK_MODEL=deepseek-chat  Model to use
NODE_ENV=production        production or development
DEBUG=false                Enable debug mode
```

### Port Configuration

The app uses these ports:

- **80**: HTTP (redirects to HTTPS)
- **443**: HTTPS (your app)
- **3000**: Application (internal, behind Nginx)
- **5432**: PostgreSQL (internal, behind firewall)

Only ports 80 and 443 are exposed publicly.

### Directory Structure

After deployment:

```
PrApp/
├── letsencrypt/          ← SSL certificates (auto-renewed)
├── logs/                 ← Application logs
├── .postgres_data/       ← Database files (persistent)
├── .nginx_cache/         ← Nginx cache (can be deleted)
├── .env                  ← Your configuration (keep secret!)
├── docker-compose.yml    ← Service configuration
├── Dockerfile            ← App container definition
└── src/                  ← Source code
```

### Monitoring with External Tools

You can monitor the app at:
- Health: `https://your-domain.com/health`
- Logs: `docker compose logs -f`
- Database: `docker compose exec postgres psql -U pr_app -d pr_summary_db`

---

## Support & Help

If you encounter issues:

1. Check logs: `docker compose logs -f`
2. Check the troubleshooting section above
3. Verify DNS: `nslookup your-domain.com`
4. Verify configuration: `cat .env | grep -v PASSWORD`
5. Test HTTPS: `curl -k https://your-domain.com/health`

---

**Next Step**: Follow the prerequisites checklist, configure `.env`, and run `sudo ./deploy.sh`
