# AgentIX Critical Failures Analysis

**Date:** 2026-06-21
**Scope:** Cross-system failure simulation for every critical component

---

## Failure Matrix

### 1. RPC Provider Failure (Alchemy/Infura)

| Aspect | Detail |
|--------|--------|
| **Trigger** | Alchemy rate limit, outage, or network partition |
| **Immediate Impact** | Cannot create sessions, submit UserOps, read on-chain state |
| **Backend Behavior** | `blockchain.ts` throws on all contract calls. `eventSync.ts` stops polling. `chainAdapter.ts` attempts fallback RPC URLs. |
| **Frontend Behavior** | Dashboard shows stale data. Session/wallet creation fails. No error feedback to user. |
| **Agent Behavior** | Runtime server cannot execute transactions. Chat execution returns blockchain errors. |
| **Recovery** | Automatic when RPC resumes. Event sync catches up via cursor-based polling. |
| **Blast Radius** | All on-chain operations halted. Read operations serve stale cached data. |
| **Mitigation Status** | ⚠️ `chainAdapter.ts` has fallback RPC URLs but no circuit breaker. No retry budget. |

### 2. Backend Crash

| Aspect | Detail |
|--------|--------|
| **Trigger** | Unhandled exception, OOM, or process kill |
| **Immediate Impact** | All API endpoints return 502/503. WebSocket connections dropped. |
| **Backend Behavior** | Process exits. In-memory state lost (rate limits, challenge store, wallet cache, error tracker, metrics). |
| **Frontend Behavior** | All API calls fail. Dashboard shows errors. No offline mode. |
| **Agent Behavior** | WebSocket disconnected. Task queue paused. Event sync stops. |
| **Recovery** | Docker restart policy (`on-failure: 3, delay 5s`). DB state persists. In-memory state lost. |
| **Blast Radius** | Complete backend outage until restart. In-memory state permanently lost. |
| **Mitigation Status** | 🔴 No graceful shutdown handler. No state persistence for in-memory stores. |

### 3. Database Failure (PostgreSQL)

| Aspect | Detail |
|--------|--------|
| **Trigger** | DB crash, disk full, connection pool exhaustion |
| **Immediate Impact** | All API endpoints fail (every route queries DB) |
| **Backend Behavior** | Connection pool exhaustion → all requests timeout. No circuit breaker. |
| **Frontend Behavior** | Complete outage. No offline fallback. |
| **Agent Behavior** | Cannot authenticate, cannot read/write any state. |
| **Recovery** | Manual DB restart. No automated failover configured. |
| **Blast Radius** | Total system outage. No data loss if DB restarts (WAL persistence). |
| **Mitigation Status** | 🔴 No DB connection retry with backoff. No read replicas. No automated failover. |

### 4. Redis Failure

