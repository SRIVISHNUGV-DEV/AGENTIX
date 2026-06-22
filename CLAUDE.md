# CLAUDE.md - Agentix Project Context

> This file provides complete context for AI assistants working on the Agentix codebase.
> Read this at the start of every session before doing anything else.

---

## Project Overview

**Name:** Agentix
**Purpose:** Platform for issuing private agent credentials, verifying authorization with ZK proofs, and creating on-chain sessions/wallets for autonomous agents.
**Repository:** `D:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL`

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 14 (App Router) | Operator UI |
| Backend | Express.js + TypeScript | API server |
| Database | PostgreSQL | Persistent state |
| Queue | BullMQ + Redis | Async proof generation |
| Blockchain | Solidity + Hardhat | Smart contracts on Base Sepolia |
| ZK Proofs | Circom + snarkjs | Groth16 proofs |
| Account Abstraction | ERC-4337 | Smart contract wallets |

---

## Project Tree Structure

```
agentix/
│
├── 📁 backend/                          # Express API Server
│   ├── 📄 package.json                  # Dependencies: express, pg, ethers, snarkjs, bullmq
│   ├── 📄 tsconfig.json                 # TypeScript config
│   │
│   ├── 📁 src/
│   │   ├── 📄 index.ts                  # Server entry point
│   │   ├── 📄 db.ts                     # PostgreSQL connection, schema init
│   │   ├── 📄 migrations.ts             # Versioned database migrations
│   │   │
│   │   ├── 📁 routes/                   # API Endpoints
│   │   │   ├── 📄 orgs.ts               # Organization CRUD
│   │   │   ├── 📄 agents.ts             # Agent registration
│   │   │   ├── 📄 credentials.ts        # Credential issuance
│   │   │   ├── 📄 sessions.ts           # Session management
│   │   │   ├── 📄 wallets.ts            # Wallet operations
│   │   │   ├── 📄 proofs.ts             # Merkle proof generation
│   │   │   ├── 📄 events.ts             # Contract event indexing
│   │   │   ├── 📄 externalAgents.ts     # External AI agent integration
│   │   │   ├── 📄 ai.ts                 # AI agent capabilities
│   │   │   └── 📄 v1.ts                 # API versioning router
│   │   │
│   │   ├── 📁 services/                 # Business Logic Layer
│   │   │   ├── 📄 platform.ts           # Core orchestration
│   │   │   ├── 📄 actionAuth.ts         # Wallet signature verification
│   │   │   ├── 📄 blockchain.ts         # Contract interactions
│   │   │   ├── 📄 merkle.ts             # Poseidon merkle tree
│   │   │   ├── 📄 revocationTree.ts     # Sparse merkle revocation
│   │   │   ├── 📄 prover.ts             # Groth16 proof generation
│   │   │   ├── 📄 proofQueue.ts         # BullMQ queue
│   │   │   ├── 📄 bundler.ts            # ERC-4337 bundler
│   │   │   ├── 📄 eventSync.ts          # Contract event sync
│   │   │   ├── 📄 audit.ts              # Audit trail logging
│   │   │   └── 📄 agentTools.ts         # Agent blockchain tools
│   │   │
│   │   ├── 📁 middleware/
│   │   │   ├── 📄 auth.ts               # JWT/session auth
│   │   │   └── 📄 security.ts           # CORS, rate limiting
│   │   │
│   │   ├── 📁 types/
│   │   │   └── 📄 externalAgent.ts      # External agent types
│   │   │
│   │   └── 📁 utils/
│   │       ├── 📄 errors.ts             # AppError class
│   │       └── 📄 validation.ts         # Input validation
│   │
│   └── 📄 .env.example                  # Environment template
│
├── 📁 frontend/                         # Next.js 14 Operator UI
│   ├── 📄 package.json
│   ├── 📄 tsconfig.json
│   ├── 📄 next.config.mjs
│   ├── 📄 vercel.json                   # Vercel deployment
│   │
│   ├── 📁 app/                         # App Router Pages
│   │   ├── 📄 layout.tsx                # Root layout
│   │   ├── 📄 page.tsx                 # Landing page
│   │   ├── 📁 dashboard/page.tsx       # Org workspace
│   │   ├── 📁 agents/                  # Agent management
│   │   │   ├── 📄 page.tsx             # Agent list
│   │   │   └── 📁 [id]/page.tsx        # Agent detail
│   │   ├── 📁 credentials/             # Credential workflows
│   │   ├── 📁 sessions/                # Session overview
│   │   ├── 📁 events/                  # Event timeline
│   │   ├── 📁 docs/                    # Documentation
│   │   └── 📁 api/                     # API routes (proxies)
│   │
│   ├── 📁 components/                  # React Components
│   │   ├── 📁 wallet/                  # Wallet connection
│   │   ├── 📁 platform/                # Platform actions
│   │   ├── 📁 landing/                 # Landing page sections
│   │   ├── 📁 dashboard/               # Dashboard components
│   │   ├── 📁 agents/                  # Agent components
│   │   ├── 📁 execute/                 # Execution panels
│   │   ├── 📁 effects/                 # 3D effects
│   │   └── 📁 ui/                      # shadcn/ui components
│   │
│   ├── 📁 lib/                         # Utilities
│   │   ├── 📄 wallet-action.ts         # useWalletAction hook
│   │   ├── 📄 api-base.ts              # API client
│   │   ├── 📄 types.ts                 # TypeScript types
│   │   └── 📄 utils.ts                 # General utilities
│   │
│   └── 📁 hooks/                       # Custom hooks
│
├── 📁 contracts/                       # Solidity Smart Contracts
│   ├── 📄 package.json
│   ├── 📄 hardhat.config.ts            # Network config
│   │
│   ├── 📁 src/                         # Contract Source
│   │   ├── 📄 CredentialRegistry.sol   # Credential root storage
│   │   ├── 📄 SessionManager.sol       # Session management + LightweightSession
│   │   ├── 📄 AgentWallet.sol          # ERC-4337 smart account
│   │   ├── 📄 AgentWalletFactory.sol   # Deterministic deployment
│   │   └── 📄 Verifier.sol             # Groth16 verifier
│   │
│   ├── 📁 test/                        # Contract tests
│   │   ├── 📄 AgentWallet.test.ts
│   │   ├── 📄 SessionManager.test.ts
│   │   └── 📄 LightweightSession.test.ts
│   │
│   └── 📁 scripts/                     # Deployment scripts
│
├── 📁 circuits/                        # ZK Circuit Definitions
│   ├── 📄 package.json
│   ├── 📄 credential.circom            # Credential circuit
│   └── 📁 build/                       # Compiled artifacts
│
├── 📁 sdk/                             # Self-Hosted SDK
│   ├── 📄 package.json
│   ├── 📄 README.md
│   └── 📁 src/
│       ├── 📄 index.ts                 # SDK exports
│       ├── 📄 AgentClient.ts           # Main client
│       └── 📄 types.ts                 # TypeScript types
│
├── 📁 docs/                            # Documentation
│   ├── 📁 superpowers/
│   │   ├── 📁 plans/                   # Implementation plans
│   │   └── 📁 specs/                   # Design specs
│
├── 📄 README.md                        # Main documentation
├── 📄 CLAUDE.md                        # This file
├── 📄 AGENTS.md                        # Session context
├── 📄 package.json                     # Workspace root
├── 📄 .env.example                     # Root env template
├── 📄 docker-compose.yml               # Development compose
└── 📄 docker-compose.prod.yml          # Production compose
```

