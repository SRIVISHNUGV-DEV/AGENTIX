# AGENTIX Production Deployment Checklist
**Last Updated:** 2026-05-10  
**Status:** In Progress

---

## Phase 1: Security Remediation (CRITICAL - Must Complete)

### 1.1 XSS Vulnerability Fix

**Location:** `backend/src/routes/orgs.ts`

```typescript
// Add at top of file after imports
import DOMPurify from "isomorphic-dompurify";

// In POST /orgs handler
const sanitizedName = DOMPurify.sanitize(req.body.name);
req.body.name = sanitizedName;
```

**Alternative if DOMPurify unavailable:**
```typescript
// Add sanitization utility
function sanitizeString(input: string): string {
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '');
}

// Use in route
const sanitizedName = sanitizeString(req.body.name);
```

### 1.2 SQL Injection Verification

**Location:** `backend/src/routes/orgs.ts`

**Action:** Verify all database queries use parameterized queries.

**Check for patterns:**
- ❌ Bad: `db.run("SELECT * FROM orgs WHERE name = '" + name + "'")`
- ✅ Good: `db.run("SELECT * FROM orgs WHERE name = ?", [name])`

**Verification Command:**
```bash
grep -r "db.run\|db.get\|db.all" backend/src/routes/ | grep -v "?\|\\$" | head -20
```

### 1.3 Security Headers Completion

**Status:** Mostly implemented in `security.ts`

**Verify these headers are set:**
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-ancestors 'none';
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-XSS-Protection: 1; mode=block
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

---

## Phase 2: Infrastructure Setup

### 2.1 AWS Infrastructure (Empty - Needs Setup)

**Directory:** `infrastructure/aws/`

**Required Files:**

1. **main.tf** - Terraform configuration
```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}
```

2. **ec2.tf** - Backend and Frontend servers
```hcl
resource "aws_instance" "backend" {
  ami           = "ami-0123456789abcdef" # Amazon Linux 2023
  instance_type = "t3.medium"

  tags = {
    Name = "agentix-backend"
  }
}
```

3. **rds.tf** - PostgreSQL database
```hcl
resource "aws_db_instance" "postgres" {
  engine         = "postgres"
  engine_version = "15.7"
  instance_class = "db.t3.micro"
  allocated_storage = 20
}
```

4. **elasticache.tf** - Redis cache
```hcl
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "agentix-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
}
```

5. **security_groups.tf** - Firewall rules
6. **outputs.tf** - Resource outputs

### 2.2 Nginx Configuration

**File:** `infrastructure/nginx/agentix.conf`

```nginx
upstream backend {
    server localhost:3000;
    keepalive 32;
}

upstream frontend {
    server localhost:3001;
    keepalive 32;
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name corvenlabs.org www.corvenlabs.org;
    return 301 https://$server_name$request_uri;
}

# API server
server {
    listen 443 ssl http2;
    server_name api.corvenlabs.org;

    ssl_certificate /etc/letsencrypt/live/corvenlabs.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/corvenlabs.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

# Frontend server
server {
    listen 443 ssl http2;
    server_name corvenlabs.org;

    ssl_certificate /etc/letsencrypt/live/corvenlabs.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/corvenlabs.org/privkey.pem;

    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2.3 SSL Certificates

**Using Let's Encrypt + Certbot:**

```bash
# Install Certbot
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

# Obtain certificates
sudo certbot --nginx -d corvenlabs.org -d api.corvenlabs.org

# Auto-renewal is configured automatically
# Verify renewal: sudo certbot renew --dry-run
```

---

## Phase 3: Environment Configuration

### 3.1 Production Environment Variables

**File:** `.env.production`

```bash
# =============================================
# AGENTIX Production Environment Configuration
# =============================================

# Node Environment
NODE_ENV=production

# =============================================
# Database Configuration
# =============================================
DB_TYPE=postgres
DATABASE_URL=postgresql://agentix:${DB_PASSWORD}@your-rds-host.amazonaws.com:5432/agentix
DB_POOL_SIZE=20
DB_SSL_MODE=require

