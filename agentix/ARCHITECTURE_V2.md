# AgentIX V1 — Architecture Specification

> This document is the system contract. Every implementation decision derives from here.
> If a question arises during development, the answer is in this file.
> If it is not in this file, it is not yet designed.

---

## 1. System Overview

AgentIX V1 is a **local-first runtime** that gives AI agents scoped, rate-limited, revocable authorization to transact on-chain. It consists of six independent systems. Each system owns one responsibility. No system talks to another's concern.

```
Agent Harness (Claude, Cursor, Codex, ...)
         │
         ▼
  Harness Detection
         │
         ▼
    AgentIX MCP
         │
    ┌────┼────┐
    ▼    ▼    ▼
  DB  API  Wallet
    │    │    │
    └────┼────┘
         ▼
  Blockchain Adapter
         │
    ┌────┼────┐
    ▼    ▼    ▼
   CR   SM   AWF
```

CR = CredentialRegistry, SM = SessionManager, AWF = AgentWalletFactory

**Rule:** Frontend never touches blockchain code. Everything flows through the API. CLI, MCP, and future clients all share the same service layer.

---

## 2. Deployed Contracts (Base Sepolia)

| Contract | Proxy | Role |
|----------|-------|------|
| Groth16Verifier | `0x1Baa...4f57` | ZK proof verification (non-upgradeable) |
| CredentialRegistry | `0xaC0A...3DEE` | Merkle roots + nullifier tracking |
| SessionManager | `0x2753...51d1` | Session lifecycle + validation |
| AgentWalletFactory | `0x9e6B...FfE3` | Deterministic wallet deployment |
| CapabilityRegistry | `0xa9ff...0aFC` | Capability catalog + grants |
| DelegationManager | `0x73f8...3E38` | Trust delegation chains |
| EntryPoint | `0x4337...F108` | ERC-4337 UserOperation relay |

**Deployer (issuer):** `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`

---

## 3. The Six Systems

### 3.1 Harness Detection Layer

**Responsibility:** "Who am I talking to?"

Detects and stores:

| Field | Type | Description |
|-------|------|-------------|
| harnessId | string | `claude-code`, `cursor`, `codex`, `windsurf`, `cline`, `roo`, `gemini-cli`, `continue`, `unknown` |
| displayName | string | Human-readable name |
| version | string | Detected version |
| capabilities | string[] | `["mcp", "tools", "resources", "prompts"]` |
| mcpVersion | string | Protocol version supported |
| configPath | string | Where the config file lives |
| detectedAt | number | Unix timestamp |

**State machine:** `unknown → detected → connected → active → disconnected`

**Rules:**
- Detection runs on startup and on manual refresh
- Each session belongs to exactly one harness
- Unknown MCP clients get `harnessId: "unknown"` — they still work

---

### 3.2 Credential Engine

**Responsibility:** Credential lifecycle. Never talks to UI. Never talks directly to blockchain.

**State machine:**

```
issue → active → revoked
         ↑
import ─┘
```

**Operations:**

| Operation | Input | Output | On-chain? |
|-----------|-------|--------|-----------|
| `issue` | orgId, budgetLimit, expiry, walletAddress, ownerAddress | credentialId, commitment, secret, agentId | No (local Merkle tree) |
| `import` | secret, walletAddress | credentialId, commitment | No |
| `verify` | credentialId | valid, reason | No |
| `revoke` | organizationId, agentId | activeRoot, revokedRoot | No (local trees) |
| `generateProof` | credentialId, sessionId, sessionNonce | groth16Proof, publicSignals, nullifier | No (client-side ZK) |
| `generateLightweightSession` | walletAddress, ownerAddress, options | sessionId, ownerSignature | No |

**Commitment scheme (Poseidon(7)):**

```
commitment = Poseidon(agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret)
```

**Nullifier (for ZK sessions):**

```
nullifier = Poseidon(orgId, secret, sessionNonce)
```

**Credential record (SQLite):**