---

## Smart Contract Architecture

### Contract Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    EntryPoint (ERC-4337)                      │
│                  UserOperation entry point                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      AgentWallet                              │
│  Smart account with owner/session execution modes             │
│  - validateUserOp: Owner or valid session                     │
│  - execute: Call target contracts                             │
│  - Lightweight session support (lower gas)                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    SessionManager                             │
│  Two session types:                                           │
│  1. ZK-Proof Sessions (createSession)                         │
│  2. Lightweight Sessions (createLightweightSession)           │
│     - Daily spend/tx limits                                   │
│     - EIP-191 signature verification                          │
│     - No ZK proof required                                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  CredentialRegistry                           │
│  - activeRoot: Current valid merkle root                      │
│  - revokedRoot: Revocation sparse merkle tree                 │
└─────────────────────────────────────────────────────────────┘
```

### Session Types

| Type | Creation | Verification | Gas Cost | Use Case |
|------|----------|--------------|----------|----------|
| ZK-Proof | `createSession(proof, signals)` | Groth16 verification | ~300k gas | Privacy-preserving agents |
| Lightweight | `createLightweightSession(sig, params)` | EIP-191 signature | ~80k gas | Trusted agents, direct control |

---

## Smart Contract Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| Verifier | `0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424` |
| CredentialRegistry | `0xC3F474e08Fe68bBa39daCCE52FC4F11262364701` |
| SessionManager | `0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2` |
| AgentWalletFactory | `0x36ECC27acd245dbac23Ca1bC72798E75BfbA4a84` |
| AgentWallet Impl | `0xB00c0a6A821D054098D3a9D87A93c1fE2A76b4e8` |
| EntryPoint | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| CapabilityRegistry | `0xa3166c63920305B7fBE11f97683B99F239bC7975` |
| DelegationManager | `0x355b30477125c6a2F1323095baf99D3781bABd3B` |

---

## Development Commands

```bash
# Root commands
npm run dev              # Start both frontend and backend
npm run dev:backend      # Start backend only (port 3001)
npm run dev:frontend     # Start frontend only (port 3000)
npm run build            # Build all workspaces
npm run test:contracts   # Run contract tests

