# Developer Persona Test Report

> A brutally honest analysis of Agentix through the eyes of a developer trying to use the system.

---

## Developer Persona: "Sarah, the AI Agent Builder"

**Background:** Senior developer at a startup building AI-powered automation tools. She wants to integrate Agentix to give her AI agents the ability to execute on-chain transactions with verifiable, revocable credentials.

**Goals:**
1. Register her AI agents and issue credentials
2. Create time-limited sessions for autonomous operation
3. Deploy wallets for agents to hold funds
4. Revoke credentials when agents are decommissioned
5. Self-host the infrastructure for data sovereignty

---

## Flows Available in the System

### Flow 1: Organization Setup
```
1. Connect MetaMask wallet on Sepolia
2. Create organization via /api/platform/orgs
3. Sign action message for CREATE_ORG
4. Backend creates org record with owner_wallet_address
5. Deploy contracts (SessionManager, CredentialRegistry, etc.) via /api/platform/orgs/:orgId/deploy
6. Fund organization via /api/platform/orgs/:orgId/fund
```

### Flow 2: Agent Registration
```
1. Create agent via /api/platform/agents
2. Sign action message for CREATE_AGENT
3. Backend creates agent record linked to org
```

### Flow 3: Credential Issuance
```
1. Frontend: Issue credential via /api/platform/agents/:agentId/credential
2. Backend generates secret, computes commitment, inserts into merkle tree
3. Stores commitment and secret_hash in database
4. Updates merkle tree root
```

### Flow 4: Session Creation (ZK Proof)
```
1. Frontend: Request session via /api/platform/agents/:agentId/session
2. Backend: Generates ZK proof using groth16
3. Constructs proof with merkle proof for active tree
4. Constructs non-revocation proof for revoked tree
5. Submits transaction to SessionManager.createSession()
6. On-chain verification of ZK proof
7. Session stored in smart contract
```

### Flow 5: Wallet Deployment
```
1. Deploy wallet via /api/platform/agents/:agentId/wallet
2. Backend calls AgentWalletFactory to create ERC-4337 wallet
3. Wallet address stored in database
```

### Flow 6: Credential Revocation
```
1. Revoke via /api/platform/agents/:agentId/revoke
2. Backend adds secret_hash to revoked_secrets table
3. Updates revoked SMT root
4. Future sessions with this credential will fail verification
```

### Flow 7: External Agent (Provider) Integration
```
1. Create external agent via /external
2. Links external runtime (Claude, LangChain, etc.) to protocol agent
3. Agent receives linked_agent_id for protocol operations
```

---

## MAJOR DESIGN FLAWS (Brutally Honest)

### FLAW 1: Secret Management is Irresponsibly Handled

**Severity: CRITICAL**

The system generates secrets on behalf of users and stores them:

```typescript
// platform.ts:58-60
private createManagedSecret() {
    return BigInt(`0x${crypto.randomBytes(31).toString("hex")}`)
}
```

**Problems:**
- Secrets are generated server-side, meaning the platform KNOWS all agent secrets
- This defeats the entire purpose of ZK proofs - if the server knows the secret, it can impersonate any agent
- There's no option for client-side secret generation
- The secret is passed through API responses (leaks in logs, proxies, etc.)

**What Sarah thinks:**
> "Wait, so the backend KNOWS my agent's secret? Then what's the point of ZK proofs? The whole premise of 'verifiable credentials without revealing the secret' is broken if the platform generating the proof also knows the secret. I thought ZK proofs meant the prover proves knowledge WITHOUT revealing it? This is architectural theft of agent identities."

**Impact:** Complete failure of the ZK security model from a trust-minimization perspective.

---

### FLAW 2: The SDK is Browser-Incompatible

**Severity: HIGH**

```typescript
// SessionManager.ts:9-11
const CIRCUIT_WASM_PATH = path.resolve(
  __dirname,
  "../../../circuits/build/credential_js/credential.wasm"
)
```

