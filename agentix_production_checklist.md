# AgentIX V1 Production Checklist

## Pre-Deployment

### Infrastructure ✅

- [x] PostgreSQL database provisioned (RDS or equivalent)
- [x] Redis instance provisioned (ElastiCache or equivalent)
- [x] Docker images built and pushed
- [x] Load balancer configured (nginx/ALB)
- [x] TLS certificates obtained
- [x] DNS configured

### Environment Variables ✅

- [x] `DATABASE_URL` — PostgreSQL connection string
- [x] `RPC_URL` — Alchemy/Infura RPC endpoint
- [x] `PRIVATE_KEY` — Operator wallet (use KMS in production)
- [x] `SESSION_ENCRYPTION_KEY` — 64 char hex
- [x] `ENCRYPTION_KEY` — 64 char hex (for API key encryption)
- [x] `MCP_API_KEY` — Random token for MCP auth
- [x] `SESSION_MANAGER_ADDRESS` — Deployed contract
- [x] `CREDENTIAL_REGISTRY_ADDRESS` — Deployed contract
- [x] `AGENT_WALLET_FACTORY_ADDRESS` — Deployed contract
- [x] `VERIFIER_ADDRESS` — Deployed contract
- [x] `CORS_ORIGIN` — Production domain
- [x] `NODE_ENV` — production

### Smart Contracts ✅

- [x] All contracts deployed on Base Sepolia
- [x] Contract addresses verified on block explorer
- [x] ProxyAdmin ownership secured
- [x] Upgrade authorization restricted to owner
- [x] Pausable functionality tested
- [x] Emergency controls verified

### Security ✅

- [x] SQL injection vulnerabilities fixed (F-047, F-048, F-049, F-050)
- [x] Floating-point wei conversion fixed (F-052)
- [x] Proof cache secret leakage fixed (F-053)
- [x] Dev master key restricted (F-054)
- [x] Production env validation added (F-055)
- [x] JWT RS256 with key rotation
- [x] AES-256-GCM encryption at rest
- [x] Cookie security (Secure, SameSite=Strict)
- [x] Rate limiting with Redis
- [x] CORS configured
- [x] WebSocket authentication (F-002)
- [x] MCP SSE authentication (F-003)
- [x] Path whitelists on proxies (F-011)

### Testing ✅

- [x] Contract tests passing (36/36)
- [x] Backend tests passing
- [x] MCP tests passing
- [x] SQL injection regression tests
- [x] Floating-point conversion tests

## Deployment Steps

### 1. Database Setup

```bash
# Run migrations
cd backend && npm run migrate

# Verify schema
psql $DATABASE_URL -c "\dt"
```

### 2. Contract Verification

```bash
# Verify all contracts on Base Sepolia
cd contracts && npx hardhat run scripts/verify-all.ts --network baseSepolia
```

### 3. Backend Deployment

```bash
# Build
cd backend && npm run build

# Start (Docker)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend

# Verify health
curl http://localhost:3001/health
```

### 4. Frontend Deployment

```bash
# Build
cd frontend && npm run build

# Start (Docker)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d frontend

# Verify
curl http://localhost:3000
```

### 5. Verify Event Sync

```bash
# Check event sync is running
curl http://localhost:3001/health | jq .eventSync

# Check cursor is advancing
psql $DATABASE_URL -c "SELECT * FROM event_sync_cursor"
```

## Post-Deployment Verification

### Health Checks

- [ ] Backend health endpoint returns 200
- [ ] Frontend loads successfully
- [ ] PostgreSQL connection stable
- [ ] Redis connection stable
- [ ] RPC connection stable
- [ ] Event sync advancing

### Functional Tests

- [ ] Create organization via API
- [ ] Create agent via API
- [ ] Issue credential
- [ ] Create session
- [ ] Execute transaction via session
- [ ] Revoke session
- [ ] Verify delegation works
- [ ] Verify capability verification works

### Security Tests

- [ ] Rate limiting active
- [ ] CORS headers correct
- [ ] Cookie security flags set
- [ ] JWT validation working
- [ ] API key authentication working
- [ ] MCP SSE authentication working

### Monitoring

- [ ] Logs being collected
- [ ] Metrics being exported (if configured)
- [ ] Alerts configured for critical failures
- [ ] Database backups scheduled

## Known Limitations (V1)

### Non-Blocking

1. **TOCTOU on session spending** — Acceptable at < 1000 sessions/day
2. **No token revocation** — Tokens valid until expiry
3. **No SSRF protection** — External agent endpoints not validated
4. **No chain reorg detection** — Event sync replays from cursor
5. **Event sync not idempotent** — Concurrent calls could race
6. **No multi-tenancy DB isolation** — Shared schema with org_id filter

### Documented as V2

1. Atomic session spending (SQL-level)
2. Token revocation list
3. SSRF protection for external endpoints
4. Chain reorg detection
5. Event sync mutex
6. Database-level tenant isolation
7. SSO/SAML integration
8. Custom RBAC roles

## Rollback Plan

### If Backend Fails

```bash
# Stop new traffic
docker-compose stop backend

# Restart with previous version
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend

# Verify
curl http://localhost:3001/health
```

### If Database Issues

```bash
# Restore from backup
pg_restore -d agentix backup.dump

# Restart backend
docker-compose restart backend
```

### If Contracts Need Upgrade

```bash
# Deploy new implementation
cd contracts && npx hardhat run scripts/deploy.ts --network baseSepolia

# Upgrade proxy (owner only)
# Call upgradeToAndCall on proxy admin
```

## Support Contacts

- **Infrastructure**: DevOps team
- **Smart Contracts**: Protocol team
- **Backend**: Backend team
- **Frontend**: Frontend team
- **Security**: Security team

## Documentation Links

- [Implementation Plan](agentix_v1_implementation_plan.md)
- [Runtime Integrity](agentix_runtime_integrity.md)
- [Architecture](agentix_architecture.md)
- [Test Plan](agentix_test_plan.md)
- [Developer Guide](agentix_developer_guide.md)
