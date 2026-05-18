# AGENTIX Production Deployment Guide

## Quick Start

### 1. Prepare Environment

```bash
# Clone the repository
git clone <your-repo>
cd agent-credentials-mvp

# Copy and configure environment
cp .env.example .env
# Edit .env with your production values and deployed frontend/backend URLs
```

### 2. Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DB_SSL_MODE` | Yes | `require` for AWS RDS |
| `ENCRYPTION_KEY` | Yes | 64-character hex string for stored agent secrets |
| `CORS_ORIGIN` | Yes | Your frontend domain |
| `AGENT_CREDENTIALS_API_URL` | Yes | Backend public URL used by frontend server routes |
| `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL` | Yes | Backend public URL exposed to frontend |
| `METRICS_API_KEY` | Recommended | Protects `/metrics` in production |
| `PRIVATE_KEY` | Yes | Backend wallet private key |
| `RPC_URL` | Yes | Ethereum RPC endpoint |
| `BUNDLER_URL` | Yes | ERC-4337 bundler endpoint |
| `REDIS_URL` | Recommended | Redis or ElastiCache connection URL |

### 3. Deploy Options

#### Option A: Docker Compose (Self-hosted)

```bash
# Start all services (expects external DATABASE_URL, e.g. AWS RDS)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

#### Option B: Railway (Recommended)

```bash
# Install Railway CLI
curl -fsSL https://railway.app/install.sh | sh

# Login and deploy
railway login
railway link
railway up

# Add PostgreSQL and Redis services in dashboard
railway add --database postgres
railway add --database redis
```

#### Option C: VPS/Cloud Server

```bash
# On your server
git clone <repo>
cd agent-credentials-mvp

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Deploy
docker-compose up -d
```

### 4. Verify Deployment

```bash
# Health check
curl https://api.yourdomain.com/health

# Metrics (protected)
curl -H "Authorization: Bearer $METRICS_API_KEY" https://api.yourdomain.com/metrics
```

### 5. Post-Deployment

- Configure DNS A record pointing to server IP
- Set up SSL certificates (handled by Railway or use Certbot)
- Configure webhook secrets in Alchemy dashboard
- Test all critical flows

## Troubleshooting

### Database connection failed
```bash
# Verify the RDS endpoint is reachable from the host/container
nc -vz <your-rds-endpoint> 5432

# Confirm security groups allow inbound traffic from your app
# Confirm DATABASE_URL credentials and ssl mode
```

### Event sync not working
- Verify RPC_URL is accessible
- Check contract addresses are correct
- Ensure ENABLE_EVENT_SYNC=true

### CORS errors
- Verify CORS_ORIGIN matches your frontend URL exactly
- Check for trailing slashes
