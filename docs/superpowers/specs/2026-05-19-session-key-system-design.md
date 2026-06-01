# Session Key System Design Spec

> **Created:** 2026-05-19
> **Status:** Approved for implementation
> **Goal:** Enable AI agents to execute blockchain transactions autonomously through their own AgentWallet using session keys with enforced limits and expiration.

---

## Architecture Overview

### Core Flow

```
PHASE 1: Session Creation (on agent registration + wallet creation)
──────────────────────────────────────────────────────────────────
User → Frontend: Register Agent + Create Wallet
Frontend → Backend: Deploy AgentWallet
Backend: Returns wallet_address
Frontend: Generate session key pair (client-side)
Frontend: Encrypt private key (user wallet + backend master key)
Frontend → Backend: Store encrypted key, session params
Backend: Creates session record, returns session_id
Smart Contract: creates LightweightSession with limits

PHASE 2: Runtime Connection (unlock session key)
──────────────────────────────────────────────────────────────────
User → Frontend: Connect Runtime button
User → Frontend: Sign connection request (wallet signature)
Frontend → Backend: Verify signature + unlock session
Backend: Decrypt session key
Backend → Runtime: Send decrypted session key (encrypted tunnel)
Runtime: Store key in memory (never persisted)

PHASE 3: Autonomous Execution
──────────────────────────────────────────────────────────────────
Runtime: Creates UserOp, signs with session key
Runtime → Backend: Submit signed UserOp
Backend: Validate session (expiry, limits, wallet binding)
Backend → EntryPoint: Relay UserOp
EntryPoint → AgentWallet: validateUserOp
AgentWallet → SessionManager: validateLightweightSession
SessionManager: Check expiry + limits, update usage
EntryPoint: Execute transaction
```

---

## Components

### 1. Database Schema

```sql
-- Table: agent_sessions
-- Stores session keys and configuration for each agent's wallet
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_agent_id INTEGER REFERENCES external_agents(id) ON DELETE CASCADE,
  agent_wallet_address TEXT NOT NULL,
  session_key_encrypted TEXT NOT NULL,      -- Double-encrypted private key
  session_key_public TEXT NOT NULL,          -- Public key (session signer address)
  session_id_on_chain TEXT NOT NULL,         -- bytes32 sessionId in SessionManager contract
  daily_spend_limit BIGINT NOT NULL DEFAULT 0,
  daily_tx_limit INTEGER NOT NULL DEFAULT 10,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_session_per_wallet UNIQUE (external_agent_id, agent_wallet_address)
);

CREATE INDEX idx_sessions_expiry ON agent_sessions(expires_at);
CREATE INDEX idx_sessions_wallet ON agent_sessions(agent_wallet_address);
CREATE INDEX idx_sessions_agent ON agent_sessions(external_agent_id);

-- Table: session_usage
-- Tracks daily usage per session for off-chain limit checking
CREATE TABLE session_usage (
  id SERIAL PRIMARY KEY,
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  spend_used BIGINT DEFAULT 0,
  tx_count INTEGER DEFAULT 0,
  
  CONSTRAINT unique_session_daily_usage UNIQUE (session_id, usage_date)
);

CREATE INDEX idx_usage_session_date ON session_usage(session_id, usage_date);
```

### 2. Backend: SessionKeyService

**File:** `backend/src/services/sessionKey.ts`

**Methods:**
- `createSession(params)` - Generate key pair, encrypt, store, register on-chain
- `unlockSession(sessionId, signature)` - Verify user signature, return decrypted key
- `getSession(sessionId)` - Fetch session from database
- `validateSessionForExecution(sessionId, walletAddress, agentId, value)` - Full validation
- `getTodayUsage(sessionId)` - Get current daily spend/tx count
- `recordUsage(sessionId, value)` - Update usage after successful execution
- `revokeSession(sessionId)` - Mark session as revoked
- `cleanupExpiredSessions()` - Periodic cleanup job

**Encryption:**
- Session key encrypted with AES-256-GCM
- Double encryption: User's wallet public key + backend master key
- Backend can decrypt with master key after user approves

### 3. Backend: AgentToolsService (Modified)

**Changes:**
- Remove `PRIVATE_KEY` usage for session-based agents
- Accept `sessionId` parameter in all action methods
- Validate session before execution via `SessionKeyService.validateSessionForExecution()`
- Runtime provides pre-signed UserOp (signed with session key)
- Backend relays signed UserOp to EntryPoint
- Record usage after successful execution

**Flow:**
```
executeAction(action, params, sessionId):
  1. Validate session (expiry, limits, wallet binding)
  2. Parse action params (to, value, data)
  3. Runtime has already signed UserOp with session key
  4. Relay signed UserOp to EntryPoint
  5. Wait for execution result
  6. Record usage in session_usage table
  7. Return result
```

### 4. Frontend: Session Utilities

**File:** `frontend/lib/session.ts`

**Methods:**
- `generateSessionKeyPair()` - Create ECDSA key pair using Web Crypto API
- `encryptSessionKey(privateKey, userPublicKey, backendPublicKey)` - Double encryption
- `createSession(agentId, walletAddress, params)` - API call to create session

