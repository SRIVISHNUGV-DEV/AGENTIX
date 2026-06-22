# AgentIX Runtime Integrity Report

**Audit Date:** 2026-06-21
**Auditor:** Principal Protocol Engineer (AgentIX Runtime Integrity Audit)
**Scope:** End-to-end offchain systems interacting with AgentIX smart contracts
**Contracts on Base Sepolia:** Groth16Verifier, CredentialRegistry, SessionManager, AgentWalletFactory, AgentWallet (impl), CapabilityRegistry, DelegationManager, EntryPoint (0x4337)

---

## Executive Summary

AgentIX has a well-designed smart contract layer with solid defense-in-depth patterns (whitelist-gated execution, session-scoped spending limits, nullifier replay protection, emergency pause). The offchain systems have been hardened with all critical and high-severity findings addressed.

**Total Findings:** 46 (7 CRITICAL, 10 HIGH, 13 MEDIUM, 16 LOW)
**Status:** All P0 and P1 fixes applied. P2 and infrastructure fixes applied.

---

## Score Summary (Post-Fix)

| Dimension | Before | After | Rationale |
|-----------|--------|-------|-----------|
| Smart Contract Readiness | 8/10 | 8/10 | No contract changes needed |
| Backend Readiness | 4/10 | **8/10** | VK hard-fail, WS auth, MCP auth, prod env validation |
| Frontend Readiness | 3/10 | **7/10** | Compile errors fixed, Secure cookies, proxy whitelists |
| Data Integrity | 5/10 | **7/10** | Encrypted secrets, LRU cache, encrypted API keys |
| Runtime Safety | 4/10 | **8/10** | WS_PORT fix, tx confirmation, rate limiting |
| Production Readiness | 3/10 | **7/10** | CI hardened, deployment validation, monitoring gaps remaining |
| **Overall** | **4.5/10** | **7.5/10** | |

---

## Changes Applied

### P0 Critical (7 fixes)
- **F-001:** VK fallback removed — hard-fail on missing verification key
- **F-002:** WebSocket auth — verify agent exists in DB + token matches
- **F-003:** MCP SSE auth — require MCP_API_KEY in production
- **F-004:** WS_PORT=3002 (was conflicting with HTTP 3001)
- **F-005:** DEV_AUTH_BYPASS blocked in production at startup
- **F-006:** Session secret returned in sessionsSimple.ts
- **F-007:** Alchemy API key removed from opencode.json and .mcp.json

### P1 High (10 fixes)
- **F-008:** Fixed 3 frontend compile errors (session.ts, types.ts, mock-api.ts)
- **F-009:** Credentials encrypted in localStorage (Web Crypto AES-GCM)
- **F-010:** Secure flag on all auth/org cookies
- **F-011:** Path whitelists on /api/ai and /api/external proxies
- **F-012:** Wait for tx receipt before provisioning success
- **F-013:** express-rate-limit always used in production
- **F-015:** AI API keys encrypted at rest (AES-256-GCM)
- **F-016:** Fixed floating-point wei conversion
- **F-017:** SameSite=Strict on auth cookies
- **F-034:** Logout awaits fetch before redirect

### P2 Medium (13 fixes)
- **F-019:** Org listing requires authentication
- **F-021:** Fixed agents.ts compilation error
- **F-022:** AuditLogEntry type accepts string actions
- **F-023:** Session TTL reduced to 2 days
- **F-024:** Refresh token TTL reduced to 7 days
- **F-025:** LRU eviction on wallet cache (max 100)
- **F-026:** SSL rejectUnauthorized=true in production
- **F-027:** Frontend fails if API URL not set in production
- **F-029:** Added startup env validation for production
- **F-030:** ngrok-setup.ps1 path fixed
- **F-041:** Frontend health check added to docker-compose.yml
- **F-046:** CORS_ORIGIN default in docker-compose.prod.yml
- Added PostgreSQL backup script