| Aspect | Detail |
|--------|--------|
| **Trigger** | Redis crash, memory limit, network partition |
| **Immediate Impact** | Proof queue fails. Rate limiting falls back to in-memory. Budget tracking uses DB fallback. |
| **Backend Behavior** | `proofQueue.ts` — all proof jobs fail. `rateLimiter.ts` — falls back to in-memory (line 71). `budget-tracker.ts` — falls back to PostgreSQL with row-level locking. |
| **Frontend Behavior** | No direct impact (frontend doesn't use Redis). |
| **Agent Behavior** | Proof generation blocked. Rate limiting degraded (not shared across instances). |
| **Recovery** | Automatic fallback to DB/in-memory. Data in Redis is ephemeral (proof queue, rate limit counters). |
| **Blast Radius** | Degraded but functional. Proof generation blocked. |
| **Mitigation Status** | ⚠️ Fallback exists but in-memory rate limiter not shared across Docker replicas. |

### 5. Event Sync Failure

| Aspect | Detail |
|--------|--------|
| **Trigger** | `eventSync.ts` crashes, RPC errors, or DB write failure |
| **Immediate Impact** | New blockchain events not indexed. WalletCreated events not processed. |
| **Backend Behavior** | Cursor stops advancing. Events accumulate on-chain but not in DB. |
| **Frontend Behavior** | Event page shows stale data. New wallets not appearing. |
| **Agent Behavior** | Wallet records not created for new wallets. |
| **Recovery** | On restart, event sync resumes from last cursor. If cursor is behind RPC block retention, events are lost. |
| **Blast Radius** | Events between last cursor and restart may be permanently lost. |
| **Mitigation Status** | ⚠️ No dead-letter queue. No alerting on sync lag. No reorg handling. |

### 6. WebSocket Server Failure

| Aspect | Detail |
|--------|--------|
| **Trigger** | WS_PORT conflict, memory leak, or connection flood |
| **Immediate Impact** | Real-time agent communication disabled |
| **Backend Behavior** | WebSocket server fails to bind (if port conflict) or crashes under load |
| **Frontend Behavior** | No real-time updates. Polling-based fallback. |
| **Agent Behavior** | Cannot receive real-time task dispatch. Must fall back to HTTP polling. |
| **Recovery** | Docker restart. No automatic reconnection for agents. |
| **Blast Radius** | Real-time features disabled. HTTP fallback available. |
| **Mitigation Status** | 🔴 WS_PORT defaults to same port as HTTP (3001). No reconnection logic for agents. |

### 7. MCP Server Failure

| Aspect | Detail |
|--------|--------|
| **Trigger** | SSE connection drop, tool execution error, or process crash |
| **Immediate Impact** | MCP-compatible clients (Claude, Cursor) lose all AgentIX tools |
| **Backend Behavior** | MCP server runs inside backend process — shares fate with backend |
| **Frontend Behavior** | No direct impact (MCP is separate transport) |
| **Agent Behavior** | AI agents connected via MCP lose capability to manage agents/proofs |
| **Recovery** | Backend restart restores MCP. Client must reconnect. |
| **Blast Radius** | MCP clients lose all 19 AgentIX tools until reconnection. |
| **Mitigation Status** | ⚠️ No standalone MCP process. No client reconnection logic. |

### 8. Frontend Crash

| Aspect | Detail |
|--------|--------|
| **Trigger** | Next.js build error, compile error, or runtime exception |
| **Immediate Impact** | Dashboard inaccessible. No user interface. |
| **Backend Behavior** | No impact (backend runs independently). |
| **Frontend Behavior** | 500 error or blank page. |
| **Agent Behavior** | No direct impact (agents use API/SDK/MCP, not frontend). |
| **Recovery** | Docker restart or redeploy. |
| **Blast Radius** | Dashboard only. API/SDK/MCP still functional. |
| **Mitigation Status** | ⚠️ 3 compile errors exist. No error boundary on critical pages. |

### 9. Wallet Provider Disconnect

| Aspect | Detail |
|--------|--------|
| **Trigger** | User locks wallet, switches network, or extension crashes |
| **Immediate Impact** | Cannot sign transactions or create sessions |
| **Frontend Behavior** | `wallet-provider.tsx` loses provider reference. All wallet operations fail. |
| **Backend Behavior** | No impact (backend doesn't depend on frontend wallet). |
| **Agent Behavior** | No direct impact (agents use backend signer, not user wallet). |
| **Recovery** | User reconnects wallet. No automatic reconnection. |
| **Blast Radius** | User-initiated operations blocked. Agent operations unaffected. |
| **Mitigation Status** | ⚠️ `providerRef` persists across renders without liveness check. |

### 10. Transaction Stuck Pending

| Aspect | Detail |
|--------|--------|
| **Trigger** | Gas too low, nonce conflict, or chain congestion |
| **Immediate Impact** | UserOp or contract call stuck in mempool |
| **Backend Behavior** | `blockchain.ts` submits tx but no timeout mechanism. `tx.wait()` blocks indefinitely. |
| **Frontend Behavior** | No tx status tracking. User has no feedback. |
| **Agent Behavior** | Agent execution blocked waiting for tx confirmation. |
| **Recovery** | Manual replacement tx with higher gas. No automated retry. |
| **Blast Radius** | Single operation blocked. Other operations unaffected (nonce-based). |
| **Mitigation Status** | 🔴 No tx timeout. No replacement tx logic. No pending tx monitoring. |

### 11. Chain Reorganization

| Aspect | Detail |
|--------|--------|
| **Trigger** | L1 reorg (rare on Base) or sequencer issue |
| **Immediate Impact** | Indexed events may be from orphaned blocks |
| **Backend Behavior** | `eventSync.ts` has no reorg detection. DB records from orphaned blocks persist. |
| **Frontend Behavior** | Displays data from orphaned blocks. |
| **Agent Behavior** | May act on stale/invalid state. |
| **Recovery** | No automated recovery. Manual DB cleanup required. |
| **Blast Radius** | State inconsistency. Potential double-spend perception. |
| **Mitigation Status** | 🔴 No reorg handling anywhere in the stack. |

### 12. Concurrent Request Race Conditions

| Aspect | Detail |
|--------|--------|
| **Trigger** | Multiple agents/sessions executing simultaneously |
| **Immediate Impact** | Budget overruns, duplicate state changes |
| **Specific Scenarios** | |
| — Session spend | Two concurrent `validateSession` calls both pass before either updates `valueUsed` |
| — Credential issuance | Two concurrent `issueCredential` calls produce conflicting Merkle roots |
| — Wallet execution | Two concurrent UserOps for same wallet may exceed daily limits |
| **Backend Behavior** | No distributed locking. DB-level constraints prevent some duplicates but not all race conditions. |
| **Recovery** | On-chain state is source of truth. DB inconsistency self-corrects on next event sync. |
| **Blast Radius** | Budget overruns possible. Duplicate on-chain state possible for non-idempotent operations. |
| **Mitigation Status** | ⚠️ AgentWallet has `nonReentrant` guard. SessionManager has sequential `valueUsed` update. But no application-level locking. |

---

## Failure Cascades

### Cascade 1: RPC Down → Event Sync Down → Stale State → Bad Decisions

```
RPC fails
  → eventSync.ts stops polling
  → DB state becomes stale
  → Backend serves stale session/capability state
  → Agent executes with stale permissions
  → Potential unauthorized execution
```

### Cascade 2: DB Down → Auth Down → Complete Outage

```
PostgreSQL crashes
  → All auth middleware fails (session lookup)
  → All API routes return 500
  → Frontend shows errors
  → Agents cannot authenticate
  → Complete system outage
```

### Cascade 3: Redis Down → Proof Queue Down → No New Sessions

```
Redis crashes
  → proofQueue.ts jobs fail
  → No new ZK proofs generated
  → Cannot create new sessions
  → Existing sessions still work
  → System degrades but doesn't halt
```

### Cascade 4: Backend Crash → WebSocket Down → Agent Communication Lost

```
Backend process crashes
  → WebSocket server dies
  → All connected agents disconnected
  → No real-time task dispatch
  → Agents must fall back to HTTP polling
  → Response time increases 10-100x
```

### Cascade 5: VK Missing → Auth Bypass → Full Compromise

```
verification_key.json deleted/misconfigured
  → verifyAuthorizationProof falls back to "off-chain checks"
  → All ZK proofs treated as valid
  → Any external agent can execute any action
  → Complete authorization bypass
```

---

## Graceful Degradation Assessment

| Component | Degrades Gracefully? | Fallback |
|-----------|---------------------|----------|
| Backend HTTP API | ❌ No | Fails hard on DB/RPC outage |
| Backend WebSocket | ❌ No | No fallback for real-time |
| Backend MCP | ❌ No | Shares backend fate |
| Frontend Dashboard | ⚠️ Partial | Shows errors, no offline mode |
| SDK | ⚠️ Partial | HTTP errors propagate to caller |
| CLI | ⚠️ Partial | Colored error output, no retry |
| Event Sync | ⚠️ Partial | Resumes from cursor on restart |
| Rate Limiting | ⚠️ Partial | Falls back to in-memory (not shared) |
| Proof Generation | ⚠️ Partial | Falls back to snarkjs (slower) |
| Budget Tracking | ✅ Yes | Falls back to PostgreSQL |
| Agent Execution | ❌ No | Blocked on backend/RPC failure |