### 5. Frontend: Connection Flow

**File:** `frontend/lib/external-agents-api.ts` (modified)

**Methods:**
- `connectRuntimeWithSession(externalAgentId, sessionId)` - Unlock session on connect
- Session key delivered to runtime via encrypted channel

### 6. Smart Contract: SessionManager (Existing)

Already has `LightweightSession` struct with:
- `sessionKey` - Public key for signature validation
- `dailySpendLimit` - Maximum wei per day
- `dailyTxLimit` - Maximum transactions per day
- `dailySpendUsed` / `dailyTxUsed` - Current usage
- `expiry` - Unix timestamp when session expires
- `revoked` - Revocation flag

**Validation in `validateLightweightSession()`:**
1. Check not revoked
2. Check `block.timestamp < expiry`
3. Check session key matches signer
4. Reset daily counters if new day
5. Check spend/tx limits
6. Update usage counters

---

## Security Model

| Layer | Enforcement | Bypassable? |
|-------|-------------|-------------|
| Smart Contract | Hard limits, expiry check, wallet binding | No - code execution |
| Backend | Pre-validation, usage tracking | Yes - but contract still enforces |
| Runtime | Holds key in memory only | Yes - but limited by contract |
| User Signature | Required to unlock session key | No - encryption requires approval |

### Session Key Isolation

- Each session key bound to ONE specific `AgentWallet` address
- Session key stored as: `session_id_on_chain` in DB maps to contract session
- Agent cannot execute on behalf of other agents
- Agent cannot access other wallets

### Expiration Enforcement

```
Layer 1: Backend check (fast response)
├── if (now > expires_at): reject immediately

Layer 2: Contract check (on-chain)
├── require(block.timestamp < s.expiry, "Session expired")

Layer 3: Runtime key invalidation
├── Key purged from memory on disconnect
├── Key useless after expiry (contract rejects)
```

---

## Session Lifecycle

| State | Can Execute? | Key Location | Notes |
|-------|--------------|--------------|-------|
| **Created** | Yes (if connected) | Encrypted in DB | Ready for use |
| **Active** | Yes | DB (encrypted) + Runtime (decrypted) | Normal operation |
| **Expired** | No | Useless | Must create new session |
| **Revoked** | No | Useless | User explicitly revoked |
| **Disconnected** | No | DB only | Key purged from runtime |

---

## Default Limits

| Parameter | Default Value | Configurable? |
|-----------|---------------|---------------|
| Daily Spend Limit | 0.1 ETH (100000000000000000 wei) | Yes, on creation |
| Daily Tx Limit | 10 | Yes, on creation |
| Session Expiry | 7 days | Yes, on creation |
| Max Sessions per Agent | 1 active at a time | No |

---

## API Endpoints

### Backend Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sessions` | Create new session |
| GET | `/sessions/:sessionId` | Get session details |
| POST | `/sessions/:sessionId/unlock` | Unlock session key (requires signature) |
| POST | `/sessions/:sessionId/revoke` | Revoke session |
| GET | `/sessions/:sessionId/usage` | Get current usage |

### Modified Routes

| Method | Endpoint | Change |
|--------|----------|--------|
| POST | `/external/:agentId/connect` | Added `sessionId` parameter |
| POST | `/external/:agentId/execute` | Use session-based validation |

---

## Implementation Phases

### Phase 1: Database Migrations
- Add `agent_sessions` table
- Add `session_usage` table
- Add indexes

### Phase 2: Backend SessionKeyService
- Implement encryption/decryption
- Implement session creation
- Implement session validation
- Implement usage tracking

### Phase 3: Backend AgentToolsService Rewrite
- Remove PRIVATE_KEY usage
- Add session validation
- Relay signed UserOps from runtime

### Phase 4: Backend Session Routes
- Create sessions router
- Add unlock endpoint
- Add revoke endpoint

### Phase 5: Frontend Session Utilities
- Key generation
- Encryption helpers
- Session creation API calls

### Phase 6: Frontend Connection Flow
- Modify connect runtime to unlock session
- Pass session key to runtime

### Phase 7: Testing & Verification
- Unit tests for encryption
- Integration tests for session flow
- E2E tests for autonomous execution

---

## Files to Create/Modify

### New Files
- `backend/src/services/sessionKey.ts`
- `backend/src/routes/sessions.ts`
- `frontend/lib/session.ts`

### Modified Files
- `backend/src/migrations.ts` - Add session tables
- `backend/src/services/agentTools.ts` - Session-based execution
- `backend/src/routes/externalAgents.ts` - Session validation
- `frontend/lib/external-agents-api.ts` - Session API calls
- `frontend/components/execute/connect-runtime-modal.tsx` - Unlock session on connect

---

## Success Criteria

1. ✅ Agent can execute transactions through its own AgentWallet
2. ✅ Session key only works for the bound wallet
3. ✅ Expired sessions cannot execute
4. ✅ Daily spend/tx limits enforced on-chain
5. ✅ User signature required to unlock session key
6. ✅ Runtime holds key in memory only
7. ✅ Backend cannot access key without user approval
