#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Log functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

# Error handler
error_exit() {
    log_error "$1"
    exit 1
}

# Start deployment
log_step "PR Summary GitHub App - Complete Deployment"

# ============================================================================
# PHASE 1: PREREQUISITES & VALIDATION
# ============================================================================

log_step "Phase 1: Validating Prerequisites"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error_exit "This script must be run with sudo"
fi

# Check if .env exists
if [ ! -f "${SCRIPT_DIR}/.env" ]; then
    error_exit ".env file not found. Copy .env.example to .env and configure it."
fi

# Load environment
cd "${SCRIPT_DIR}"
set -a
source .env
set +a

# Validate required environment variables
log_info "Validating configuration..."
required_vars=(
    "GITHUB_APP_ID"
    "GITHUB_PRIVATE_KEY"
    "GITHUB_WEBHOOK_SECRET"
    "DEEPSEEK_API_KEY"
    "DOMAIN"
    "LETSENCRYPT_EMAIL"
    "POSTGRES_PASSWORD"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        error_exit "Required environment variable '${var}' is not set in .env"
    fi
done
log_info "✓ All required environment variables present"

# ============================================================================
# PHASE 2: CHECK DOMAIN/DNS
# ============================================================================

log_step "Phase 2: Verifying Domain Configuration"

log_info "Checking DNS resolution for ${DOMAIN}..."

# Try to resolve domain (using getent as it's more universal than dig)
resolved_ip=""
if command -v getent &> /dev/null; then
    resolved_ip=$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -1)
elif command -v nslookup &> /dev/null; then
    resolved_ip=$(nslookup "${DOMAIN}" 2>/dev/null | grep -A1 "Name:" | grep "Address:" | awk '{print $2}' | head -1)
else
    log_warn "Could not verify DNS (getent/nslookup not available). Skipping DNS verification."
    resolved_ip="0.0.0.0" # Placeholder to allow continuation
fi

if [ -z "$resolved_ip" ] || [ "$resolved_ip" = "0.0.0.0" ]; then
    if [ "$resolved_ip" != "0.0.0.0" ]; then
        error_exit "Domain '${DOMAIN}' does not resolve to an IP address. Check your DNS configuration."
    fi
fi

log_info "Domain ${DOMAIN} resolves to: ${resolved_ip}"

# Get local IP
local_ip=$(hostname -I | awk '{print $1}')
log_info "This server's IP: ${local_ip}"

if [ "$resolved_ip" != "$local_ip" ]; then
    log_warn "Domain IP (${resolved_ip}) does not match this server's IP (${local_ip})"
    log_warn "Please update DNS to point to ${local_ip}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error_exit "DNS configuration mismatch. Fix DNS and try again."
    fi
fi

log_info "✓ DNS configuration verified"

# ============================================================================
# PHASE 3: INSTALL DOCKER (if needed)
# ============================================================================

log_step "Phase 3: Checking Docker Installation"

if ! command -v docker &> /dev/null; then
    log_warn "Docker is not installed. Installing..."

    # Update system
    apt-get update -y

    # Install Docker
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm /tmp/get-docker.sh

    log_info "✓ Docker installed successfully"
else
    log_info "✓ Docker already installed"
fi

# Verify Docker is running
if ! systemctl is-active --quiet docker; then
    log_warn "Docker daemon is not running. Starting..."
    systemctl start docker
    sleep 2
fi

log_info "✓ Docker is running"

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    error_exit "Docker Compose is not available. Please install Docker Desktop or Docker Compose v2."
fi

log_info "✓ Docker Compose available"

# ============================================================================
# PHASE 4: PREPARE DIRECTORIES & CONFIG
# ============================================================================

log_step "Phase 4: Preparing Application Structure"

# Create required directories
mkdir -p "${SCRIPT_DIR}/letsencrypt/live/${DOMAIN}"
mkdir -p "${SCRIPT_DIR}/letsencrypt/archive/${DOMAIN}"
mkdir -p "${SCRIPT_DIR}/letsencrypt/renewal"
mkdir -p "${SCRIPT_DIR}/logs"
mkdir -p "${SCRIPT_DIR}/.postgres_data"
mkdir -p "${SCRIPT_DIR}/.nginx_cache"

