#!/bin/bash

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Let's Encrypt Certificate Obtainer${NC}"
echo ""

# Load environment
if [ ! -f .env ]; then
    echo -e "${RED}ERROR: .env file not found${NC}"
    exit 1
fi

set -a
source .env
set +a

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}ERROR: DOMAIN not set in .env${NC}"
    exit 1
fi

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo -e "${RED}ERROR: LETSENCRYPT_EMAIL not set in .env${NC}"
    exit 1
fi

echo "Domain: $DOMAIN"
echo "Email: $LETSENCRYPT_EMAIL"
echo ""

# Check if already obtained
if [ -d "letsencrypt/live/${DOMAIN}" ]; then
    echo -e "${YELLOW}Certificates already exist for ${DOMAIN}${NC}"
    read -p "Renew them? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Use certbot in Docker
echo "Obtaining certificates using Certbot..."
echo ""

# Create a temporary nginx for ACME challenge
docker run --rm -it \
    -p 80:80 \
    -v "$(pwd)/letsencrypt:/etc/letsencrypt" \
    -v "$(pwd):/data" \
    certbot/certbot certonly \
    --standalone \
    --agree-tos \
    --no-eff-email \
    --email "$LETSENCRYPT_EMAIL" \
    -d "$DOMAIN"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Certificates obtained successfully${NC}"
    echo ""
    echo "Restarting nginx to load new certificates..."

    # Update nginx.conf if needed and restart
    if grep -q "DOMAIN_PLACEHOLDER" nginx.conf; then
        sed -i.bak "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" nginx.conf
        rm -f nginx.conf.bak
    fi

    if command -v docker-compose &> /dev/null; then
        docker-compose restart nginx
    else
        docker compose restart nginx
    fi

    echo -e "${GREEN}✓ Nginx restarted${NC}"
    echo ""
    echo "Your domain should now be accessible via HTTPS"
else
    echo -e "${RED}ERROR: Certificate obtainment failed${NC}"
    exit 1
fi