# =============================================
# Redis Configuration
# =============================================
REDIS_URL=redis://your-elasticache-host:6379

# =============================================
# Backend Configuration
# =============================================
PORT=3000
LOG_LEVEL=warn
API_URL=https://api.corvenlabs.org
CORS_ORIGIN=https://corvenlabs.org

# =============================================
# Security
# =============================================
JWT_SECRET=your-64-character-hex-secret-here
SESSION_SECRET=another-64-character-secret-here
BCRYPT_ROUNDS=12

# =============================================
# Frontend Configuration
# =============================================
NEXT_PUBLIC_API_URL=https://api.corvenlabs.org
NEXT_PUBLIC_SOCKET_URL=wss://api.corvenlabs.org

# =============================================
# Blockchain Configuration
# =============================================
 rpc_choice=sh["https://sepolia.infura.io/v3/YOUR_INFURA_KEY", "https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"]
PRIVATE_KEY=your-wallet-private-key-here
CHAIN_ID=11155111
NETWORK_NAME=sepolia

# Contract Addresses (Sepolia)
SESSION_MANAGER_ADDRESS=0x...
CREDENTIAL_REGISTRY_ADDRESS=0x...
AGENT_WALLET_FACTORY_ADDRESS=0x...
AGENT_WALLET_IMPLEMENTATION_ADDRESS=0x...
VERIFIER_ADDRESS=0x...
ENTRY_POINT_ADDRESS=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789

# =============================================
# Alchemy Configuration
# =============================================
ALCHEMY_API_KEY=your-alchemy-key
ENABLE_EVENT_SYNC=true

# =============================================
# Monitoring & Observability
# =============================================
METRICS_ENABLED=true
METRICS_API_KEY=your-metrics-key
SENTRY_DSN=your-sentry-dsn (optional)

# =============================================
# Rate Limiting
# =============================================
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# =============================================
# Email/Notifications (Optional)
# =============================================
# SMTP_HOST=
# SMTP_PORT=
# SMTP_USER=
# SMTP_PASS=
```

### 3.2 Backend Environment Validation

```typescript
// Add to backend/src/index.ts or config.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  JWT_SECRET: z.string().min(64),
  PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  RPC_URL: z.string().url(),
  CORS_ORIGIN: z.string().url(),
});

// Validate on startup
envSchema.parse(process.env);
```

---

## Phase 4: Deployment Commands

### 4.1 Docker Compose Production Deployment

```bash
# 1. Clone and prepare
ssh user@your-server-ip
cd /opt
git clone https://github.com/SRIVISHNUGV-DEV/AGENTIX.git
cd AGENTIX/agent-credentials-mvp

# 2. Copy and configure environment
cp .env.production .env
# Edit .env with production values
nano .env

# 3. Pull latest images
docker-compose -f docker-compose.yml -f docker-compose.prod.yml pull

# 4. Start services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 5. Verify status
docker-compose ps
docker-compose logs -f

# 6. Health check
curl https://api.corvenlabs.org/health
```

### 4.2 AWS Deployment (Manual)

```bash
# Option 1: ECS with Fargate
# Option 2: EC2 with Docker

# EC2 Docker Compose setup:
# ========================

# Update system
sudo yum update -y

# Install Docker
sudo yum install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone repo
git clone https://github.com/SRIVISHNUGV-DEV/AGENTIX.git

# Setup and start
# (Follow steps in 4.1)
```

### 4.3 Vercel Frontend Deployment

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy
cd frontend
vercel --prod

# Or use environment variables
vercel --prod -e NEXT_PUBLIC_API_URL=https://api.corvenlabs.org
```

**vercel.json configuration:**
```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/next"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/$1"
    }
  ],
  "env": {
    "NEXT_PUBLIC_API_URL": "https://api.corvenlabs.org"
  }
}
```

