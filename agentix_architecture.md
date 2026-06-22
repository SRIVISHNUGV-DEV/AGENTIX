# AgentIX Architecture

## System Overview

AgentIX is the Runtime Authority Layer for Autonomous AI Systems. It provides on-chain credential management, session-based execution, and hierarchical delegation for AI agents.

## Core Principles

1. **Authority is on-chain** — All critical authorization decisions happen in smart contracts
2. **Sessions are bounded** — Every session has expiry, budget, and scope limits
3. **Delegation is hierarchical** — Authority flows from organizations → users → agents → sessions
4. **Zero-knowledge when needed** — ZK proofs for credential verification without revealing secrets
5. **Upgradeable but safe** — UUPS proxies with storage gaps and owner-gated upgrades

## Contract Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    AgentIX Contracts                          │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ CredentialRegistry│  │ SessionManager   │                 │
│  │  - activeRoot     │  │  - sessions      │                 │
│  │  - revokedRoot    │  │  - lightSessions │                 │
│  │  - nullifiers     │  │  - verifier      │                 │
│  └────────┬─────────┘  └────────┬─────────┘                 │
│           │                     │                            │
│  ┌────────▼─────────┐  ┌───────▼──────────┐                 │
│  │ CapabilityRegistry│  │ DelegationManager│                 │
│  │  - capabilities   │  │  - roots         │                 │
│  │  - grantRoots     │  │  - revokedLeaves │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  AgentWallet     │  │AgentWalletFactory│                 │
│  │  - owner         │  │  - implementation│                 │
│  │  - sessionMngr   │  │  - walletCount   │                 │
│  │  - whiteList     │  │  - agentWallets  │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────┐                                       │
│  │ Groth16Verifier  │                                       │
│  │  - verifyProof   │                                       │
│  └──────────────────┘                                       │
└──────────────────────────────────────────────────────────────┘
```

## Session Types

### Standard Sessions (ZK-based)
- Created with Groth16 ZK proof of credential ownership
- Cumulative spend limit (maxValue)
- Expiry timestamp
- Nullifier prevents double-use of credential

### Lightweight Sessions (ECDSA-based)
- Created with owner ECDSA signature (no ZK proof)
- Daily spend limit + daily transaction limit
- Automatic daily reset
- Expiry timestamp

## Execution Flow

```
1. Agent calls UserOp to EntryPoint
2. EntryPoint calls AgentWallet.validateUserOp()
3. AgentWallet decodes session ID from signature
4. AgentWallet calls SessionManager.validateSession()
5. SessionManager checks:
   a. Session exists
   b. Not revoked
   c. Not expired
   d. Signer matches session key
   e. Spend limit not exceeded
6. If valid, EntryPoint calls AgentWallet.execute()
7. AgentWallet verifies target is whitelisted
8. AgentWallet executes call to target
```

## Delegation Flow

```
1. Delegator creates delegation tree off-chain
2. Delegator publishes Merkle root on-chain (DelegationManager)
3. Delegate receives delegation leaf + Merkle proof
4. Delegate calls DelegationManager.verifyDelegation()
5. On-chain verification:
   a. Root exists and not expired
   b. Leaf not revoked
   c. Delegation not expired
   d. Depth within limit
   e. Leaf recomputes to expected value
   f. Merkle proof verifies against root