| Column | Type | Description |
|--------|------|-------------|
| credential_id | TEXT PK | keccak256(commitment, budgetLimit) |
| organization_id | TEXT | "0" for standalone, org UUID otherwise |
| agent_id | INTEGER | Auto-incrementing |
| commitment | TEXT | Poseidon(7) hash |
| secret | TEXT | 32-byte hex (shown once, never stored on-chain) |
| wallet_address | TEXT | ERC-4337 wallet bound to this credential |
| budget_limit | TEXT | ETH value |
| credential_version | INTEGER | Currently 1 |
| expiry | INTEGER | Unix timestamp or block number |
| revoked | INTEGER | 0 or 1 |
| created_at | INTEGER | Unix timestamp |

**Merkle tree (local):**
- Active tree: Poseidon Merkle, depth 10, leaves = commitments
- Revoked tree: SMT, depth 10, keys = truncated Poseidon(secret, 0)
- Trees are per-organization (standalone uses key `"standalone"`)
- Roots are pushed on-chain only if backend signer is an issuer

---

### 3.3 Session Engine

**Responsibility:** Session lifecycle. Nothing else.

**Two session types:**

#### Standard Session (ZK-proof-based)

```
Wallet calls SessionManager.createSession(
    sessionId,
    wallet,
    sessionKey,
    maxValue,
    expiry,
    proof.a, proof.b, proof.c,
    publicSignals[activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier]
)
```

- Requires Groth16 proof
- Cumulative spend limit (`maxValue`)
- Nullifier prevents replay
- Session key ≠ wallet address

#### Lightweight Session (ECDSA-based)

```
Wallet calls SessionManager.createLightweightSession(
    sessionId,
    sessionKey,
    dailySpendLimit,
    dailyTxLimit,
    expiry,
    ownerSignature
)
```

- Owner signs `(chainId, sessionManager, wallet, sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry)`
- Daily spend + daily tx limits (reset at midnight UTC)
- No ZK proof needed
- Session key ≠ wallet address

**State machine:**

```
create → active → expired
           ↓
        revoked
```

**Session record (SQLite):**

| Column | Type | Description |
|--------|------|-------------|
| session_id | TEXT PK | bytes32 hex |
| wallet_address | TEXT | AgentWallet address |
| session_key | TEXT | Address authorized to sign |
| session_type | INTEGER | 0 = standard, 1 = lightweight |
| organization_id | TEXT | Optional |
| daily_spend_limit | TEXT | ETH (lightweight only) |
| daily_tx_limit | INTEGER | Count (lightweight only) |
| max_value | TEXT | ETH (standard only) |
| expiry | INTEGER | Unix timestamp |
| revoked | INTEGER | 0 or 1 |
| created_at | INTEGER | Unix timestamp |

**Rules:**
- `sessionKey` must NOT be the wallet address (contract enforces)
- Max 100 sessions per wallet (contract enforces)
- Expired sessions can be pruned on-chain via `pruneExpiredSessions()`
- Session validation is called by the AgentWallet during `validateUserOp`, not by the frontend

---

### 3.4 Wallet Engine

**Responsibility:** Wallet lifecycle, UserOperation construction, signature orchestration. No UI logic.

**State machine:**

```
create → deployed → active
                      ↓
                   frozen (ownership transfer pending)
```

**Operations:**

| Operation | Who signs | On-chain |
|-----------|-----------|----------|
| `createWallet` | Owner (EOA tx to factory) | Yes |
| `depositGas` | Owner (EOA tx to wallet `addDeposit()`) | Yes |
| `whitelistSelector` | Owner (EOA tx to wallet `setWhiteListedSelector()`) | Yes |
| `createSession` | Owner signs session params, wallet calls SM | Yes |
| `execute` | Owner or session key via UserOp | Yes (via EntryPoint) |
| `executeBatch` | Owner or session key via UserOp | Yes (via EntryPoint) |

**UserOperation validation (on-chain, in AgentWallet):**

```
validateUserOp(userOp, userOpHash, missingAccountFunds):
    if signature.length == 65:
        signer = recover(userOpHash, signature)
        if signer != owner: REVERT
        return 0  // owner direct — no session check
    else:
        (sessionId, sessionSignature) = decode(signature)
        signer = recover(userOpHash, sessionSignature)
        sessionType = SessionManager.getSessionType(sessionId)
        if sessionType == 0:
            SessionManager.validateSession(sessionId, signer, spendValue)
        else:
            SessionManager.validateLightweightSession(sessionId, signer, spendValue)
        return 0
```

**Selector whitelist:**
- Every `execute()` call checks `whiteListedSelectors[target][selector]`
- The wallet engine auto-whitelists known selectors during setup
- New selectors require owner approval (see §7)