### Infrastructure
- CI: Removed continue-on-error on TypeScript checks
- CI: Added secret scanning step
- CI: Added job dependencies (lint → build → docker)
- CI: Added deploy-preview job for PRs
- Docker: WS_PORT, CORS_ORIGIN added to prod override
- Added MCP_API_KEY and WS_PORT to .env.example
- Added deployment env validation in deploy-production.sh

---

## Findings

### F-01: DEV_AUTH_BYPASS Bypasses All Authentication
- **Severity:** CRITICAL
- **Affected Components:** `backend/src/middleware/auth.ts`, `backend/src/services/actionAuth.ts`, `backend/src/integrations/covenant/middleware.ts`
- **Root Cause:** Three middleware files check `process.env.DEV_AUTH_BYPASS === 'true'` and skip all authentication/authorization when set
- **Failure Scenario:** Accidental deployment with DEV_AUTH_BYPASS=true gives any request full admin access — no JWT, no signature verification, no session validation
- **Attack Scenario:** Attacker sends any request with `DEV_AUTH_BYPASS=true` in the environment. Even if the env var isn't set per-request, a single misconfigured deployment is catastrophic
- **Blast Radius:** Complete authentication bypass. Any user can act as any organization, create/destroy agents, issue/revoke credentials, drain wallets
- **Dependency Impact:** Affects every authenticated API endpoint (20+ routes)
- **Proposed Solution:** Remove DEV_AUTH_BYPASS entirely. If dev convenience is needed, gate behind `NODE_ENV === 'development'` AND a separate flag, with startup warning
- **Priority:**
  - Immediate: Remove from production deployments, add startup warning if detected
  - Short Term: Replace with `NODE_ENV`-gated dev-only helper
  - Long Term: Remove entirely, use test fixtures for dev auth

### F-02: WebSocket Authentication is Placeholder
- **Severity:** CRITICAL
- **Affected Components:** `backend/src/index.ts:198`
- **Root Cause:** WebSocket handler only checks `token` query parameter, no JWT verification. Comment says "In production, verify JWT or API key"
- **Failure Scenario:** Any client connects to the WebSocket and receives real-time agent events and can send task results
- **Attack Scenario:** Attacker connects to WebSocket, receives all agent communications, injects fake task results, impersonates agents
- **Blast Radius:** Real-time agent communication compromised. Attacker can intercept task dispatches, inject malicious results, disrupt agent coordination
- **Dependency Impact:** Affects all real-time agent communication (agentComms.ts, agentReconnect.ts, agentLoop.ts)
- **Proposed Solution:** Implement JWT or API key verification on WebSocket connection upgrade. Reject connections without valid auth
- **Priority:**
  - Immediate: Add JWT verification on WS connection handshake
  - Short Term: Implement proper auth middleware for WS
  - Long Term: Consider mTLS or signed message protocol for agent WS connections

### F-03: Verification Key Fallback Allows Invalid Proofs
- **Severity:** CRITICAL
- **Affected Components:** `backend/src/services/externalAgent.ts:1289`
- **Root Cause:** `verifyAuthorizationProof` method falls back to "off-chain checks" if verification key file is not available
- **Failure Scenario:** Missing VK file causes proof verification to be skipped entirely — any proof is treated as valid
- **Attack Scenario:** Attacker submits fabricated proof. If VK file is missing from the deployment, the proof passes verification. Attacker gains unauthorized access to agent execution
- **Blast Radius:** Complete ZK proof bypass. Any fabricated proof grants full agent execution permissions
- **Dependency Impact:** Affects all ZK-authenticated agent operations (externalAgent.ts, mcp/server.ts proof verification)
- **Proposed Solution:** Fail-closed: if VK is unavailable, reject the proof. Never fall back to "trust off-chain checks" on a security-critical path
- **Priority:**
  - Immediate: Change fallback to reject with error
  - Short Term: Add VK availability check at startup
  - Long Term: Embed VK hash in deployment config, verify at boot

