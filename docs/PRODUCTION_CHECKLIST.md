# Production Checklist

## Security

- [ ] **Private keys**: Never in code. Use env vars + vault. Rotate compromised keys.
- [ ] **Encryption keys**: `ENCRYPTION_KEY` and `SESSION_ENCRYPTION_KEY` generated with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Stored in secrets manager, not `.env` files.
- [ ] **Rate limiting**: Production uses 100 req/15min. Adjust via `createRateLimitMiddleware()` in `backend/src/index.ts`.
- [ ] **CORS**: Set `CORS_ORIGIN` to your frontend domain. Never `*` in production.
- [ ] **Helmet**: Enabled by default. Verify `x-powered-by` is disabled.
- [ ] **Body size limit**: 32kb JSON limit. Increase only if needed for specific endpoints.
- [ ] **SQL injection**: All queries use parameterized statements. No string concatenation.
- [ ] **Session revocation**: Credential revocation updates Sparse Merkle tree on-chain. Verify nullifier check works.
- [ ] **Budget enforcement**: `BudgetTracker.tryDeduct()` uses atomic DB updates or Redis Lua script. No race conditions.
- [ ] **Permission defaults**: `Number(x) || 0` not `Number(x) || 255`. Fail-closed.
- [ ] **Audit logging**: Every Covenant action logged to `audit_log` table. No missing entries.

## Infrastructure

- [ ] **PostgreSQL**: Connection pooling (default 20). SSL mode for cloud DBs.
- [ ] **Redis**: Optional. Enables async proof generation and faster budget tracking.
- [ ] **Docker**: `docker-compose.yml` available for local dev. `docker-compose.prod.yml` for production.
- [ ] **Nginx**: Reverse proxy config in `nginx/` directory.
- [ ] **Environment validation**: Backend validates required env vars on startup.

## Monitoring

- [ ] **Health endpoint**: `GET /health` returns status + metrics.
- [ ] **Metrics endpoint**: `GET /metrics` (protected by `METRICS_API_KEY` in production).
- [ ] **Error tracking**: `errorTracker.captureError()` logs all errors with context.
- [ ] **Audit logs**: Queryable via `GET /audit` with filters (orgId, action, resourceType).
- [ ] **Event sync**: `ENABLE_EVENT_SYNC=true` polls chain for on-chain events.

## Smart Contracts

- [ ] **All 8 contracts deployed** on Base Sepolia (see MEMORY.md for addresses).
- [ ] **36/36 tests passing** before any deployment.
- [ ] **UUPS proxy pattern** for upgradeability. Never redeploy — upgrade in place.
- [ ] **Custom errors** for gas optimization. No `require` strings.
- [ ] **ReentrancyGuard** on all external calls that transfer value.
- [ ] **Ownership transfer** via `transferOwnership()` for UUPS proxies.

## Integration

- [ ] **COVENANT V4 contracts** verified on Base Sepolia explorer.
- [ ] **Permission bitmask mapping** correct: 9 actions → AGENTIX bits.
- [ ] **Audit trail** consolidated: all Covenant actions in `audit_log`.
- [ ] **Session validation** checks: expiry, revocation (nullifier), permission bits, budget.

## Deployment

- [ ] **RPC URL**: Alchemy or Infura Base Sepolia endpoint.
- [ ] **Bundler URL**: Same as RPC for Alchemy users.
- [ ] **Chain ID**: 84532 (Base Sepolia). Never mainnet without thorough testing.
- [ ] **Contract addresses**: All in `backend/.env`. Verify with `deploy-output.json`.
- [ ] **Database migrations**: Run `backend/src/migrations.ts` on first deploy.

## Pre-Launch

- [ ] Run `node scripts/demo-covenant-flow.mjs` end-to-end.
- [ ] Run all 7 security tests (see SECURITY_REPORT.md).
- [ ] Verify audit trail contains: user, org, agent, session, credential, permission, task, settlement, tx hash, timestamp.
- [ ] Test session revocation: create → revoke → verify rejection.
- [ ] Test budget enforcement: budget=100, task=500 → fail.
- [ ] Test concurrent requests: budget=100, two requests=80 each → second fails.
- [ ] Test expired session: create → wait → verify rejection.
- [ ] Load test: 100 concurrent requests, verify rate limiting works.