**Wallet record (SQLite):**

| Column | Type | Description |
|--------|------|-------------|
| wallet_address | TEXT PK | Contract address |
| owner_address | TEXT | EOA that controls the wallet |
| organization_id | TEXT | Optional |
| agent_id | INTEGER | Optional |
| entry_point | TEXT | EntryPoint address |
| created_at | INTEGER | Unix timestamp |

---

### 3.5 Blockchain Adapter

**Responsibility:** The ONLY module that touches ethers/viem. Everything else calls this.

**Owned operations:**

| Category | Operations |
|----------|-----------|
| Read | `activeRoot()`, `revokedSecretRoot()`, `isNullifierUsed()`, `balanceOf()`, `getDeposit()`, `getSession()`, `getLightSession()`, `getWalletSessions()`, `isAgentWallet()`, `owner()` |
| Write | `updateActiveRoot()`, `updateRevokedSecretRoot()`, `markNullifierUsed()`, `createWallet()`, `depositTo()`, `addDeposit()`, `execute()`, `setWhiteListedSelector()` |
| Estimate | Gas estimation for all write operations |
| Wait | Transaction receipt polling with timeout |
| Events | Subscribe to `WalletCreated`, `SessionCreated`, `LightSessionCreated`, `ExecutionPerformed` |

**Rules:**
- All contract calls go through `BlockchainAdapter`
- Adapter handles retry (3 attempts with exponential backoff)
- Adapter handles nonce management
- Adapter simulates before sending (eth_call before eth_sendTransaction)
- Adapter never stores private keys — uses `getSigner()` from provider module

---

### 3.6 Local Database (SQLite)

**Responsibility:** Cache everything. Nothing leaves the machine.

**Complete schema:**

```sql
-- Configuration
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Organizations
CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    org_numeric_id INTEGER,
    active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- Organization registration requests
CREATE TABLE organization_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    eip712_signature TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL
);

-- Credential Merkle roots (audit trail)
CREATE TABLE credential_roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root TEXT NOT NULL,
    organization_id TEXT,
    epoch INTEGER,
    created_at INTEGER NOT NULL
);

-- Revocation roots (audit trail)
CREATE TABLE revocation_roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root TEXT NOT NULL,
    organization_id TEXT,
    epoch INTEGER,
    created_at INTEGER NOT NULL
);

-- Credentials
CREATE TABLE credentials (
    credential_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    agent_id INTEGER NOT NULL,
    nullifier TEXT,
    secret TEXT NOT NULL,
    permissions INTEGER,
    expiry INTEGER NOT NULL,
    revoked INTEGER DEFAULT 0,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    wallet_address TEXT,
    budget_limit TEXT,
    credential_version INTEGER DEFAULT 1,
    commitment TEXT NOT NULL
);

-- Wallets
CREATE TABLE wallets (
    wallet_address TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    organization_id TEXT,
    agent_id INTEGER,
    entry_point TEXT,
    created_at INTEGER NOT NULL
);

-- Sessions
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    session_key TEXT,
    organization_id TEXT,
    session_type INTEGER DEFAULT 0,
    daily_spend_limit TEXT,
    daily_tx_limit INTEGER,
    max_value TEXT,
    expiry INTEGER NOT NULL,
    revoked INTEGER DEFAULT 0,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
);

-- Proofs (audit trail)
CREATE TABLE proofs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id TEXT,
    session_id TEXT,
    proof_data TEXT,
    public_signals TEXT,
    created_at INTEGER NOT NULL
);

-- Capabilities
CREATE TABLE capabilities (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    action TEXT NOT NULL,
    effect TEXT DEFAULT 'allow',
    constraints TEXT,
    created_at INTEGER NOT NULL
);

-- Delegations
CREATE TABLE delegations (
    id TEXT PRIMARY KEY,
    delegator TEXT NOT NULL,
    delegate TEXT NOT NULL,
    scope TEXT NOT NULL,
    parent_id TEXT,
    depth INTEGER DEFAULT 0,
    revoked INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Agent actions (audit trail)
CREATE TABLE agent_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT,
    session_id TEXT,
    tool TEXT,
    intent TEXT,
    risk_level TEXT,
    success INTEGER,
    details TEXT,
    timestamp INTEGER NOT NULL
);

-- Backups
CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    backup_id TEXT NOT NULL,
    description TEXT,
    size INTEGER,
    checksum TEXT,
    created_at INTEGER NOT NULL
);

-- Metadata
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Merkle tree snapshots
CREATE TABLE merkle_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT,
    tree_type TEXT,
    root TEXT,
    epoch INTEGER,
    leaf_count INTEGER,
    created_at INTEGER NOT NULL
);

-- Harness detections
CREATE TABLE harnesses (
    harness_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    version TEXT,
    capabilities TEXT,
    mcp_version TEXT,
    config_path TEXT,
    status TEXT DEFAULT 'detected',
    detected_at INTEGER NOT NULL
);

-- Transactions (pending + confirmed)
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT,
    tx_hash TEXT,
    to_address TEXT,
    value TEXT,
    data TEXT,
    status TEXT DEFAULT 'pending',
    block_number INTEGER,
    gas_used INTEGER,
    created_at INTEGER NOT NULL
);
```