```

## Backend Architecture

```
┌─────────────────────────────────────────────┐
│                Express Server                │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ JWT Auth │  │ API Key  │  │ Wallet   │ │
│  │ (RS256)  │  │ (SHA256) │  │ Sig Auth │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       └──────────────┼──────────────┘       │
│                      │                      │
│  ┌───────────────────▼───────────────────┐  │
│  │           Route Handlers              │  │
│  │  /api/orgs       — Organization CRUD  │  │
│  │  /api/agents     — Agent management   │  │
│  │  /api/sessions   — Session lifecycle  │  │
│  │  /api/external   — External agents    │  │
│  │  /api/ai         — AI API proxy       │  │
│  │  /mcp/sse        — MCP endpoints      │  │
│  └───────────────────┬───────────────────┘  │
│                      │                      │
│  ┌───────────────────▼───────────────────┐  │
│  │           Service Layer               │  │
│  │  sessionKey     — Session lifecycle   │  │
│  │  provisioning   — Agent onboarding    │  │
│  │  externalAgent  — External mgmt       │  │
│  │  delegation     — Permission chains   │  │
│  │  fastProver     — ZK proof gen        │  │
│  │  eventSync      — Blockchain polling  │  │
│  │  merkle         — Merkle tree ops     │  │
│  └───────────────────┬───────────────────┘  │
│                      │                      │
│  ┌───────────────────▼───────────────────┐  │
│  │           Data Layer                  │  │
│  │  PostgreSQL — Primary storage         │  │
│  │  Redis      — Queue + rate limiting   │  │
│  │  Alchemy    — Blockchain RPC          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Security Layers

### Authentication
1. **JWT RS256** — User sessions (15min access, 7d refresh)
2. **API Keys** — Service-to-service (SHA-256 hashed)
3. **Wallet Signatures** — External agent operations (ECDSA)
4. **MCP_API_KEY** — MCP SSE endpoints

### Authorization
1. **Organization scoping** — All queries filtered by org_id
2. **Role-based access** — admin, operator, viewer
3. **Whitelist enforcement** — Only whitelisted targets
4. **Session validation** — On-chain authorization checks

### Encryption
1. **AES-256-GCM** — API keys, session keys at rest
2. **Double encryption** — Session keys (master + session-derived)
3. **TLS** — All transport (HTTPS in production)

### Integrity
1. **Nullifier tracking** — Prevents credential double-use
2. **Merkle proofs** — Cryptographic delegation verification
3. **ZK proofs** — Credential ownership without secret revelation
4. **Reentrancy guards** — Prevents reentrancy attacks

## Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│                  Load Balancer                   │
│                  (nginx/ALB)                     │
└──────────┬──────────────────────┬───────────────┘
           │                      │
    ┌──────▼──────┐        ┌──────▼──────┐
    │  Frontend   │        │  Frontend   │
    │  (Next.js)  │        │  (Next.js)  │
    │  replica 1  │        │  replica 2  │
    └──────┬──────┘        └──────┬──────┘
           │                      │
    ┌──────▼──────────────────────▼──────┐
    │          Backend (Express)          │
    │  replica 1          replica 2      │
    └──────────┬─────────────────────────┘
               │
    ┌──────────▼─────────────────────────┐
    │         PostgreSQL (RDS)           │
    │         Primary + Read Replica     │
    └──────────┬─────────────────────────┘
               │
    ┌──────────▼─────────────────────────┐
    │         Redis (ElastiCache)        │
    │         Queue + Rate Limiting      │
    └──────────┬─────────────────────────┘
               │
    ┌──────────▼─────────────────────────┐
    │      Base Sepolia (Ethereum L2)    │
    │      Smart Contracts               │
    └────────────────────────────────────┘
```

## Scalability Targets (V1)

| Metric | Target | Current Capacity |
|--------|--------|-----------------|
| Organizations | 10 | Unlimited (DB) |
| Users | 100 | Unlimited (DB) |
| Agents | 500 | Unlimited (DB) |
| Sessions/day | 1,000 | Unlimited (on-chain) |
| Contract interactions/day | 10,000 | RPC rate limited |
| Concurrent API requests | 100 | Express + DB pool |

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Smart Contracts | Solidity | 0.8.24 |
| Contract Framework | Hardhat | Latest |
| Contract Libraries | OpenZeppelin | 5.x |
| Backend Runtime | Node.js + TypeScript | 20.x |
| Backend Framework | Express | 4.x |
| Database | PostgreSQL | 15+ |
| Cache/Queue | Redis + BullMQ | Latest |
| Frontend | Next.js | 14.x |
| ZK Circuits | Circom | Latest |
| ZK Prover | snarkjs / rapidsnark | Latest |
| Auth | JWT RS256 | - |
| Encryption | AES-256-GCM | - |
| Blockchain | Base Sepolia | L2 |
| Account Abstraction | ERC-4337 | Latest |