**Problems:**
- Uses Node.js `fs`, `path`, `crypto` modules directly
- No browser-compatible build
- Ethers.js and snarkjs work in browsers, but the SDK doesn't
- Sarah would need to rewrite the entire SDK to use it in a browser extension or mobile app

**What Sarah thinks:**
> "I can't use this SDK in my React Native app or browser extension. The README mentions 'self-hosted SDK' but it's Node-only. So I'd need to run a backend service just to use a library that talks to... another backend service? That's two layers of indirection."

---

### FLAW 3: Wallet Authentication is Chain-Hardcoded

**Severity: MEDIUM**

```typescript
// actionAuth.ts:4
const SIGNED_ACTION_CHAIN_ID = 11155111
```

**Problems:**
- Chain ID is hardcoded to Sepolia
- No support for mainnet or other testnets without code changes
- The system can't be deployed to multiple networks simultaneously
- Signature verification will fail if user is on wrong network

**What Sarah thinks:**
> "I know we're in testnet, but if I want to deploy to mainnet, I need to change code? This should be configurable at runtime via environment variables or database, not compiled into the binary."

---

### FLAW 4: No Graceful Degradation for Missing Circuit Files

**Severity: MEDIUM**

```typescript
// platform.ts:11-27
const CIRCUIT_WASM_PATH = path.resolve(__dirname, "../../../circuits/build/...")
const CIRCUIT_ZKEY_PATH = resolveZkeyPath()

function resolveZkeyPath() {
    const buildDir = path.resolve(__dirname, "../../../circuits/build")
    const zkey = fs.readdirSync(buildDir).find((file) => file.endsWith(".zkey"))
    if (!zkey) {
        throw new Error(`No .zkey file found in ${buildDir}`)
    }
    ...
}
```

**Problems:**
- Server crashes if circuit files aren't built
- No fallback or graceful error message
- New developers can't start backend without running circuit compilation first
- Circuit compilation takes 10+ minutes and requires specialized tools

**What Sarah thinks:**
> "I just want to test the API. Why does the backend crash on startup because circuit files are missing? Shouldn't I be able to create organizations, register agents, and use the platform without ZK proofs working? Why does listing organizations depend on circuits?"

---

### FLAW 5: Database Schema is Not Version-Controlled

**Severity: HIGH**

**Problems:**
- The system uses `CREATE TABLE IF NOT EXISTS` but never runs migrations
- No migration files exist
- Schema changes require manual SQL execution (as we just experienced)
- Adding new columns requires ALTER TABLE in production
- No downgrades possible

**What Sarah thinks:**
> "I just spent hours debugging why the backend was crashing. Turns out the database had drifted from the expected schema because there are NO migrations. The code expects columns that don't exist. How am I supposed to deploy this to production? Write my own migration system?"

---

### FLAW 6: Merkle Tree Rebuilds on Every Credential Operation

**Severity: HIGH (for scaling)**

```typescript
// merkle.ts - the tree is rebuilt from database on each operation
async getNextLeafIndex(db: any): Promise<number> {
    const result = await db.get(`SELECT MAX(leaf_index) as max_index FROM credentials WHERE org_id = ?`, this.orgId)
    ...
}
```

**Problems:**
- O(n) tree reconstruction on every insert
- No caching of tree state
- 1000 credentials = rebuilding 1000-node tree on every operation
- Doesn't scale for large orgs

**What Sarah thinks:**
> "So every time I issue a credential, the server rebuilds the entire merkle tree from the database? That's going to be incredibly slow at scale. Why isn't the tree state cached or persisted as a snapshot?"

---

### FLAW 7: Revocation Secret Hash Should Not Be Stored Transparently

**Severity: CRITICAL**

```typescript
// credentials route stores secretHash directly
INSERT INTO credentials (..., secret_hash, ...) VALUES (..., ?, ...)
```