---

## 4. User Flows

### 4.1 Standalone User (No Organization)

```
1. Install AgentIX
2. Detect harness → store in DB
3. User connects browser wallet (MetaMask)
4. User clicks "Create Agent Wallet"
   → Backend prepares createWallet calldata
   → Frontend sends EOA tx to AgentWalletFactory
   → WalletCreated event emitted
   → Wallet recorded in DB
5. User clicks "Create Lightweight Session"
   → Backend generates sessionId
   → User signs session params (personal_sign)
   → Backend whitelists SessionManager.createLightweightSession selector on wallet
   → Backend constructs wallet.execute() calldata targeting SessionManager
   → Frontend sends EOA tx to wallet
   → Session created on-chain + recorded in DB
6. User clicks "Fund Wallet"
   → Backend prepares addDeposit calldata
   → Frontend sends EOA tx to wallet with ETH value
   → EntryPoint balance updated
7. Agent performs actions
   → Agent constructs UserOperation
   → Signs with session key
   → EntryPoint validates via AgentWallet.validateUserOp
   → SessionManager validates session + updates daily limits
   → AgentWallet.execute() forwards to target
   → Action logged in DB
8. Owner approves sensitive actions
   → See §7 (Owner Approval)
```

**No ZK. No organization. Five on-chain transactions total.**

### 4.2 Organization User

```
1. User connects wallet
2. User submits organization request
   → POST /api/organizations/requests
   → Request stored in DB with status "pending"
3. Authority approves request
   → POST /api/organizations/requests/:id { action: "approve" }
   → Organization created in DB
   → (Future: on-chain OrganizationRegistry.registerOrganization)
4. Authority issues credential
   → POST /api/credentials { orgId, budgetLimit, expiry, walletAddress }
   → Backend computes Poseidon(7) commitment
   → Commitment added to local Merkle tree
   → Credential stored in DB
   → (Optional) Root pushed to CredentialRegistry on-chain
5. Agent generates ZK proof (client-side)
   → Uses circomlibjs + proving key
   → Inputs: secret, agentId, orgId, budgetLimit, expiry, sessionNonce, Merkle proofs
   → Outputs: Groth16 proof + publicSignals + nullifier
6. Session created via ZK proof
   → wallet.execute(SessionManager, 0, createSessionCalldata)
   → SessionManager verifies proof on-chain
   → Nullifier marked as used
   → Session active
7. Agent performs actions (same as standalone step 7)
```

---

## 5. API Endpoints

Every feature goes through the API. No exceptions.

### 5.1 Health & Status

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/stats` | Aggregate counts (orgs, creds, wallets, sessions, proofs) |
| GET | `/api/config` | Current configuration |
| PUT | `/api/config` | Update configuration |

### 5.2 Organizations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/organizations` | List all organizations |
| GET | `/api/organizations/:id` | Get organization by ID |
| GET | `/api/organizations/requests` | List pending requests |
| POST | `/api/organizations/requests` | Submit new request |
| POST | `/api/organizations/requests/:id` | Approve or reject request |