### F-04: WS_PORT Conflict Causes Startup Failure
- **Severity:** CRITICAL
- **Affected Components:** `backend/src/index.ts:43`
- **Root Cause:** WS_PORT defaults to "3001" same as HTTP PORT. Docker compose does not set WS_PORT
- **Failure Scenario:** HTTP server binds port 3001, WebSocket server tries same port, fails. Backend starts without WS capability
- **Attack Scenario:** N/A (availability issue)
- **Blast Radius:** All real-time agent communication fails silently. WebSocket endpoints return nothing
- **Dependency Impact:** Affects agentComms.ts, agentReconnect.ts, agentLoop.ts — all real-time features
- **Proposed Solution:** Set WS_PORT default to 3002 in code. Add startup validation that WS_PORT !== PORT
- **Priority:**
  - Immediate: Change default to 3002, add docker-compose.env for WS_PORT=3002
  - Short Term: Validate PORT !== WS_PORT at startup, fail-fast with clear error
  - Long Term: Consider sharing HTTP/WS on same port via upgrade detection

### F-05: Credential Secrets in Plaintext localStorage
- **Severity:** HIGH
- **Affected Components:** `frontend/lib/credential-client.ts`
- **Root Cause:** Raw Poseidon credential secrets stored in plaintext localStorage with explicit warning: "WARNING: In production, use secure storage"
- **Failure Scenario:** Any XSS vulnerability on the frontend immediately exposes all credential secrets for all agents
- **Attack Scenario:** Attacker injects XSS via any unsanitized input (chat message, metadata field). Reads localStorage, extracts all credential secrets. Can forge ZK proofs for any credential
- **Blast Radius:** All agent credentials compromised. Attacker can forge proofs, impersonate any agent
- **Dependency Impact:** Affects all ZK proof operations, credential verification, session creation
- **Proposed Solution:** Use Web Crypto API with server-stored encryption key, or encrypted IndexedDB. Never store raw secrets in localStorage
- **Priority:**
  - Immediate: Move to encrypted storage
  - Short Term: Use Web Crypto API with server-derived key
  - Long Term: Implement secure enclave or hardware-backed storage

### F-06: Missing CSRF Protection on Dashboard Operations
- **Severity:** HIGH
- **Affected Components:** All `frontend/components/dashboard/*` components, `frontend/lib/dashboard-api.ts`
- **Root Cause:** All state-changing dashboard operations (POST/DELETE for policies, whitelists, agents) lack CSRF tokens
- **Failure Scenario:** Attacker hosts a malicious page that makes authenticated requests to the backend using the victim's cookie
- **Attack Scenario:** Victim (org admin) visits attacker's page. Page auto-submits DELETE requests to remove whitelist entries, modify policies, create rogue agents. All using victim's authenticated session
- **Blast Radius:** Any admin action can be performed by attacker: remove whitelisted parties, modify spending policies, create/delete agents
- **Dependency Impact:** Affects all dashboard CRUD operations (15+ endpoints)
- **Proposed Solution:** Add CSRF tokens to all state-changing requests. Use SameSite=Strict on auth cookies
- **Priority:**
  - Immediate: Set SameSite=Strict on ac_session cookie
  - Short Term: Implement CSRF token scheme
  - Long Term: Use double-submit cookie pattern or custom header verification