**Problems:**
- The secret_hash is what allows revocation
- If someone gets database access, they can see all secret_hashes
- They can't forge proofs (need the actual secret) but they can correlate revocations
- This breaks the privacy model

**What Sarah thinks:**
> "The secret_hash should be hashed AGAIN for storage. Storing it as-is means database leaks reveal the revocation identifiers. I thought ZK was supposed to prevent correlation?"

---

### FLAW 8: Frontend Fallback Mock Data in Production Code

**Severity: MEDIUM**

```typescript
// mock-api.ts:156-161
if (useFallback && (USE_MOCK || !isProduction)) {
    console.warn(`API call failed for ${path}, using fallback data`)
    return getFallbackData(path) as T
}
```

**Problems:**
- Mock data is mixed with production API code
- Silent fallback to fake data can mask backend failures
- Developers won't notice backend is down because UI still "works"
- The file is 600+ lines and half of it is mock data

**What Sarah thinks:**
> "Wait, the frontend is silently falling back to fake data? So if my backend is down, I won't even realize it because the UI shows demo agents? That's dangerous for a credentialing system. I want failures to be LOUD."

---

### FLAW 9: No Rate Limiting on Proof Generation

**Severity: MEDIUM**

**Problems:**
- ZK proof generation is CPU-intensive (takes 2-5 seconds per proof)
- No rate limiting on /sessions endpoint
- A single user could DDOS the server by requesting many sessions
- No queue system for proof generation

**What Sarah thinks:**
> "I can request as many sessions as I want? Each one generates a ZK proof. Someone's going to figure out they can starve the CPU. Where's the queue? Where's the rate limit?"

---

### FLAW 10: Singleton Blockchain Service with Shared State

**Severity: LOW-MEDIUM**

```typescript
// routes/wallets.ts:19-20
const blockchain = new BlockchainService()
const walletInterface = new ethers.Interface(blockchain.getWalletAbi())
```

**Problems:**
- New BlockchainService instance created at module load time
- Shared across all requests
- No connection pooling for RPC calls
- If initialization fails, all requests fail

**What Sarah thinks:**
> "These singleton services are fragile. If the RPC connection fails during initialization, the entire route is broken. Where's the reconnection logic? Where's the health check?"

---

### FLAW 11: Nonce Reuse Protection is Race-Condition Prone

**Severity: HIGH**

```typescript
// actionAuth.ts:83-94
const usedNonce = await db.get(
    "SELECT nonce FROM action_authorizations WHERE nonce = ?",
    [nonce]
)
if (usedNonce) {
    throw new AppError(401, "nonce already used")
}
// ... later ...
await db.run(
    "INSERT INTO action_authorizations (nonce, ...) VALUES (?, ...)",
    [nonce, ...]
)
```

**Problems:**
- Check-then-insert pattern has race condition
- Two requests with same nonce could both pass the check
- Should use database unique constraint + ON CONFLICT
- The unique constraint WAS added but the code doesn't use it properly

**What Sarah thinks:**
> "Classic TOCTOU race condition. Between the SELECT and INSERT, another request could slip through. This is why we use INSERT ... ON CONFLICT or database-level atomic operations."

---

### FLAW 12: External API Route Through Frontend

**Severity: MEDIUM**

```typescript
// Next.js API route proxies to backend
// frontend/app/api/external/[[...path]]/route.ts
```

**Problems:**
- All external API calls go through Next.js server
- Adds latency and potential failure point
- Violates separation of concerns
- SDK should talk to backend directly

**What Sarah thinks:**
> "Why does the SDK talk to the frontend which proxies to the backend? That's three network hops. Just let the SDK talk to the backend directly."

---

### FLAW 13: No Audit Trail for Critical Operations

**Severity: MEDIUM**

**Problems:**
- Credential issuance doesn't log who authorized it
- Session creation doesn't track IP or client
- Revocation has no accountability
- No way to investigate security incidents