### 5.3 Credentials

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/credentials` | List all credentials |
| GET | `/api/credentials/orgs` | List orgs for dropdown |
| GET | `/api/credentials/next-agent-id` | Next auto-increment agent ID |
| GET | `/api/credentials/oracle` | On-chain oracle state (roots, ETH price) |
| POST | `/api/credentials` | Issue new credential |
| POST | `/api/credentials/update-root` | Push Merkle root on-chain (server-side) |

### 5.4 Wallets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wallets` | List all wallets |
| POST | `/api/wallets` | Create wallet (DB record) |
| POST | `/api/wallets/create-tx` | Prepare createWallet calldata |
| POST | `/api/wallets/confirm` | Record wallet after on-chain creation |
| POST | `/api/wallets/execute-tx` | Prepare execute calldata |
| POST | `/api/wallets/whitelist-tx` | Prepare whitelist update calldata |
| POST | `/api/wallets/deposit-tx` | Prepare addDeposit calldata |
| POST | `/api/wallets/entrypoint-deposit-tx` | Prepare EntryPoint depositTo calldata |

### 5.5 Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions (optional `?wallet=` filter) |
| GET | `/api/sessions/all` | List all sessions |
| POST | `/api/sessions` | Record session in DB |
| POST | `/api/sessions/create-lightweight-tx` | Prepare lightweight session calldata |
| DELETE | `/api/sessions` | Revoke session |

### 5.6 Trees

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trees` | Get tree for org (optional `?orgId=`) |
| GET | `/api/trees/all` | Get all trees (standalone + orgs) |

### 5.7 Actions & Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/actions` | Agent action audit trail |
| GET | `/api/events` | Event bus history |

### 5.8 Backups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/backups` | List backups |
| POST | `/api/backups` | Create backup |

### 5.9 Diagnostics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/diagnostics` | System health checks |
| GET | `/api/contracts` | List all proxy addresses |
| GET | `/api/price` | ETH/USD price |