log_info "✓ Required directories created"

# Update nginx.conf with actual domain
log_info "Configuring nginx for ${DOMAIN}..."
cp "${SCRIPT_DIR}/nginx.conf" "${SCRIPT_DIR}/nginx.conf.tmp"
sed -i "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" "${SCRIPT_DIR}/nginx.conf.tmp"
mv "${SCRIPT_DIR}/nginx.conf.tmp" "${SCRIPT_DIR}/nginx.conf.prod"

log_info "✓ Nginx configuration prepared"

# ============================================================================
# PHASE 5: OBTAIN SSL CERTIFICATES
# ============================================================================

log_step "Phase 5: Obtaining Let's Encrypt Certificates"

cert_dir="${SCRIPT_DIR}/letsencrypt/live/${DOMAIN}"

if [ -f "${cert_dir}/fullchain.pem" ] && [ -f "${cert_dir}/privkey.pem" ]; then
    log_info "✓ Valid certificates already exist for ${DOMAIN}"
else
    log_info "No valid certificates found. Obtaining from Let's Encrypt..."

    # Stop any existing nginx
    docker compose down 2>/dev/null || true

    # Run certbot standalone to get certificates
    log_info "Running Certbot to obtain certificates (this may take 1-2 minutes)..."

    docker run --rm --name certbot \
        -v "${SCRIPT_DIR}/letsencrypt:/etc/letsencrypt" \
        -p 80:80 \
        certbot/certbot:latest certonly \
            --standalone \
            --agree-tos \
            --no-eff-email \
            --email "${LETSENCRYPT_EMAIL}" \
            --domain "${DOMAIN}" \
            --non-interactive \
            --preferred-challenges http 2>&1 | grep -v "^Saving debug log to"

    if [ ! -f "${cert_dir}/fullchain.pem" ]; then
        error_exit "Failed to obtain SSL certificate from Let's Encrypt. Check your domain and email."
    fi

    log_info "✓ SSL certificates obtained successfully"
fi

# ============================================================================
# PHASE 6: BUILD & START CONTAINERS
# ============================================================================

log_step "Phase 6: Building and Starting Services"

cd "${SCRIPT_DIR}"

log_info "Building Docker images..."
docker compose build --no-cache

log_info "Starting services..."
docker compose up -d

log_info "✓ Containers starting up"

# ============================================================================
# PHASE 7: WAIT FOR SERVICES TO BE READY
# ============================================================================

log_step "Phase 7: Waiting for Services to Be Ready"

# Wait for PostgreSQL
log_info "Waiting for PostgreSQL to be ready..."
max_attempts=60
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-pr_app}" -d "${POSTGRES_DB:-pr_summary_db}" &>/dev/null; then
        log_info "✓ PostgreSQL is healthy"
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 1
done

if [ $attempt -eq $max_attempts ]; then
    log_error "PostgreSQL failed to become healthy"
    docker compose logs postgres | tail -20
    error_exit "Database initialization failed"
fi

# Run database migrations
log_info "Running database migrations..."
if ! docker compose exec -T app npm run migrate &>/dev/null; then
    log_error "Database migration failed"
    docker compose logs app | tail -20
    error_exit "Migration failed"
fi
log_info "✓ Database migrations completed"

# Wait for application
log_info "Waiting for application to be ready..."
attempt=0
while [ $attempt -lt 60 ]; do
    if docker compose exec -T app wget --quiet --tries=1 --spider http://localhost:3000/health >/dev/null 2>&1; then
        log_info "✓ Application is healthy"
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 1
done

if [ $attempt -eq 60 ]; then
    log_error "Application failed to become healthy"
    docker compose logs app | tail -20
    error_exit "Application startup failed"
fi

# ============================================================================
# PHASE 8: VERIFY HTTPS
# ============================================================================

log_step "Phase 8: Verifying HTTPS Configuration"

log_info "Waiting for Nginx to start..."
sleep 5

log_info "Testing HTTPS endpoint..."
https_response=$(curl -s -o /dev/null -w "%{http_code}" --insecure "https://${DOMAIN}/health" || echo "000")