**What Sarah thinks:**
> "Someone issued a credential for my agent. I have no idea who authorized it because there's no audit log. Was it me? Was it an attacker? The events table shows WHAT happened but not WHO did it."

---

### FLAW 14: Impossible to Run Without Ethereum

**Severity: MEDIUM**

**Problems:**
- Backend requires blockchain connection for contracts
- Can't run in "offline mode" for testing
- Development requires Sepolia RPC access
- No mocking layer for contract calls

**What Sarah thinks:**
> "I just want to test the credential logic without spinning up a blockchain. Why can't I run in 'mock mode' where contract calls return fake data? I don't want to deploy to Sepolia for every integration test."

---

---

## ARCHITECTURE IMPROVEMENT RECOMMENDATIONS

### Recommendation 1: Client-Side Secret Generation

**Priority: CRITICAL**

The secret MUST be generated client-side and NEVER transmitted to the server.

**Implementation:**
1. Remove `createManagedSecret()` from backend
2. SDK generates secret locally in browser/app
3. SDK computes commitment and secret_hash locally using circomlibjs/WASM
4. SDK sends only `commitment` and `secret_hash` to backend
5. Backend never sees the actual secret

```typescript
// Client-side (in SDK or frontend)
const secret = crypto.randomBytes(31);
const commitment = poseidon([agentId, orgId, permissions, expiry, secret]);
const secretHash = poseidon([secret, 0n]);

// Send to server
POST /credentials { commitment, secretHash, agentId, orgId, permissions, expiry }
// Server NEVER receives the secret
```

**Benefit:** True ZK - server cannot impersonate agents.

---

### Recommendation 2: Mobile/Browser-Compatible SDK

**Priority: HIGH**

Build a browser-compatible SDK bundle.

**Implementation:**
1. Use webpack/vite to bundle SDK for browser
2. Replace Node.js `fs` with fetch() for WASM/zkey loading from CDN
3. Use Web Crypto API instead of Node's `crypto`
4. Publish separate `@agentix/sdk-browser` package

```typescript
// browser-compatible
const wasm = await fetch('https://cdn.agentix.io/circuits/credential.wasm').then(r => r.arrayBuffer());
const zkey = await fetch('https://cdn.agentix.io/circuits/circuit.zkey').then(r => r.arrayBuffer());
```

---

### Recommendation 3: Configuration-Driven Chain ID

**Priority: MEDIUM**

Move chain ID to configuration.

**Implementation:**
```typescript
// config.ts
export const CHAIN_ID = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

// In signature verification
const message = buildSignedActionMessage({
    ...
    chainId: config.CHAIN_ID, // Not hardcoded
});
```

---

### Recommendation 4: Optional Circuit Initialization

**Priority: MEDIUM**

Allow backend to start without circuits.

**Implementation:**
```typescript
// In platform.ts
let circuitWasm: ArrayBuffer | null = null;
let circuitZkey: ArrayBuffer | null = null;

function loadCircuits() {
    try {
        circuitWasm = fs.readFileSync(CIRCUIT_WASM_PATH);
        circuitZkey = fs.readFileSync(CIRCUIT_ZKEY_PATH);
    } catch (e) {
        console.warn("Circuit files not found. ZK proof generation disabled.");
    }
}

// In session creation
if (!circuitWasm || !circuitZkey) {
    throw new AppError(503, "ZK proof generation not available. Circuit files not loaded.");
}
```

---

### Recommendation 5: Database Migration System

**Priority: HIGH**

Add proper migrations.

**Implementation:**
1. Use Prisma or Knex migrations
2. Version each schema change
3. Auto-run on startup in development
4. Require explicit migration in production

```sql
-- migrations/001_initial.sql
CREATE TABLE organizations (...);

-- migrations/002_add_nonce_to_action_auth.sql
ALTER TABLE action_authorizations ADD COLUMN nonce TEXT UNIQUE;
```

---