### 5.10 Onboarding

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/onboarding/status` | Initialization status |
| GET | `/api/onboarding/diagnostics` | Full diagnostics |
| GET | `/api/onboarding/harnesses` | Detect harnesses |
| POST | `/api/onboarding/harnesses/connect` | Connect all harnesses |
| POST | `/api/onboarding/init` | Initialize runtime |
| POST | `/api/onboarding/fund` | Get fiat on-ramp options |

---

## 6. MCP Tools

The MCP server exposes these tools to AI agents. Each tool maps to exactly one service operation.

### Agent Lifecycle
| Tool | Description |
|------|-------------|
| `agentix_wallet_create` | Create agent wallet |
| `agentix_wallet_info` | Get wallet state |
| `agentix_wallet_whitelist` | Manage selector whitelist |
| `agentix_wallet_execute` | Execute transaction through wallet |
| `agentix_wallet_deposit_gas` | Deposit ETH to EntryPoint |

### Credentials & Sessions
| Tool | Description |
|------|-------------|
| `agentix_cred_issue` | Issue credential |
| `agentix_cred_revoke` | Revoke credential |
| `agentix_cred_list` | List credentials |
| `agentix_session_create` | Create session |
| `agentix_session_validate` | Validate session |
| `agentix_session_revoke` | Revoke session |

### Trees & Proofs
| Tool | Description |
|------|-------------|
| `agentix_tree_status` | Get Merkle tree state |
| `agentix_tree_rebuild` | Rebuild tree from DB |
| `agentix_tree_export` | Export tree data |
| `agentix_proof_generate` | Generate ZK proof |
| `agentix_proof_verify` | Verify ZK proof |

### Organizations & Capabilities
| Tool | Description |
|------|-------------|
| `agentix_org_create` | Create organization |
| `agentix_org_get` | Get organization |
| `agentix_org_list` | List organizations |
| `agentix_delegation_create` | Create delegation |
| `agentix_delegation_list` | List delegations |
| `agentix_capability_register` | Register capability |
| `agentix_capability_list` | List capabilities |

### System
| Tool | Description |
|------|-------------|
| `agentix_health` | Health check |
| `agentix_diagnostics` | Full diagnostics |
| `agentix_contracts` | List contract addresses |
| `agentix_rpc_test` | Test RPC connectivity |
| `agentix_protocol_doc` | Protocol documentation |

---

## 7. Owner Approval

The owner **never signs opaque bytes.** Every signature request produces a human-readable summary before `eth_signTypedData_v4` is called.

**Signature request format:**

```json
{
  "domain": { "name": "AgentIX", "version": "1", "chainId": 84532, "verifyingContract": "<walletAddress>" },
  "types": {
    "AgentAction": [
      { "name": "action", "type": "string" },
      { "name": "target", "type": "address" },
      { "name": "value", "type": "uint256" },
      { "name": "reason", "type": "string" },
      { "name": "maxCost", "type": "string" },
      { "name": "session", "type": "string" },
      { "name": "expiresAt", "type": "uint256" }
    ]
  },
  "message": {
    "action": "Transfer",
    "target": "0xRecipientAddress",
    "value": "500000000000000000",
    "reason": "Swap USDC for ETH",
    "maxCost": "$100",
    "session": "Session #54",
    "expiresAt": 1719400000
  }
}
```

**Sensitive action categories:**

| Category | Examples | Approval |
|----------|---------|----------|
| Read-only | View balance, query state | Auto-approve |
| Low-value transfer | < $10 | Session-approved |
| High-value transfer | ≥ $10 | Owner signTypedData |
| Contract interaction | Swap, bridge | Owner signTypedData |
| Admin | Change owner, upgrade impl | 2FA timelock (24h) |

---

## 8. Agent Capability Interface

The AI agent **never sees private keys.** It receives a capability envelope:

```json
{
  "wallet": "0xAgentWallet",
  "budget": { "total": "500 USDC", "remaining": "312 USDC" },
  "session": { "id": "0xSessionId", "type": "lightweight", "expiresAt": "2024-12-31" },
  "allowed": [
    { "action": "erc20.transfer", "target": "USDC", "maxAmount": "100 USDC" },
    { "action": "erc20.transfer", "target": "ETH", "maxAmount": "0.5 ETH" },
    { "action": "uniswap.swap", "pair": "USDC/ETH", "maxSlippage": "1%" }
  ],
  "forbidden": [
    "wallet.upgradeImplementation",
    "wallet.changeOwner",
    "wallet.withdrawDeposit"
  ]
}
```

The LLM reasons using this envelope. It never constructs raw transactions — it declares intent, and the wallet engine translates intent into calibrated UserOperations.

---

## 9. Automatic Whitelist

The user never manually whitelists selectors.

**On wallet creation:**

```
1. Wallet created via factory
2. Backend detects known MCP tools for connected harness
3. Backend maps tools to contract selectors:
   - erc20.transfer → 0xa9059cbb (IERC20.transfer)
   - erc20.approve → 0x095ea7b3 (IERC20.approve)
   - weth.deposit → 0xd0e30db0 (WETH.deposit)
   - weth.withdraw → 0x2e1a7d4d (WETH.withdraw)
   - uniswap.swapExactTokensForTokens → 0x38ed1739 (Uniswap V2)
4. Backend calls wallet.setWhiteListedSelectorBatch() via owner tx
5. Done
```

**When a new selector appears:**

```
Agent wants to call: approve(address,uint256)
Target: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC)
Function: approve(spender, amount)
Token: USDC