# Backend commands
cd backend && npm run dev

# Frontend commands
cd frontend && npm run dev

# Contract commands
cd contracts && npx hardhat compile
cd contracts && npx hardhat test
cd contracts && npx hardhat run scripts/deploy.ts --network sepolia
```

---

## Environment Variables

### Backend (.env)
```bash
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0x...
REDIS_URL=redis://localhost:6379
PORT=3001
NODE_ENV=development
```

### Frontend (.env.local)
```bash
NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=http://127.0.0.1:3001
AGENT_CREDENTIALS_API_URL=http://127.0.0.1:3001
NEXT_PUBLIC_CHAIN_ID=84532
```

---

## Key Implementation Notes

### LightweightSession (New)
The SessionManager now supports two session types:

1. **ZK-Proof Sessions** - Privacy-preserving, requires Groth16 proof
2. **Lightweight Sessions** - Lower gas, EIP-191 signature based

```solidity
// Create lightweight session (in SessionManager.sol)
function createLightweightSession(
    bytes32 sessionId,
    address agentWallet,
    address sessionKey,
    uint256 dailySpendLimit,
    uint256 dailyTxLimit,
    uint256 expiresAt,
    bytes calldata sessionSignature  // EIP-191 signature
) external;

// Validate in AgentWallet
function _validateUserOp(UserOperation calldata userOp) internal {
    // Try lightweight session first (lower gas)
    try ISessionManager(sessionManager).validateLightweightSession(...) {
        // Valid lightweight session
    } catch {
        // Fallback to ZK-proof session
        ISessionManager(sessionManager).validateSession(...);
    }
}
```

### Wallet Authentication
All protected routes use EIP-191 wallet signature verification:

```typescript
// Frontend: wallet-action.ts
const { signAction } = useWalletAction();
const signature = await signAction({ action: "CREATE_ORG", name, timestamp });

// Backend: actionAuth.ts
verifySignature(signature, expectedMessage, walletAddress);
```

---

## Known Gotchas

1. **Port 3000 vs 3001**: Frontend is 3000, Backend is 3001.

2. **Database migrations**: Run migrations via `migrations.ts` on first backend start.

3. **Circuit files required**: Backend needs `circuits/build/credential.wasm` and `.zkey`.

4. **Base Sepolia ETH required**: Need Base Sepolia ETH for contract interactions.

5. **Redis required**: BullMQ proof queue needs Redis running.

6. **Wallet must be on Base Sepolia**: Signature verification checks chain ID 84532.

---

*Last updated: 2026-05-18*