### F-07: Open API Proxies Without Path Validation
- **Severity:** HIGH
- **Affected Components:** `frontend/app/api/ai/[[...path]]/route.ts`, `frontend/app/api/external/[[...path]]/route.ts`
- **Root Cause:** Catch-all Next.js API routes forward any request under /api/ai/* and /api/external/* to backend without path validation
- **Failure Scenario:** Attacker accesses internal backend endpoints that were never intended to be public
- **Attack Scenario:** Attacker sends request to /api/external/internal/debug or /api/ai/admin/config. If backend has any such internal endpoints, they're exposed through the proxy
- **Blast Radius:** Depends on what backend endpoints exist under /ai/ and /external/. Could expose admin functions, debug endpoints, or internal APIs
- **Dependency Impact:** Affects all backend endpoints under /ai/* and /external/*
- **Proposed Solution:** Whitelist specific backend paths in the proxy. Only forward known-good routes
- **Priority:**
  - Immediate: Audit all /ai/* and /external/* backend routes, whitelist safe ones
  - Short Term: Implement path allowlist in proxy
  - Long Term: Use dedicated API gateway with route-level auth

### F-08: Premature Provisioning Success
- **Severity:** HIGH
- **Affected Components:** `frontend/components/execute/chat-execution-panel.tsx`
- **Root Cause:** After calling `depositToAgent()`, immediately calls `completeProvisioning()` without waiting for on-chain confirmation
- **Failure Scenario:** Deposit transaction reverts or is pending. Backend thinks provisioning is complete, creates session with insufficient funds
- **Attack Scenario:** Attacker triggers provisioning, wallet reports "success" (pending tx), backend creates session. Agent attempts to execute with 0 balance
- **Blast Radius:** Agent appears provisioned but cannot execute transactions. User confusion, failed operations
- **Dependency Impact:** Affects all agent provisioning flows
- **Proposed Solution:** Poll for transaction receipt confirmation before calling completeProvisioning. Add on-chain balance check
- **Priority:**
  - Immediate: Add tx.wait(1) before completeProvisioning
  - Short Term: Poll chain for balance confirmation
  - Long Term: Implement webhook/polling pattern for on-chain state changes

### F-09: Floating-Point Precision in ETH Conversion
- **Severity:** HIGH
- **Affected Components:** `frontend/components/wallet/wallet-provider.tsx`
- **Root Cause:** `BigInt(Math.floor(parseFloat(amountEth) * 10 ** 18))` — IEEE 754 floating-point cannot precisely represent all decimal values
- **Failure Scenario:** Amounts like "0.1" or "1.1" ETH lose precision in wei conversion, resulting in slightly wrong transaction amounts
- **Attack Scenario:** Attacker crafts amount that rounds down to 0 wei, or rounds up to exceed intended transfer. Edge case: amountEth="1.000000000000000000001" could lose the fractional part entirely
- **Blast Radius:** Incorrect ETH amounts in transactions. Could overpay or underpay
- **Dependency Impact:** Affects all wallet operations: deposits, transfers, gas funding
- **Proposed Solution:** Use string-based wei conversion: parse ETH as string, split at decimal, compute wei using integer arithmetic
- **Priority:**
  - Immediate: Replace with string-based conversion
  - Short Term: Add unit tests for edge-case amounts
  - Long Term: Use a proper BigDecimal library

### F-10: In-Memory Rate Limiter Not Shared
- **Severity:** MEDIUM
- **Affected Components:** `backend/src/middleware/security.ts`, `backend/src/middleware/rateLimiter.ts`
- **Root Cause:** Production Docker runs 2 backend replicas, but rate limiter falls back to in-memory when Redis is unavailable
- **Failure Scenario:** Each backend instance has independent rate limit counters. Attacker sends 100 requests/min to each instance, effectively bypassing the 100/min global limit
- **Attack Scenario:** Attacker sends 50 requests/min per instance. Total 100/min globally (within limits), but each instance sees only 50. If limit is 100/instance, attacker can send 200/min total
- **Blast Radius:** Rate limiting effectively halved per additional replica. DoS attacks more feasible
- **Dependency Impact:** Affects all rate-limited endpoints
- **Proposed Solution:** Ensure Redis is always available in production. If Redis fails, fail-closed (reject) rather than fail-open (allow)
- **Priority:**
  - Immediate: Add Redis health check to backend startup, fail if Redis unavailable
  - Short Term: Implement shared rate limiting via Redis with proper fallback
  - Long Term: Use Redis Cluster for HA rate limiting

### F-11: Challenge Store is In-Memory Only
- **Severity:** MEDIUM
- **Affected Components:** `backend/src/routes/authFlow.ts`
- **Root Cause:** Challenge-response store is a plain JavaScript Map — lost on restart, not replicated across instances
- **Failure Scenario:** Backend restarts mid-auth-flow. All pending challenges are lost. Clients receive "challenge not found" errors
- **Attack Scenario:** N/A (availability issue, not security)
- **Blast Radius:** All in-progress auth flows fail after restart. Users must restart authentication
- **Dependency Impact:** Affects all ZK challenge-response authentication
- **Proposed Solution:** Store challenges in Redis or database with TTL
- **Priority:**
  - Immediate: Document as known limitation
  - Short Term: Move to Redis-backed store
  - Long Term: Implement distributed challenge store with TTL

### F-12: Session Secret Never Returned to Client
- **Severity:** MEDIUM
- **Affected Components:** `backend/src/routes/sessionsSimple.ts:56`
- **Root Cause:** Server generates random secret internally but never returns it to client. Client cannot generate ZK proofs for this session
- **Failure Scenario:** Session is created on-chain but client has no secret to prove membership in the credential tree
- **Attack Scenario:** N/A (functionality issue)
- **Blast Radius:** Sessions created via the "simple" flow are unusable for ZK proof generation
- **Dependency Impact:** Affects all users of the simple session creation endpoint
- **Proposed Solution:** Either return the secret to the client (encrypted), or generate the proof server-side and return it
- **Priority:**
  - Immediate: Document as known limitation
  - Short Term: Generate proof server-side in the simple flow
  - Long Term: Align simple flow with full ZK flow

### F-13: AI API Keys Stored in Plaintext
- **Severity:** MEDIUM
- **Affected Components:** `backend/src/routes/ai.ts:119`
- **Root Cause:** AI agent API keys stored as plaintext in the database (`apiKey || null`)
- **Failure Scenario:** Database compromise exposes all AI provider API keys
- **Attack Scenario:** Attacker gains DB access, extracts API keys for OpenAI, Anthropic, etc. Uses keys for unauthorized API calls, charges to victim's accounts
- **Blast Radius:** All AI provider accounts compromised. Financial loss, potential abuse
- **Dependency Impact:** Affects all AI agent operations
- **Proposed Solution:** Encrypt API keys at rest using the existing ENCRYPTION_KEY infrastructure (same pattern as vault credentials)
- **Priority:**
  - Immediate: Encrypt before storage, decrypt on read
  - Short Term: Add migration to encrypt existing plaintext keys
  - Long Term: Use HSM-backed encryption for API keys

### F-14: MCP SSE Endpoints Unauthenticated
- **Severity:** MEDIUM
- **Affected Components:** `backend/src/mcp/server.ts`
- **Root Cause:** `/mcp/sse` and `/mcp/message` endpoints have no authentication
- **Failure Scenario:** Any client can connect to MCP SSE and receive all agent data
- **Attack Scenario:** Attacker connects to MCP SSE, receives agent state, capabilities, delegations. Can call MCP tools without authentication
- **Blast Radius:** All MCP tools accessible without auth. Agent data exposed
- **Dependency Impact:** Affects all MCP tool operations (15+ tools)
- **Proposed Solution:** Require API key or JWT on MCP SSE connections
- **Priority:**
  - Immediate: Add auth middleware to MCP routes
  - Short Term: Implement MCP-specific auth (API key header)
  - Long Term: Integrate with Agentix auth flow

### F-15: No CSRF Protection on State-Changing Frontend Operations
- **Severity:** MEDIUM
- **Affected Components:** `frontend/lib/dashboard-api.ts`, all dashboard components
- **Root State:** All POST/DELETE dashboard operations read auth token from `document.cookie` and send it as Bearer token. No CSRF protection
- **Failure Scenario:** XSS or MITM can steal the auth token and perform any admin action
- **Attack Scenario:** Attacker injects XSS, reads `document.cookie` for `ac_session`, uses it to call dashboard APIs directly
- **Blast Radius:** Full admin access if XSS exists
- **Dependency Impact:** Affects all dashboard operations
- **Proposed Solution:** Use SameSite=Strict cookies (no JS access), or add CSRF token layer
- **Priority:**
  - Immediate: Set SameSite=Strict on ac_session
  - Short Term: Implement CSRF tokens
  - Long Term: Use HttpOnly+Secure+SameSite=Strict cookies exclusively

### F-16: No Secure Flag on Auth Cookies
- **Severity:** MEDIUM
- **Affected Components:** `frontend/app/api/auth/login/route.ts`, `frontend/app/api/auth/register/route.ts`
- **Root Cause:** Auth cookie set with `httpOnly: true` but no `secure: true` flag
- **Failure Scenario:** Cookie transmitted over HTTP, vulnerable to interception
- **Attack Scenario:** MITM on HTTP connection intercepts the auth cookie, gains full session access
- **Blast Radius:** Session hijacking on any HTTP connection
- **Dependency Impact:** Affects all authenticated operations
- **Proposed Solution:** Add `secure: true` when NODE_ENV=production. Add `sameSite: 'strict'`
- **Priority:**
  - Immediate: Add secure flag in production
  - Short Term: Add SameSite=Strict
  - Long Term: Enforce HTTPS-only in production

### F-17: 3 Frontend Compile Errors
- **Severity:** MEDIUM
- **Affected Components:** `frontend/lib/session.ts`, `frontend/components/execute/execution-panel.tsx`
- **Root Cause:** Missing exports and types — incomplete refactoring
- **Failure Scenario:** TypeScript compilation may skip these files (continue-on-error in CI), resulting in runtime errors
- **Attack Scenario:** N/A
- **Blast Radius:** Session management and execution panel features may not work correctly
- **Dependency Impact:** Affects agent execution UI and session management
- **Proposed Solution:** Fix imports, add missing types and functions
- **Priority:**
  - Immediate: Fix compile errors
  - Short Term: Add TypeScript strict mode to CI (remove continue-on-error)
  - Long Term: Enable TypeScript in CI build step as hard gate

### F-18: Alchemy API Key in Committed Config
- **Severity:** MEDIUM
- **Affected Components:** `opencode.json`, `.mcp.json`
- **Root Cause:** Full Alchemy API URL with key committed: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
- **Failure Scenario:** Anyone with repo access has the Alchemy API key
- **Attack Scenario:** Attacker uses key for unauthorized Alchemy API calls, quota exhaustion, or chain data manipulation
- **Blast Radius:** Alchemy API quota can be exhausted. Chain data queries limited
- **Dependency Impact:** Affects all blockchain read operations via Alchemy
- **Proposed Solution:** Rotate key immediately, move to env vars, gitignore config files with secrets
- **Priority:**
  - Immediate: Rotate Alchemy key, gitignore opencode.json
  - Short Term: Audit git history for other leaked secrets
  - Long Term: Use secret scanning in CI

### F-19: No CI Deployment Pipeline
- **Severity:** LOW
- **Affected Components:** `.github/workflows/ci.yml`
- **Root Cause:** CI builds and tests but never deploys. TypeScript errors are silenced with `continue-on-error: true`
- **Failure Scenario:** Code reaches main with TypeScript errors. No automated deployment ensures consistency
- **Attack Scenario:** N/A (process issue)
- **Blast Radius:** Manual deployment process, human error risk
- **Dependency Impact:** Affects all deployment reliability
- **Proposed Solution:** Add deployment pipeline, remove continue-on-error for TypeScript
- **Priority:**
  - Immediate: Document deployment process
  - Short Term: Add deployment pipeline
  - Long Term: Implement CI/CD with staging → production promotion

### F-20: Redis-Backed Rate Limiting Not Implemented
- **Severity:** LOW
- **Affected Components:** `backend/src/middleware/rateLimiter.ts`
- **Root Cause:** Code checks for REDIS_URL but always falls back to in-memory
- **Failure Scenario:** Rate limits are per-instance, not global
- **Attack Scenario:** N/A (same as F-10)
- **Blast Radius:** Per-instance rate limiting only
- **Dependency Impact:** Affects rate limiting effectiveness
- **Proposed Solution:** Implement Redis-backed rate limiting
- **Priority:**
  - Immediate: Document limitation
  - Short Term: Implement Redis rate limiter
  - Long Term: Use Redis Cluster

### F-21: Sentry Integration is No-Op
- **Severity:** LOW
- **Affected Components:** `backend/src/utils/monitoring.ts`
- **Root Cause:** `sendToSentry()` just logs to console. SENTRY_DSN env var checked but not used
- **Failure Scenario:** Errors are not tracked in production
- **Attack Scenario:** N/A (observability issue)
- **Blast Radius:** No error tracking, no alerting
- **Dependency Impact:** Affects all error monitoring
- **Proposed Solution:** Implement actual Sentry integration
- **Priority:**
  - Immediate: Remove Sentry references or implement properly
  - Short Term: Implement Sentry error tracking
  - Long Term: Add distributed tracing

### F-22: Frontend Docker Health Check Missing
- **Severity:** LOW
- **Affected Components:** `docker-compose.yml`
- **Root Cause:** Frontend service in docker-compose.yml has no health check (Dockerfile has one but compose overrides)
- **Failure Scenario:** Docker cannot determine frontend health, may route traffic to unhealthy instances
- **Attack Scenario:** N/A (availability issue)
- **Blast Radius:** Orchestration cannot detect frontend failures
- **Dependency Impact:** Affects Docker Swarm/ECS routing
- **Proposed Solution:** Add health check to docker-compose.yml
- **Priority:**
  - Immediate: Add health check definition
  - Short Term: Test health check in staging
  - Long Term: Add readiness/liveness probes

### F-23: deploy-production.sh Missing Migration Step
- **Severity:** LOW
- **Affected Components:** `scripts/deploy-production.sh`
- **Root Cause:** Database migration is a placeholder comment: `# Add migration commands here`
- **Failure Scenario:** New deployments don't apply database migrations. Schema drift
- **Attack Scenario:** N/A (operations issue)
- **Blast Radius:** Database schema inconsistent across environments
- **Dependency Impact:** Affects all database-dependent operations
- **Proposed Solution:** Add actual migration step (e.g., `npx prisma migrate deploy`)
- **Priority:**
  - Immediate: Add migration command
  - Short Term: Test migration in staging
  - Long Term: Automate migration in CI/CD

---

## Scoring

| Domain | Score | Rationale |
|--------|-------|-----------|
| Smart Contract Readiness | 8/10 | Solid contract design, UUPS, emergency pause, nullifier protection |
| Backend Readiness | 8/10 | VK hard-fail, WS auth, MCP auth, prod env validation, encrypted keys |
| Frontend Readiness | 7/10 | Compile errors fixed, Secure cookies, proxy whitelists, encrypted secrets |
| Data Integrity | 7/10 | Encrypted storage, LRU cache, encrypted API keys, session TTL reduced |
| Runtime Safety | 8/10 | WS_PORT fixed, tx confirmation, rate limiting enforced |
| Production Readiness | 7/10 | CI hardened, deployment validation, backup scripts, monitoring gaps remaining |

**Overall Production Readiness: 7.5/10**

---

## Remaining Work (Low Priority)

| Finding | Status | Action |
|---------|--------|--------|
| Challenge store in-memory | Open | Move to Redis/PostgreSQL for multi-instance |
| Sentry integration placeholder | Open | Implement actual Sentry SDK |
| In-memory error tracker (1000 max) | Open | Use external error tracking |
| No log aggregation | Open | Add ELK/CloudWatch/Datadog |
| No distributed tracing | Open | Add OpenTelemetry |
| No load testing | Open | Add k6/locust tests for 1000 agents |
| Chain reorg handling | Open | Add event re-indexing on reorg |
| No tx timeout/cancellation | Open | Add stuck tx detection |
| EIP-191 endpoint unusual lookup | Open | Fix agent lookup by managed_secret |
| Toast remove delay 16+ min | Open | Reduce to 5s |
| No password strength validation | Open | Add client-side validation |
| Policy delete no confirmation | Open | Add confirmation dialog |

---

## Top 5 Remaining Bottlenecks

1. **No monitoring/alerting** — still blind to production failures (need Prometheus/Grafana or equivalent)
2. **No log aggregation** — errors only in container stdout
3. **Challenge store in-memory** — auth flows lost on restart
4. **No load testing** — untested at 1000-agent scale
5. **No disaster recovery** — no documented recovery procedure