[Always Allow]  [This Session]  [Deny]
```

---

## 10. Dashboard Design

The dashboard answers one question: **"What is my agent doing right now?"**

### Home Screen

```
┌─────────────────────────────────────────────────┐
│  Connected Harness: Claude Code v1.2.3          │
│  Agent Status: Active                           │
│  Current Session: Lightweight #0x3a...f2        │
│  Budget Remaining: 0.312 / 0.5 ETH              │
│  Last Transaction: 2 min ago — 0.01 ETH transfer│
│  Pending Approvals: 0                           │
│  Credential Status: Active (expires in 28 days) │
│  Security Alerts: None                          │
└─────────────────────────────────────────────────┘
```

### Developer Mode (togglable)

Shows: contract addresses, Merkle roots, session IDs, raw transaction data, gas costs, block numbers.

### Page list (production)

| Page | Purpose |
|------|---------|
| Overview | Agent status, budget, last actions |
| Wallets | Agent wallets with balances and session counts |
| Sessions | Active sessions with limits and usage |
| Credentials | Credential list with secrets (reveal once) |
| Organizations | Org management (if applicable) |
| Actions | Full audit trail |
| Settings | RPC, network, harness config |
| Diagnostics | System health |

**Merkle trees** are visible in Developer Mode or via the Credentials page detail view — not a top-level navigation item for regular users.

---

## 11. Error States and Recovery

| Error | Recovery |
|-------|----------|
| RPC disconnected | Show warning, queue transactions, retry on reconnect |
| Wallet not connected | Prompt connect, block send operations |
| Insufficient gas | Show deposit prompt, guide to fund wallet |
| Session expired | Prompt new session creation |
| Session revoked | Show revocation reason, prompt new session |
| Credential revoked | Show revocation notice, block new sessions |
| Merkle root mismatch | Rebuild local tree, re-push to chain |
| Nullifier already used | Session already exists — fetch existing |
| Transaction reverted | Decode revert reason, show to user |
| Harness disconnected | Show reconnect prompt, preserve session state |
| Database corruption | Restore from latest backup |
| Backup failed | Log error, continue operating (backups are non-critical) |

---

## 12. Cache Lifecycle

| Data | Cache TTL | Refresh Trigger |
|------|-----------|-----------------|
| ETH price | 60 seconds | Manual or on credential issue |
| On-chain roots | 30 seconds | Manual or on credential issue |
| Session state | Real-time (event subscription) | SessionCreated, LightSessionUsed, SessionRevoked |
| Wallet balance | 15 seconds | Manual or on execution |
| Harness detection | On startup + manual | Refresh button |
| Contract addresses | Never (static from config) | Config change |
| Diagnostic checks | On demand | Refresh button |

---

## 13. Background Jobs

| Job | Frequency | Description |
|-----|-----------|-------------|
| Session expiry check | Every 60s | Mark expired sessions in DB |
| Price oracle poll | Every 60s | Update ETH/USD price |
| Event indexer | Continuous | Listen for on-chain events, update DB |
| Backup rotation | Daily | Auto-backup if configured |
| Session pruning | On demand | Call `pruneExpiredSessions()` on-chain |

---

## 14. File Structure (Target)

```
agentix/
├── apps/
│   └── dashboard/              # Next.js 14 + Tailwind + Framer Motion
│       └── src/
│           ├── app/            # Next.js app router
│           ├── components/     # Shared UI components
│           └── sections/       # Page components (thin — delegate to API)
├── packages/
│   ├── shared/                 # Types, schemas, constants, utils
│   └── core/
│       ├── eventbus/           # Pub/sub
│       ├── database/           # SQLite (schema in §3.6)
│       ├── tree-engine/        # Merkle tree management
│       ├── backup-engine/      # Backup/restore
│       ├── harness-adapter/    # Harness detection
│       └── ai-harness/         # Intent, Policy, Safety, Router
├── packages/services/
│   ├── credential-service/     # Credential lifecycle (§3.2)
│   ├── session-service/        # Session lifecycle (§3.3)
│   ├── wallet-service/         # Wallet lifecycle (§3.4)
│   ├── organization-service/   # Organization CRUD
│   ├── authority-service/      # Org onboarding
│   └── proof-service/          # ZK proof generation
├── src/
│   ├── core/                   # Config, provider, proxy-guard, logger
│   ├── contracts/              # ABI loading, contract instances
│   ├── blockchain/             # BlockchainAdapter (§3.5) — ONLY ethers touchpoint
│   ├── tools/                  # Tool modules (maps to MCP tools)
│   ├── trees/                  # Merkle tree implementations
│   ├── mcp/                    # MCP server
│   ├── runtime/                # HTTP API server (routes map to §5)
│   └── index.ts                # CLI
├── contracts/                  # Solidity smart contracts
├── circuits/                   # Circom ZK circuits
└── sdk/                        # TypeScript SDK for external consumers
```

---

## 15. What NOT to Build

| Don't | Why |
|-------|-----|
| Don't let frontend call ethers | All blockchain through API → BlockchainAdapter |
| Don't store private keys in DB | Keys live in env vars or OS keychain only |
| Don't build complex UI before services | Services are the product; UI is a view |
| Don't add features not in this spec | YAGNI. Ship V1, iterate. |
| Don't mock data | Real flows only. If it can't work, it shouldn't exist. |
| Don't create "placeholder" pages | Every page must connect to a real endpoint |
| Don't add comments to code | The code should be self-documenting |
| Don't create abstractions for one consumer | If only one thing uses it, inline it |

---

*This document is the source of truth. When implementation diverges from this spec, the spec wins until formally amended.*
