# Quick Start Guide

**One-command deployment. ~30 minutes from zero to production.**

## Overview

```
1. Create GitHub App (15 min)
   ↓
2. Configure .env (5 min)
   ↓
3. sudo ./deploy.sh (8 min)
   ↓
4. Test with a PR (2 min)
```

---

## Step 1: Create GitHub App (15 minutes)

### Go to GitHub App Settings

1. Visit: https://github.com/settings/apps
2. Click "New GitHub App"

### Fill in Basic Info

- **App name**: `PR Summary`
- **Homepage URL**: `https://your-domain.com`
- **Webhook URL**: `https://your-domain.com/webhook`
- **Webhook secret**: `openssl rand -hex 32` (run on your local machine, copy output)

### Select Permissions

| Permission | Access |
|-----------|--------|
| Pull requests | Read & Write |
| Contents | Read |
| Checks | Read & Write |

### Subscribe to Events

- ✅ Pull request
- ✅ Pull request review

### Create and Save

After creation, copy these values:
- **App ID** (shown under "About")
- **Private Key** (generate, download .pem file, copy contents)
- **Webhook Secret** (you already have this)

---

## Step 2: Configure .env (5 minutes)

### On Your VPS

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Navigate to project
cd /opt/PrApp

# Create config file
cp .env.example .env
nano .env
```

### Fill in These Values

```env
GITHUB_APP_ID=YOUR_APP_ID_HERE
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...paste entire .pem file contents here...
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here
DOMAIN=your-domain.com
LETSENCRYPT_EMAIL=your-email@example.com
DEEPSEEK_API_KEY=sk-your-api-key-here
POSTGRES_PASSWORD=change-to-something-secure
```

Save: `Ctrl+X`, then `Y`, then `Enter`

---

## Step 3: Deploy (8 minutes)

```bash
sudo ./deploy.sh
```

The script will:
- ✅ Validate configuration
- ✅ Check DNS is working
- ✅ Install Docker (if needed)
- ✅ Get SSL certificates
- ✅ Start all services
- ✅ Run migrations
- ✅ Verify HTTPS
- ✅ Setup auto-renewal

**Expected time: 5-8 minutes**

When done, you'll see:
```
=== DEPLOYMENT COMPLETE ✓ ===

Application URL: https://your-domain.com
Health Check: https://your-domain.com/health
```

---

## Step 4: Test (2 minutes)

### Install App on Test Repository

1. Go to: https://github.com/settings/apps
2. Find your app → Click "Install App"
3. Select a test repository
4. Authorize

### Create a Test PR

```bash
# In the test repository
git checkout -b test-feature
echo "test" > test.txt
git add test.txt
git commit -m "Test PR"
git push origin test-feature
```

Create a Pull Request on GitHub.

### Watch the Magic

Monitor logs:
```bash
docker compose logs -f app
```

You should see the webhook being processed.

### Check the Result

On your test PR → Click "Checks" tab → You should see "PR Summary" with the AI-generated summary!

---

## Done! 🎉

Your GitHub App is live.

### Useful Commands

```bash
# View logs
docker compose logs -f app

# Check health
curl https://your-domain.com/health

# Restart app
docker compose restart app

# Stop everything
docker compose down
```

### Common Issues

**DNS not working?** 
- Update your registrar to point to your VPS IP
- Wait 5-15 minutes for propagation

**Docker not installed?**
- Run `sudo ./deploy.sh` again (it installs Docker automatically)

**Webhook not received?**
- Check GitHub App settings has correct webhook URL: `https://your-domain.com/webhook`
- Check GitHub's webhook delivery logs

**More help?**
- See `DEPLOY.md` for comprehensive troubleshooting

---

## Next Steps

- Create real PRs and monitor
- Adjust `MAX_DIFF_SIZE` if summaries are truncated
- Set up database backups
- Monitor logs daily for first week

---

**See DEPLOY.md for detailed documentation and troubleshooting.**