if [ "$https_response" = "200" ]; then
    log_info "✓ HTTPS is working (status: ${https_response})"
else
    log_warn "HTTPS returned status: ${https_response}"
    log_warn "This may be normal if Nginx is still starting up"
    log_info "Check logs with: docker compose logs nginx"
fi

log_info "Testing HTTP redirect..."
http_response=$(curl -s -I "http://${DOMAIN}/health" 2>/dev/null | head -1 || echo "")
if echo "$http_response" | grep -q "301\|302\|303"; then
    log_info "✓ HTTP is redirecting to HTTPS"
else
    log_warn "HTTP redirect may not be configured yet"
fi

# ============================================================================
# PHASE 9: SETUP CERTIFICATE RENEWAL
# ============================================================================

log_step "Phase 9: Setting Up Certificate Auto-Renewal"

# Create renewal script
renewal_script="${SCRIPT_DIR}/renew-certs.sh"
cat > "${renewal_script}" << 'EOF'
#!/bin/bash
cd $(dirname $0)
docker run --rm \
    -v "$(pwd)/letsencrypt:/etc/letsencrypt" \
    certbot/certbot:latest renew \
        --non-interactive \
        --quiet

# Reload nginx if renewal was successful
if [ $? -eq 0 ]; then
    docker compose exec -T nginx nginx -s reload 2>/dev/null || true
fi
EOF

chmod +x "${renewal_script}"

# Setup cron job for daily renewal attempts
renewal_cron="0 3 * * * ${renewal_script} >> ${SCRIPT_DIR}/logs/renewal.log 2>&1"

# Check if cron already exists
if ! crontab -l 2>/dev/null | grep -q "${renewal_script}"; then
    # Add to crontab
    (crontab -l 2>/dev/null; echo "${renewal_cron}") | crontab -
    log_info "✓ Certificate renewal cron job installed (daily at 3 AM)"
else
    log_info "✓ Certificate renewal cron job already configured"
fi

# ============================================================================
# PHASE 10: FINAL VERIFICATION & SUMMARY
# ============================================================================

log_step "Phase 10: Performing Final Verification"

log_info "Checking all service status..."
docker compose ps

log_info "Verifying application health..."
if curl -s https://"${DOMAIN}"/health --insecure 2>/dev/null | grep -q "ok"; then
    log_info "✓ Application is responding on https://${DOMAIN}/health"
else
    log_warn "Could not verify application response. This may take a moment."
    log_info "Check status with: curl -k https://${DOMAIN}/health"
fi

# ============================================================================
# DEPLOYMENT COMPLETE
# ============================================================================

log_step "DEPLOYMENT COMPLETE ✓"

echo ""
echo -e "${GREEN}Your PR Summary GitHub App is now deployed!${NC}"
echo ""
echo "Application URL: https://${DOMAIN}"
echo "Health Check: https://${DOMAIN}/health"
echo "Webhook Endpoint: https://${DOMAIN}/webhook"
echo ""
echo "PostgreSQL: $(docker compose port postgres 5432 2>/dev/null | cut -d: -f2) (internal only)"
echo "Application Port: $(docker compose port app 3000 2>/dev/null | cut -d: -f2) (internal only)"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Create your GitHub App (see DEPLOY.md)"
echo "2. Install the app on a test repository"
echo "3. Create a test PR to verify everything works"
echo ""
echo -e "${GREEN}Useful Commands:${NC}"
echo "  View logs:       docker compose logs -f app"
echo "  Check health:    curl -k https://${DOMAIN}/health"
echo "  Database shell:  docker compose exec postgres psql -U pr_app -d pr_summary_db"
echo "  Restart app:     docker compose restart app"
echo "  Stop services:   docker compose down"
echo ""
echo -e "${YELLOW}Certificate Info:${NC}"
echo "  Auto-renewal is configured via cron (daily at 3 AM)"
echo "  Certificates expire: $(openssl x509 -in ${cert_dir}/fullchain.pem -noout -enddate 2>/dev/null | cut -d= -f2)"
echo ""
