# AgentIX Production Checklist

## P0 — Must Fix Before Any Deployment ✅ COMPLETE

- [x] **F-001:** Remove VK fallback in `externalAgent.ts:verifyAuthorizationProof`. Hard-fail when verification_key.json missing.
- [x] **F-002:** Implement JWT/API key verification on WebSocket upgrade handler in `index.ts:198`.
- [x] **F-003:** Add auth middleware to MCP SSE endpoints (`/mcp/sse`, `/mcp/message`) in `mcp/server.ts`.
- [x] **F-004:** Set `WS_PORT=3002` in `docker-compose.yml` and `.env.example`.
- [x] **F-005:** Add startup assertion: `if (NODE_ENV === 'production' && DEV_AUTH_BYPASS === 'true') process.exit(1)`.
- [x] **F-006:** Return session secret in `sessionsSimple.ts` response.
- [x] **F-007:** Rotate Alchemy API key. Remove from `opencode.json` and `.mcp.json`.

## P1 — Must Fix Before Production ✅ COMPLETE

- [x] **F-008:** Fix `frontend/lib/session.ts` imports (added `API_BASE_URL` and `getAuthHeaders` to `api-base.ts`).
- [x] **F-008:** Fix `frontend/components/execute/execution-panel.tsx` imports (added missing types to `lib/types.ts`).
- [x] **F-009:** Move credential secrets from localStorage to Web Crypto API (AES-GCM encryption).
- [x] **F-010:** Add `Secure: true` to all `Set-Cookie` headers in frontend API routes.
- [x] **F-011:** Add path whitelists to `/api/ai/[[...path]]` and `/api/external/[[...path]]` proxy routes.
- [x] **F-012:** Wait for tx receipt in `chat-execution-panel.tsx` before calling `completeProvisioning()`.
- [x] **F-013:** Force Redis-backed rate limiting in production (express-rate-limit always used).
- [x] **F-015:** Encrypt AI API keys at rest using ENCRYPTION_KEY (AES-256-GCM).
- [x] **F-016:** Replace `BigInt(Math.floor(parseFloat(amountEth) * 10 ** 18))` with BigInt string parsing.
- [x] **F-017:** Add `SameSite=Strict` on auth cookies for CSRF protection.
- [x] **F-034:** `await` the logout fetch before redirect.

## P2 — Should Fix Before Production ✅ COMPLETE

- [x] **F-019:** Require authentication for GET `/orgs` endpoint.
- [x] **F-021:** Fix `agents.ts:143` compilation error (import blockchain service).
- [x] **F-022:** Update `AuditLogEntry` type in `audit.ts` to accept string actions.
- [x] **F-023:** Reduce session TTL from 14 days to 2 days.
- [x] **F-024:** Reduce refresh token TTL from 30 days to 7 days with rotation.
- [x] **F-025:** Add LRU eviction to encrypted wallet cache in `wallet-manager.ts` (max 100).
- [x] **F-026:** Use `rejectUnauthorized: true` for PostgreSQL SSL in production.
- [x] **F-027:** Fail if `AGENT_CREDENTIALS_API_URL` not set in production.
- [x] **F-029:** Add startup validation for all required production env vars.
- [x] **F-030:** Fix stale path in `ngrok-setup.ps1`.
- [x] **F-041:** Add frontend health check to `docker-compose.yml`.
- [x] **F-046:** Add `CORS_ORIGIN` default to `docker-compose.prod.yml`.
- [x] Added PostgreSQL backup script (`scripts/backup-db.sh`).
- [x] Added deployment env validation in `deploy-production.sh`.

## V1 Security Hardening ✅ COMPLETE

- [x] **F-047:** Fixed SQL injection in `merkle.ts` — `orgId` now parameterized via `$1`
- [x] **F-048:** Fixed SQL injection in `merkle.ts` — `nodesTable` validated as safe identifier
- [x] **F-049:** Fixed SQL injection in `proofQueue.ts` — via `merkle.ts` parameterization
- [x] **F-050:** Fixed `revocationTree.ts` — changed SQLite `?` to PostgreSQL `$1`
- [x] **F-051:** Fixed `revocationTree.ts` — changed `require()` to ES module `import`
- [x] **F-052:** Fixed `frontend/lib/session.ts` — floating-point `ethToWei()` now uses string-based decimal parsing
- [x] **F-053:** Fixed `fastProver.ts` — proof cache key now SHA-256 hash (not raw JSON with secrets)
- [x] **F-054:** Fixed `sessionKey.ts` — dev default master key rejected when `NODE_ENV !== "development"`
- [x] **F-055:** Fixed `env.ts` — added production validation for `ENCRYPTION_KEY` and `MCP_API_KEY`

## Infrastructure — Required for Production ✅ COMPLETE

- [x] Fix CI: remove `continue-on-error: true` from TypeScript checks
- [x] Fix CI: add secret scanning step
- [x] Fix CI: add job dependencies (lint → build → docker)
- [x] Fix CI: add deploy-preview job for PRs
- [x] Add PostgreSQL backup automation
- [x] Add startup env validation for production
- [x] Add deployment env validation

## Infrastructure — Remaining Work

- [ ] Add monitoring: Prometheus metrics export + Grafana dashboards
- [ ] Add log aggregation: ELK, CloudWatch, or Datadog
- [ ] Add alerting: PagerDuty, Slack webhook, or CloudWatch alarms
- [ ] Add distributed tracing: OpenTelemetry or equivalent
- [ ] Push Docker images to ECR on main branch
- [ ] Add E2E test job to CI
- [ ] Add contract test coverage reporting
- [ ] Add database migration step to deploy-production.sh (currently runs via Docker)
- [ ] Add disaster recovery documentation

## Security Hardening — Remaining Work

- [ ] Implement key rotation for ENCRYPTION_KEY and SESSION_ENCRYPTION_KEY
- [ ] Add HSM or KMS for PRIVATE_KEY in production
- [ ] Implement circuit breaker for mass nullifier usage detection
- [ ] Add on-chain pause mechanism triggered by anomaly detection
- [ ] Implement session key expiry enforcement (currently only checked on validation)
- [ ] Add gas estimation safety margin for UserOp submission
- [ ] Implement transaction timeout/cancellation for stuck txs
- [ ] Add chain reorg detection and event re-indexing
- [ ] Implement Webhook HMAC verification for agent callbacks
- [ ] Add request signing for backend-to-backend communication

## Testing — Remaining Work

- [ ] Add integration tests for full provision → session → execute flow
- [ ] Add tests for concurrent session spending (race condition detection)
- [ ] Add tests for event sync recovery after backend restart
- [ ] Add tests for rate limiting across multiple instances
- [ ] Add tests for WebSocket authentication
- [ ] Add tests for MCP endpoint authentication
- [ ] Add load tests for 1000 concurrent agents
- [ ] Add chaos testing for RPC/DB/Redis failures
