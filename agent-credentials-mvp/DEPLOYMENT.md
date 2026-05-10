# AGENTIX Production Deployment Guide

## Quick Start

### 1. Prepare Environment

```bash
# Clone the repository
git clone <your-repo>
cd agent-credentials-mvp

# Copy and configure environment
cp .env.example .env
# Edit .env with your production values
```

### 2. Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_TYPE` | Yes | `postgres` for production |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | 64-character hex string |
| `CORS_ORIGIN` | Yes | Your frontend domain |
| `PRIVATE_KEY` | Yes | Backend wallet private key |
| `RPC_URL` | Yes | Ethereum RPC endpoint |
| `ALCHEMY_API_KEY` | Yes | For blockchain indexing |

### 3. Deploy Options

#### Option A: Docker Compose (Self-hosted)

```bash
# Start all services
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
# Check PostgreSQL is running
docker-compose ps

# View logs
docker-compose logs postgres
```

### Event sync not working
- Verify RPC_URL is accessible
- Check contract addresses are correct
- Ensure ENABLE_EVENT_SYNC=true

### CORS errors
- Verify CORS_ORIGIN matches your frontend URL exactly
- Check for trailing slashes