### Recommendation 6: Persisted Merkle Tree State

**Priority: HIGH**

Cache tree state instead of rebuilding.

**Implementation:**
```typescript
// Store tree state in database
CREATE TABLE merkle_tree_state (
    org_id INTEGER PRIMARY KEY,
    root TEXT NOT NULL,
    leaf_count INTEGER NOT NULL,
    nodes TEXT, -- JSON serialized or binary
    updated_at INTEGER
);

// On insert
async insert(leaf: bigint): Promise<number> {
    const state = await this.loadState();
    const index = state.leafCount;
    // Update tree in memory
    state.tree.insert(index, leaf);
    // Save state
    await this.saveState(state);
    return index;
}
```

---

### Recommendation 7: Hash Secret for Storage

**Priority: CRITICAL**

Store `hash(secretHash)` instead of `secretHash`.

**Implementation:**
```typescript
// When storing credential
const storedSecretIdentifier = poseidon([secretHash, STORAGE_SALT]);

// When revoking, compute same hash
const storedSecretIdentifier = poseidon([secretHash, STORAGE_SALT]);
INSERT INTO revoked_secrets (secret_identifier, ...) VALUES (storedSecretIdentifier, ...);
```

---

### Recommendation 8: Remove Mock Fallback from Production Code

**Priority: MEDIUM**

Separate mock API from real API.

**Implementation:**
```typescript
// lib/api.ts - production API
async function apiFetch<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) {
        throw new APIError(response.status, await response.text());
    }
    return response.json();
}

// lib/mock-api.ts - development only (tree-shaken in prod)
// Conditionally import only when USE_MOCK=true
```

---

### Recommendation 9: Proof Generation Queue

**Priority: MEDIUM**

Add BullMQ queue for proofs.

**Implementation:**
```typescript
// Already has BullMQ for proofs - use it!
// services/proofQueue.ts - queue proof generation

// In session route
const job = await proofQueue.add('generate-proof', {
    agentId, orgId, permissions, expiry, sessionNonce
});
const result = await job.finished();
```

---

### Recommendation 10: Atomic Nonce Insertion

**Priority: HIGH**

Fix race condition.

**Implementation:**
```typescript
// Single atomic operation
await db.run(`
    INSERT INTO action_authorizations (nonce, wallet_address, requested_at, ...)
    VALUES (?, ?, ?, ...)
    ON CONFLICT(nonce) DO NOTHING
`, [nonce, walletAddress, requestedAt, ...]);

// Check if insert succeeded
const inserted = await db.get("SELECT changes() as count");
if (inserted.count === 0) {
    throw new AppError(401, "nonce already used");
}
```

---

### Recommendation 11: SDK Direct Backend Access

**Priority: MEDIUM**

Remove frontend proxy.

**Implementation:**
```typescript
// SDK configuration
const client = new AgentClient({
    baseUrl: 'https://api.agentix.io', // Direct to backend
    // Not through Next.js proxy
});
```

---

### Recommendation 12: Operation Audit Log

**Priority: MEDIUM**

Log who authorized what.

**Implementation:**
```typescript
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    authorized_by TEXT NOT NULL, -- wallet address
    ip_address TEXT,
    user_agent TEXT,
    payload TEXT,
    created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

// After every authorized action
INSERT INTO audit_log (org_id, action, target, authorized_by, ip_address, ...)
VALUES (?, ?, ?, ?, ?, ...);
```

---

### Recommendation 13: Offline/Mock Development Mode

**Priority: MEDIUM**

Allow running without blockchain.

**Implementation:**
```typescript
// In blockchain.ts
const MOCK_MODE = process.env.MOCK_BLOCKCHAIN === 'true';

async createSession(...) {
    if (MOCK_MODE) {
        return { txHash: '0x' + '0'.repeat(64), sessionId: 'mock-session' };
    }
    // Real implementation
}
```

---

---

## Summary: What Would Sarah Do?