---

## Phase 5: Verification & Validation

### 5.1 Health Check Commands

```bash
# API Health
curl -s https://api.corvenlabs.org/health | jq .
# Expected: {"status":"ok","timestamp":"...","uptime":...}

# Frontend
curl -s -o /dev/null -w "%{http_code}" https://corvenlabs.org
# Expected: 200

# Database
docker-compose exec postgres pg_isready -U agentix
# Expected: /var/run/postgresql:5432 - accepting connections

# Redis
docker-compose exec redis redis-cli ping
# Expected: PONG
```

### 5.2 Security Validation

```bash
# Check security headers
curl -I https://api.corvenlabs.org

# Verify SSL
curl -I https://corvenlabs.org 2>&1 | grep -i "strict-transport-security"

# Test for XSS (should be sanitized)
curl -X POST https://api.corvenlabs.org/orgs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"<script>alert(1)</script>", "ownerWalletAddress":"0x..."}'

# Test rate limiting (should return 429 after 100 req in 15 min)
for i in {1..110}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://api.corvenlabs.org/health
done
```

### 5.3 End-to-End Tests

```bash
# Full flow test
npm run test:e2e

# Contract test
npm run test:contracts

# Integration test
curl -X POST https://api.corvenlabs.org/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ health }"}'
```

---

## Phase 6: Rollback Procedures

### 6.1 Quick Rollback

```bash
# Rollback to previous version
docker-compose down
docker-compose pull

# Or revert to specific tag
git checkout tags/v1.0.0
docker-compose build
docker-compose up -d
```

### 6.2 Database Rollback

```bash
# Backup before deployment
docker-compose exec postgres pg_dump -U agentix agentix > backup-$(date +%Y%m%d).sql

# Restore if needed
docker-compose exec -T postgres psql -U agentix < backup-20250510.sql
```

---

## Phase 7: Monitoring Setup

### 7.1 Log Aggregation

```bash
# Using CloudWatch Logs agent
sudo yum install -y amazon-cloudwatch-agent

# Configure and start
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```

### 7.2 Metrics Dashboard

**CloudWatch Custom Metrics:**
```bash
# Publish custom metric
aws cloudwatch put-metric-data \
  --metric-name ApiRequests \
  --namespace Agentix \
  --value 1 \
  --unit Count
```

### 7.3 Alerting

**CloudWatch Alarm:**
```bash
# Create alarm for high error rate
aws cloudwatch put-metric-alarm \
  --alarm-name Agentix-High-Error-Rate \
  --alarm-description "Error rate > 5%" \
  --metric-name ErrorRate \
  --namespace Agentix \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

---

## Phase 8: Post-Deployment Verification

### Final Checklist

- [ ] All containers running
- [ ] Health checks passing
- [ ] SSL certificates valid
- [ ] DNS resolving correctly
- [ ] Database migrations applied
- [ ] Environment variables set
- [ ] Rate limiting active
- [ ] Security headers present
- [ ] Logs flowing
- [ ] Metrics accessible
- [ ] Alarms configured
- [ ] Backup strategy active
- [ ] Documentation updated
- [ ] Team notified

### Performance Baseline

Record initial metrics:
```
API Response Time: ___
Database Query Time: ___
Proof Generation Time: ___
Frontend Load Time: ___
```

---

## Quick Reference Commands

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# View logs
docker-compose logs -f [service]

# Restart service
docker-compose restart [service]

# Update images
docker-compose pull && docker-compose up -d

# Check status
docker-compose ps

# DB shell
docker-compose exec postgres psql -U agentix

# Redis CLI
docker-compose exec redis redis-cli

# Clean up
docker system prune -a
```

---

## Contact & Escalation

| Issue | Contact | Response Time |
|-------|---------|---------------|
| Critical Security | Security Team | Immediate |
| Service Down | On-Call Engineer | 15 min |
| Performance | DevOps Lead | 1 hour |
| General | Support | 24 hours |