**Sarah's Verdict:**

> "The core idea is brilliant - ZK proofs for agent authorization is the right approach. But the implementation has critical architectural flaws that undermine the security model.
>
> The biggest issue is that the server generates and knows agent secrets. This defeats the entire purpose of zero-knowledge proofs. If I'm going to trust a server with my agent's identity, I might as well just use API keys.
>
> I'd need to fork this and rewrite:
> 1. Client-side secret generation
> 2. Browser-compatible SDK
> 3. Proper migrations
> 4. Merkle tree caching
>
> Until these are fixed, I can't recommend this for production use where trust-minimization matters."

---

## Flows Summary (Quick Reference)

| Flow | Endpoint | Auth Required | ZK Proof | On-Chain |
|------|----------|---------------|----------|----------|
| Create Org | `POST /api/platform/orgs` | Wallet Signature | No | No |
| Deploy Contracts | `POST /api/platform/orgs/:orgId/deploy` | Wallet Signature | No | Yes |
| Register Agent | `POST /api/platform/agents` | Wallet Signature | No | No |
| Issue Credential | `POST /api/platform/agents/:id/credential` | Wallet Signature | No | No |
| Create Session | `POST /api/platform/agents/:id/session` | Wallet Signature | Yes | Yes |
| Deploy Wallet | `POST /api/platform/agents/:id/wallet` | Wallet Signature | No | Yes |
| Revoke Credential | `POST /api/platform/agents/:id/revoke` | Wallet Signature | No | No |
| Fund Org | `POST /api/platform/orgs/:orgId/fund` | Wallet Signature | No | No |
| Fund Agent | `POST /api/platform/agents/:id/fund` | Wallet Signature | No | No |
| Delete Org | `DELETE /api/platform/orgs/:orgId` | Wallet Signature | No | No |
| Create External Agent | `POST /external` | Wallet Signature | No | No |
| List External Types | `GET /external/types` | No | No | No |
| Health Check | `GET /health` | No | No | No |

---

## Database Tables Reference

| Table | Purpose | Critical Columns |
|-------|---------|------------------|
| `organizations` | Org registry | `owner_wallet_address` |
| `agents` | Agent identities | `org_id`, `agent_name` |
| `credentials` | ZK credential data | `commitment`, `secret_hash`, `leaf_index` |
| `merkle_tree` | Incremental tree nodes | `org_id`, `level`, `node_index`, `hash` |
| `revoked_secrets` | Revocation SMT | `smt_key`, `revoked_value` |
| `wallets` | Agent wallets | `wallet_address`, `session_manager_address` |
| `sessions` | On-chain sessions | `session_id`, `public_signals` |
| `events` | Contract events cache | `contract_name`, `event_name`, `tx_hash` |
| `action_authorizations` | Nonce tracking | `nonce`, `wallet_address` |
| `external_agents` | Provider integrations | `linked_agent_id`, `agent_type` |
| `ai_agents` | AI agent configs | `org_id`, `provider`, `model` |

---

## Smart Contract Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CredentialRegistry                        │
│  - Stores activeRoot and revokedSecretRoot                  │
│  - Tracks usedNullifiers                                    │
│  - Manages issuer permissions                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SessionManager                          │
│  - Verifies ZK proofs via Groth16Verifier                   │
│  - Creates sessions with sessionKey + maxValue + expiry     │
│  - Tracks valueUsed per session                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    AgentWallet (ERC-4337)                    │
│  - Smart contract wallet for agent                          │
│  - Session keys can execute within session limits           │
│  - Owner can revoke/add session keys                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   AgentWalletFactory                         │
│  - Deploys AgentWallet instances                            │
│  - CREATE2 for deterministic addresses                      │
│  - createWalletForOrg(orgId, ownerAddress)                  │
└─────────────────────────────────────────────────────────────┘
```

---

*Report generated: 2026-05-12*
*Analyst: Developer Persona Analysis System*
