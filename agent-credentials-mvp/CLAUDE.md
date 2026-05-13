# CLAUDE.md - Agentix Project Context

> This file provides complete context for AI assistants working on the Agentix codebase.
> Read this at the start of every session before doing anything else.

---

## Project Overview

**Name:** Agentix (agent-credentials-mvp)
**Purpose:** Platform for issuing private agent credentials, verifying authorization with ZK proofs, and creating on-chain sessions/wallets for autonomous agents.
**Repository:** `D:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp`

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 14 (App Router) | Operator UI |
| Backend | Express.js + TypeScript | API server |
| Database | PostgreSQL | Persistent state |
| Queue | BullMQ + Redis | Async proof generation |
| Blockchain | Solidity + Hardhat | Smart contracts on Sepolia |
| ZK Proofs | Circom + snarkjs | Groth16 proofs |
| Account Abstraction | ERC-4337 | Smart contract wallets |

---

## Project Tree Structure

```
agent-credentials-mvp/
│
├── 📁 backend/                          # Express API Server
│   ├── 📄 package.json                  # Dependencies: express, pg, ethers, snarkjs, bullmq
│   ├── 📄 tsconfig.json                 # TypeScript config
│   │
│   ├── 📁 src/
│   │   ├── 📄 index.ts                  # Server entry point, middleware setup, routes mount
│   │   ├── 📄 db.ts                     # PostgreSQL connection, schema init, query helpers
│   │   │
│   │   ├── 📁 routes/                   # API Endpoints
│   │   │   ├── 📄 orgs.ts               # Organization CRUD, deploy contracts, fund org
│   │   │   ├── 📄 agents.ts             # Agent registration, listing, types
│   │   │   ├── 📄 credentials.ts        # Credential issuance, revocation, verification
│   │   │   ├── 📄 sessions.ts           # Session creation, status, listing
│   │   │   ├── 📄 wallets.ts            # Wallet deployment, funding, balance
│   │   │   ├── 📄 proofs.ts             # Merkle proof generation for credentials
│   │   │   ├── 📄 events.ts             # Contract event indexing, event feed
│   │   │   ├── 📄 externalAgents.ts     # External AI agent integration (Claude, LangChain, etc.)
│   │   │   ├── 📄 ai.ts                 # AI agent capabilities endpoint
│   │   │   ├── 📄 auth.ts               # Legacy session auth (deprecated, use wallet auth)
│   │   │   ├── 📄 simple.ts             # Simple health/status endpoints
│   │   │   └── 📄 v1.ts                 # API versioning router
│   │   │
│   │   ├── 📁 services/                 # Business Logic Layer
│   │   │   ├── 📄 platform.ts           # Core orchestration: orgs, agents, credentials, sessions
│   │   │   ├── 📄 actionAuth.ts         # Wallet signature verification, nonce management
│   │   │   ├── 📄 blockchain.ts         # Contract interactions, deployments, RPC calls
│   │   │   ├── 📄 merkle.ts             # Incremental Poseidon merkle tree
│   │   │   ├── 📄 revocationTree.ts     # Sparse merkle tree for revocation
│   │   │   ├── 📄 prover.ts             # Groth16 proof generation
│   │   │   ├── 📄 proofQueue.ts         # BullMQ queue for async proof generation
│   │   │   ├── 📄 bundler.ts            # ERC-4337 bundler integration
│   │   │   ├── 📄 eventSync.ts          # Contract event sync to database
│   │   │   ├── 📄 credential.ts         # Credential-specific utilities
│   │   │   ├── 📄 session.ts            # Session-specific utilities
│   │   │   ├── 📄 externalAgent.ts      # External agent service layer
│   │   │   └── 📄 auth.ts               # Legacy auth service (deprecated)
│   │   │
│   │   ├── 📁 middleware/
│   │   │   ├── 📄 auth.ts               # JWT/session auth middleware
│   │   │   └── 📄 security.ts           # CORS, rate limiting, security headers
│   │   │
│   │   ├── 📁 types/
│   │   │   ├── 📄 externalAgent.ts      # External agent TypeScript types
│   │   │   └── 📄 http.ts               # HTTP request/response types
│   │   │
│   │   └── 📁 utils/
│   │       ├── 📄 errors.ts             # AppError class, error handlers
│   │       ├── 📄 validation.ts         # Input validation helpers
│   │       ├── 📄 crypto.ts             # Cryptographic utilities
│   │       └── 📄 monitoring.ts         # Logging, metrics
│   │
│   ├── 📁 db/
│   │   └── 📄 schema.sql                # Reference SQL schema (db.ts applies migrations)
│   │
│   ├── 📁 scripts/
│   │   └── 📄 migrate-to-postgres.ts    # SQLite to PostgreSQL migration script
│   │
│   ├── 📁 docs/
│   │   └── 📄 DATABASE_MIGRATION.md     # Migration documentation
│   │
│   └── 📄 .env.example                  # Environment template: DATABASE_URL, RPC_URL, PRIVATE_KEY
│
├── 📁 frontend/                         # Next.js 14 Operator UI
│   ├── 📄 package.json                  # Dependencies: next, react, ethers, wagmi, viem
│   ├── 📄 tsconfig.json
│   ├── 📄 next.config.mjs
│   ├── 📄 vercel.json                   # Vercel deployment config
│   ├── 📄 components.json               # shadcn/ui config
│   │
│   ├── 📁 app/                          # Next.js App Router Pages
│   │   ├── 📄 layout.tsx                # Root layout with providers
│   │   ├── 📄 page.tsx                  # Landing page with 3D neural hero
│   │   │
│   │   ├── 📁 dashboard/
│   │   │   └── 📄 page.tsx              # Org workspace, contracts, treasury
│   │   │
│   │   ├── 📁 agents/
│   │   │   ├── 📄 page.tsx              # Agent inventory list
│   │   │   ├── 📄 new/page.tsx          # Create new agent form
│   │   │   └── 📁 [id]/
│   │   │       └── 📄 page.tsx          # Agent detail: credential, wallet, session
│   │   │
│   │   ├── 📁 agent/[id]/
│   │   │   └── 📄 page.tsx              # Alternative agent detail view
│   │   │
│   │   ├── 📁 ai-agents/
│   │   │   └── 📄 page.tsx              # Provider-first AI agent connect flow
│   │   │
│   │   ├── 📁 external-agents/
│   │   │   └── 📄 page.tsx              # External agent integrations
│   │   │
│   │   ├── 📁 credentials/
│   │   │   ├── 📄 page.tsx              # Credentials overview
│   │   │   └── 📁 issue/
│   │   │       └── 📄 page.tsx          # Issue new credential form
│   │   │
│   │   ├── 📁 sessions/
│   │   │   └── 📄 page.tsx              # Sessions overview
│   │   │
│   │   ├── 📁 events/
│   │   │   └── 📄 page.tsx              # Contract event feed
│   │   │
│   │   ├── 📁 docs/
│   │   │   └── 📄 page.tsx              # Documentation page
│   │   │
│   │   ├── 📁 sdk/
│   │   │   └── 📄 page.tsx              # SDK integration guide
│   │   │
│   │   ├── 📁 integration/
│   │   │   └── 📄 page.tsx              # Integration steps
│   │   │
│   │   ├── 📁 login/
│   │   │   └── 📄 page.tsx              # Login page (legacy)
│   │   │
│   │   └── 📁 api/                      # Next.js API Routes (proxy to backend)
│   │       ├── 📁 auth/                 # Auth routes (login, logout, register, me)
│   │       ├── 📁 external/             # External agent proxy
│   │       ├── 📁 ai/                   # AI agent proxy
│   │       └── 📁 platform/             # Platform API proxy
│   │           ├── 📁 agents/           # Agent CRUD, credential, wallet, session, fund
│   │           ├── 📁 orgs/             # Org CRUD, deploy, fund
│   │           ├── 📁 wallets/          # UserOp prepare, submit, status
│   │           └── 📁 org/              # Org select
│   │
│   ├── 📁 components/                   # React Components
│   │   │
│   │   ├── 📁 wallet/
│   │   │   ├── 📄 wallet-provider.tsx   # EIP-6963 wallet connection, wagmi config
│   │   │   └── 📄 connect-wallet-button.tsx
│   │   │
│   │   ├── 📁 platform/
│   │   │   ├── 📄 agent-actions.tsx     # Credential, wallet, session, revoke buttons
│   │   │   ├── 📄 org-actions.tsx       # Deploy contracts, fund org buttons
│   │   │   ├── 📄 create-org-form.tsx   # Organization creation form
│   │   │   ├── 📄 wallet-userop-panel.tsx # ERC-4337 user operation UI
│   │   │   └── 📄 workspace-controls.tsx # Org switching, refresh controls
│   │   │
│   │   ├── 📁 landing/
│   │   │   ├── 📄 hero-section.tsx      # Main hero with CTA
│   │   │   ├── 📄 neural-core.tsx       # 3D animated neural visualization
│   │   │   ├── 📄 features-section.tsx  # Feature cards
│   │   │   ├── 📄 security-section.tsx  # Security highlights
│   │   │   ├── 📄 developer-section.tsx # Developer integration
│   │   │   ├── 📄 integration-section.tsx
│   │   │   ├── 📄 protocol-grid.tsx
│   │   │   ├── 📄 platform-section.tsx
│   │   │   ├── 📄 cta-section.tsx
│   │   │   └── 📄 footer-section.tsx
│   │   │
│   │   ├── 📁 dashboard/
│   │   │   ├── 📄 overview-cards.tsx    # Stats cards
│   │   │   ├── 📄 agents-table.tsx      # Agent list table
│   │   │   ├── 📄 sessions-table.tsx    # Session list table
│   │   │   └── 📄 events-feed.tsx       # Real-time events
│   │   │
│   │   ├── 📁 agent/
│   │   │   ├── 📄 agent-detail.tsx      # Main agent detail component
│   │   │   ├── 📄 agent-detail-actions.tsx
│   │   │   ├── 📄 agent-identity.tsx
│   │   │   ├── 📄 credentials-list.tsx
│   │   │   ├── 📄 sessions-list.tsx
│   │   │   └── 📄 wallets-list.tsx
│   │   │
│   │   ├── 📁 events/
│   │   │   └── 📄 events-page-client.tsx
│   │   │
│   │   ├── 📁 integration/
│   │   │   └── 📄 integration-steps.tsx
│   │   │
│   │   ├── 📁 auth/
│   │   │   └── 📄 auth-form.tsx
│   │   │
│   │   ├── 📁 common/
│   │   │   ├── 📄 stat-card.tsx
│   │   │   ├── 📄 status-badge.tsx
│   │   │   ├── 📄 code-block.tsx
│   │   │   ├── 📄 signal-strip.tsx
│   │   │   └── 📄 stack-metrics.tsx
│   │   │
│   │   ├── 📁 effects/
│   │   │   ├── 📄 hero-3d.tsx           # Three.js 3D hero component
│   │   │   ├── 📄 hero-3d-wrapper.tsx
│   │   │   └── 📄 card-3d.tsx
│   │   │
│   │   ├── 📁 ui/                       # shadcn/ui components (50+ files)
│   │   │   ├── 📄 button.tsx
│   │   │   ├── 📄 card.tsx
│   │   │   ├── 📄 dialog.tsx
│   │   │   ├── 📄 form.tsx
│   │   │   ├── 📄 input.tsx
│   │   │   ├── 📄 select.tsx
│   │   │   ├── 📄 table.tsx
│   │   │   └── ... (see frontend/components/ui/ for full list)
│   │   │
│   │   ├── 📄 header.tsx
│   │   ├── 📄 footer.tsx
│   │   ├── 📄 theme-provider.tsx
│   │   └── 📄 *.tsx                     # Other shared components
│   │
│   ├── 📁 lib/                          # Utilities & API Clients
│   │   ├── 📄 api-base.ts               # Base fetch wrapper for backend
│   │   ├── 📄 backend-proxy.ts          # Proxies requests to backend
│   │   ├── 📄 wallet-action.ts          # useWalletAction hook for signed actions
│   │   ├── 📄 signed-actions.ts         # Signature generation utilities
│   │   ├── 📄 org-session.ts            # Org context management
│   │   ├── 📄 auth.ts                   # Auth utilities
│   │   ├── 📄 types.ts                  # Shared TypeScript types
│   │   ├── 📄 utils.ts                  # General utilities (cn, etc.)
│   │   ├── 📄 animations.ts             # Framer Motion animations
│   │   ├── 📄 explorer.ts               # Etherscan link generation
│   │   ├── 📄 ai-api.ts                 # AI agent API client
│   │   ├── 📄 external-agents-api.ts    # External agents API client
│   │   ├── 📄 mock-api.ts               # Mock fallback data (dev only)
│   │   └── 📄 mock-data.ts              # Mock data definitions
│   │
│   ├── 📁 hooks/
│   │   ├── 📄 use-toast.ts
│   │   └── 📄 use-mobile.ts
│   │
│   └── 📄 .env.example                  # NEXT_PUBLIC_API_URL, etc.
│
├── 📁 contracts/                        # Solidity Smart Contracts
│   ├── 📄 package.json                  # Dependencies: hardhat, ethers, @openzeppelin
│   ├── 📄 hardhat.config.ts             # Network config (Sepolia), compiler settings
│   ├── 📄 tsconfig.json
│   │
│   ├── 📁 src/                          # Contract Source Files
│   │   ├── 📄 CredentialRegistry.sol    # Stores activeRoot, revokedRoot, issuer management
│   │   ├── 📄 SessionManager.sol        # Verifies Groth16 proofs, creates sessions
│   │   ├── 📄 AgentWalletFactory.sol    # Deploys deterministic ERC-4337 wallets
│   │   ├── 📄 AgentWallet.sol           # Smart account with owner/session execution
│   │   └── 📄 Verifier.sol              # Groth16 verifier (auto-generated)
│   │
│   ├── 📁 contracts/mocks/
│   │   └── 📄 MockVerifier.sol          # Test verifier
│   │
│   ├── 📁 scripts/
│   │   ├── 📄 deploy.ts                 # Contract deployment script
│   │   └── 📄 verify.ts                 # Etherscan verification
│   │
│   ├── 📁 test/
│   │   ├── 📄 AgentWallet.test.ts
│   │   └── 📄 SessionManager.test.ts
│   │
│   ├── 📁 artifacts/                    # Compiled contracts (gitignored but present)
│   ├── 📁 typechain-types/              # TypeScript bindings (auto-generated)
│   │
│   └── 📄 .env.example                  # RPC_URL, PRIVATE_KEY, etc.
│
├── 📁 circuits/                         # ZK Circuit Definitions
│   ├── 📄 package.json                  # Dependencies: circomlibjs, snarkjs
│   ├── 📄 credential.circom             # Main credential circuit
│   │
│   └── 📁 build/                        # Compiled artifacts (generated)
│       ├── credential.r1cs
│       ├── credential.wasm
│       ├── circuit.zkey
│       └── verification_key.json
│
├── 📁 sdk/                              # Self-Hosted SDK
│   ├── 📄 package.json
│   ├── 📄 README.md
│   ├── 📄 tsconfig.json
│   │
│   ├── 📁 src/
│   │   ├── 📄 index.ts                  # SDK exports
│   │   ├── 📄 AgentClient.ts            # Credential registration client
│   │   ├── 📄 SessionManager.ts         # ZK proof generation, session creation
│   │   └── 📄 types.ts                  # TypeScript types
│   │
│   └── 📁 examples/
│       ├── 📄 create-session.ts         # Example: create a session
│       └── 📄 perform-action.ts         # Example: execute an action
│
├── 📁 docs/                             # Documentation
│   ├── 📄 API.md                        # API reference
│   ├── 📄 ARCHITECTURE.md               # Deep architecture docs
│   ├── 📄 SETUP.md                      # Setup guide
│   │
│   └── 📁 superpowers/
│       ├── 📁 plans/
│       │   └── 📄 2026-05-10-agentix-landing-redesign.md
│       └── 📁 specs/
│           ├── 📄 2026-05-10-agentix-landing-redesign.md
│           └── 📄 2026-05-12-wallet-auth-design.md
│
├── 📄 README.md                         # Main documentation
├── 📄 CLAUDE.md                         # This file - AI context
├── 📄 PERSONATEST.md                    # Developer persona analysis & flaws
├── 📄 DEPLOYMENT.md                     # Deployment guide
├── 📄 quickstart.md                     # Quick start guide
├── 📄 LICENSE.md                        # License file
│
├── 📄 package.json                      # Workspace root config
├── 📄 package-lock.json
└── 📄 .env.example                      # Root env template
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERACTION                               │
│  User connects MetaMask → Selects/Creates Org → Manages Agents          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js)                             │
│  - wallet-provider.tsx: EIP-6963 wallet connection                       │
│  - wallet-action.ts: Signs actions with wallet                           │
│  - api/platform/*: Proxies to backend with signature                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Express)                              │
│  - actionAuth.ts: Verifies wallet signature, checks nonce               │
│  - platform.ts: Orchestrates all business logic                          │
│  - db.ts: PostgreSQL connection and queries                              │
└─────────────────────────────────────────────────────────────────────────┘
                         │              │              │
                         ▼              ▼              ▼
              ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
              │  PostgreSQL  │ │   Blockchain │ │   ZK Proofs  │
              │   Database   │ │   Services   │ │   (Circom)   │
              └──────────────┘ └──────────────┘ └──────────────┘
```

---

## Key Workflows

### 1. Organization Creation Flow
```
Frontend: user clicks "Create Org"
    ↓
wallet-action.ts: signAction({ action: "CREATE_ORG", ... })
    ↓
api/platform/orgs: POST with signature
    ↓
Backend routes/orgs.ts: receives request
    ↓
actionAuth.ts: verifySignature(signature, expectedMessage)
    ↓
platform.ts: createOrganization(walletAddress, name)
    ↓
db.ts: INSERT INTO organizations (owner_wallet_address, name)
    ↓
Response: { orgId, name, owner_wallet_address }
```

### 2. Credential Issuance Flow
```
Frontend: user clicks "Issue Credential" for agent
    ↓
wallet-action.ts: signAction({ action: "ISSUE_CREDENTIAL", agentId, ... })
    ↓
api/platform/agents/[agentId]/credential: POST with signature
    ↓
Backend routes/credentials.ts: receives request
    ↓
actionAuth.ts: verifySignature(...)
    ↓
platform.ts: issueCredential(agentId)
    ↓
    ├── Generate secret (BigInt random)
    ├── Compute commitment = Poseidon(agentId, orgId, permissions, expiry, secret)
    ├── Insert into merkle tree → get leafIndex
    └── Store in credentials table
    ↓
merkle.ts: updateMerkleTree(orgId, commitment)
    ↓
db.ts: INSERT INTO credentials (commitment, secret_hash, leaf_index, ...)
    ↓
Response: { credentialId, commitment, leafIndex }
```

### 3. Session Creation Flow (ZK Proof)
```
Frontend: user clicks "Create Session"
    ↓
wallet-action.ts: signAction({ action: "CREATE_SESSION", agentId, ... })
    ↓
api/platform/agents/[agentId]/session: POST with signature
    ↓
Backend routes/sessions.ts: receives request
    ↓
actionAuth.ts: verifySignature(...)
    ↓
platform.ts: createSession(agentId, maxValue, expiry)
    ↓
    ├── merkle.ts: generateMerkleProof(leafIndex) → merklePath, activeRoot
    ├── revocationTree.ts: generateNonRevocationProof(secretHash) → smtProof
    └── prover.ts: generateProof(witnessInputs)
    ↓
proofQueue.ts: add to BullMQ queue for async processing
    ↓
prover.ts: groth16.fullProve(witness, wasm, zkey)
    ↓
blockchain.ts: sessionManager.createSession(proof, publicSignals, ...)
    ↓
Contract: SessionManager.sol verifies proof, creates session
    ↓
eventSync.ts: index SessionCreated event
    ↓
Response: { sessionId, txHash, sessionKey }
```

### 4. Wallet Execution Flow (ERC-4337)
```
Frontend: user wants agent to execute transaction
    ↓
api/platform/wallets/[address]/userop/prepare: POST
    ↓
Backend bundler.ts: prepareUserOp(walletAddress, calls, sessionKey)
    ↓
Response: { userOp, userOpHash }
    ↓
Frontend: wallet-action.ts: signUserOp(userOpHash)
    ↓
api/platform/wallets/[address]/userop/submit: POST with signature
    ↓
Backend bundler.ts: submitUserOp(signedUserOp)
    ↓
EntryPoint: execute via ERC-4337 bundler
    ↓
Response: { txHash }
```

---

## Database Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organizations` | Org registry | `id`, `name`, `owner_wallet_address`, `contracts_deployed` |
| `agents` | Agent identities | `id`, `org_id`, `agent_name`, `linked_agent_id` |
| `credentials` | ZK credential data | `id`, `agent_id`, `commitment`, `secret_hash`, `leaf_index` |
| `merkle_tree` | Active tree nodes | `id`, `org_id`, `level`, `node_index`, `hash` |
| `revoked_secrets` | Revocation SMT | `id`, `org_id`, `smt_key`, `revoked_value` |
| `wallets` | Agent wallets | `id`, `agent_id`, `wallet_address`, `session_manager_address` |
| `sessions` | On-chain sessions | `id`, `agent_id`, `session_id`, `public_signals`, `max_value` |
| `events` | Contract events | `id`, `org_id`, `contract_name`, `event_name`, `tx_hash` |
| `action_authorizations` | Nonce tracking | `id`, `nonce`, `wallet_address`, `requested_at` |
| `external_agents` | Provider integrations | `id`, `org_id`, `agent_type`, `linked_agent_id` |
| `ai_agents` | AI agent configs | `id`, `org_id`, `provider`, `model`, `config` |

---

## Smart Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| Verifier | `0x9536B6350c39475AE6191f2c1A8CDFdbd8586B46` |
| CredentialRegistry | `0x77caeF0dD1F00cf36D2870E7Fb43112adB8fB0dc` |
| SessionManager | `0x30442c4F4E7098c4698276BBc8D3F79C7Fc41259` |
| AgentWalletFactory | `0xFaDAe432B8821C4B0690fd80f923F43fd85b4824` |
| AgentWallet Impl | `0x03F7Fc29cEFAC155419761Ac61705B84b71f29fe` |
| EntryPoint | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |

---

## Production Readiness Status

### ✅ COMPLETED

| Component | Status | Notes |
|-----------|--------|-------|
| PostgreSQL Migration | ✅ Done | Migrated from SQLite to PostgreSQL |
| Database Schema | ✅ Fixed | Fixed schema drift in ai_agents, merkle_tree, action_authorizations |
| Wallet Authentication | ✅ Done | All platform routes use wallet signature auth |
| Smart Contracts | ✅ Deployed | All contracts deployed to Sepolia |
| ZK Circuit | ✅ Working | credential.circom generates valid Groth16 proofs |
| BullMQ Proof Queue | ✅ Working | Async proof generation with Redis |
| Event Indexing | ✅ Working | Contract events synced to database |
| Frontend Operator UI | ✅ Working | Dashboard, agents, credentials, sessions |
| Landing Page | ✅ Done | 3D neural hero, Vercel B&W aesthetic |
| SDK Core | ✅ Working | AgentClient, SessionManager functional |

### ⚠️ IN PROGRESS / NEEDS WORK

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Error Handling | ⚠️ Basic | MEDIUM | Some routes return generic errors |
| API Documentation | ⚠️ Partial | MEDIUM | API.md exists but incomplete |
| Test Coverage | ⚠️ Low | HIGH | Only contract tests exist |
| Session Timeout | ⚠️ Partial | MEDIUM | Session expiry check may be missing |
| Revocation Flow | ⚠️ Partial | MEDIUM | Works but needs refresh |

### ❌ NOT STARTED / TODO

| Component | Priority | Notes |
|-----------|----------|-------|
| Test Suite | HIGH | No backend/frontend tests |
| Monitoring/Observability | MEDIUM | Basic logging only |
| CI/CD Pipeline | MEDIUM | No GitHub Actions |
| Mainnet Deployment | LOW | Sepolia only currently |

---

## Critical Issues - RESOLVED (2026-05-12)

All P0 and P1 issues from PERSONATEST.md have been fixed:

### ✅ P0 - Security Critical - FIXED
1. **Server-side secret generation** - ✅ FIXED: Created `frontend/lib/credential-client.ts` for client-side generation
2. **Secret hash stored transparently** - ✅ FIXED: Added `hashSecretForStorage()` with Poseidon salt

### ✅ P1 - High Priority - FIXED
3. **No database migrations** - ✅ FIXED: Created `backend/src/migrations.ts` with 11 versioned migrations
4. **Nonce race condition** - ✅ FIXED: Used INSERT ... ON CONFLICT for atomic operation
5. **Merkle tree rebuilds** - ✅ FIXED: Added tree state caching with `merkle_tree_state` table
6. **SDK browser incompatible** - ✅ FIXED: Added conditional imports, Web Crypto API, browser build

### ✅ P2 - Medium Priority - FIXED
7. **Hardcoded chain ID** - ⏸️ DEFERRED (user request to exclude FLAW 3)
8. **No graceful circuit fallback** - ✅ FIXED: Added `isProverAvailable()`, lazy loading in prover.ts
9. **Mock fallback in production code** - ✅ FIXED: Requires explicit `USE_MOCK=true`
10. **Rate limiting** - ✅ FIXED: Added express-rate-limit to proof endpoints
11. **Audit Logging** - ✅ FIXED: Created `backend/src/services/audit.ts` with `logAuditEvent()`
12. **Blockchain singleton** - ✅ FIXED: Added `getBlockchainService()` with health checks
13. **SDK proxy through frontend** - ✅ FIXED: SDK can now call backend directly with CORS

---

## Development Commands

```bash
# Root commands (run from project root)
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
cd contracts && npx hardhat test
cd contracts && npx hardhat deploy --network sepolia

# Circuit commands (if rebuilding)
cd circuits && circom credential.circom --r1cs --wasm --sym
```

---

## Environment Variables

### Backend (.env)
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require

# Blockchain
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0x...                           # For contract interactions

# ERC-4337
BUNDLER_URL=https://...

# Queue
REDIS_URL=redis://localhost:6379

# Optional
PORT=3001
NODE_ENV=production
```

### Frontend (.env.local)
```bash
# API
NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=http://127.0.0.1:3001
AGENT_CREDENTIALS_API_URL=http://127.0.0.1:3001

# Wallet
NEXT_PUBLIC_CHAIN_ID=11155111
```

### Contracts (.env)
```bash
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

---

## File Change Guidelines

### When modifying backend routes:
1. Update the route file in `backend/src/routes/`
2. Ensure wallet signature auth is used for protected routes
3. Update `actionAuth.ts` if changing signature format
4. Add error handling with `AppError` from `utils/errors.ts`

### When modifying frontend pages:
1. Page file goes in `frontend/app/[route]/page.tsx`
2. Components go in `frontend/components/`
3. Use `useWalletAction` hook for signed actions
4. Update `wallet-action.ts` if changing signature format

### When modifying contracts:
1. Contract goes in `contracts/src/`
2. Run `npx hardhat compile` to generate typechain
3. Update `blockchain.ts` if changing interfaces
4. Deploy with `npx hardhat run scripts/deploy.ts --network sepolia`

### When modifying circuits:
1. Circuit goes in `circuits/`
2. Rebuild with circom (`circom credential.circom --r1cs --wasm --sym`)
3. Run powers of tau and generate zkey
4. Update `prover.ts` if changing signals

---

## Known Gotchas

1. **Port 3000 vs 3001**: Frontend is 3000, Backend is 3001. Don't confuse them.

2. **Database must be migrated**: If backend crashes on startup, check database schema matches db.ts expectations.

3. **Circuit files required**: Backend needs `circuits/build/credential.wasm` and `.zkey` for proof generation.

4. **Sepolia ETH required**: Need Sepolia ETH for contract interactions.

5. **Redis required**: BullMQ proof queue needs Redis running.

6. **Wallet must be on Sepolia**: Signature verification checks chain ID 11155111.

7. **No session auth**: Legacy session auth is deprecated, use wallet signature auth.

---

## Session Log (Append Each Session)

### Session 2026-05-12 Part 2 — Design Flaw Fixes
- Fixed all 12 design flaws from PERSONATEST.md (excluding FLAW 3 & FLAW 14)
- **New Files Created:**
  - `backend/src/migrations.ts` — Versioned migration system (11 migrations)
  - `backend/src/services/audit.ts` — Audit trail logging service
  - `frontend/lib/credential-client.ts` — Client-side secret generation with Poseidon
  - `frontend/types/circomlibjs.d.ts` — TypeScript declarations for circomlibjs
  - `scripts/test-flaw-fixes.ts` — Comprehensive test verification script
- **Modified Files:**
  - `backend/src/db.ts` — Uses migration system
  - `backend/src/services/platform.ts` — Singleton blockchain, deprecated server-side secrets
  - `backend/src/services/blockchain.ts` — Added getBlockchainService(), health checks, reconnection
  - `backend/src/services/merkle.ts` — Tree state caching (loadState/saveState)
  - `backend/src/services/credential.ts` — hashSecretForStorage() with Poseidon salt
  - `backend/src/services/prover.ts` — Lazy circuit loading, isProverAvailable()
  - `backend/src/services/actionAuth.ts` — Fixed nonce TOCTOU with INSERT ON CONFLICT (removed duplicate INSERT bug)
  - `backend/src/routes/credentials.ts` — Audit logging, singleton blockchain
  - `backend/src/routes/proofs.ts` — Rate limiting (10/min async, 3/min sync), /status endpoints
  - `backend/src/middleware/security.ts` — Added port 3000 to CORS
  - `frontend/lib/mock-api.ts` — Requires explicit USE_MOCK=true
  - `sdk/src/AgentClient.ts` — Browser-compatible imports, DEFAULT_BACKEND_URL
- **Flaw Fixes Summary:**
  - FLAW 1: Client-side secret generation (Web Crypto API + Poseidon)
  - FLAW 2: Browser-compatible SDK (conditional imports, Web Crypto)
  - FLAW 4: Graceful circuit fallback (lazy loading, availability check)
  - FLAW 5: Database migration system (11 versioned migrations)
  - FLAW 6: Merkle tree caching (in-memory + DB persistence)
  - FLAW 7: Hash secret for storage (Poseidon with storage salt)
  - FLAW 8: Remove mock fallback (requires explicit USE_MOCK=true)
  - FLAW 9: Rate limiting proofs (express-rate-limit endpoints)
  - FLAW 10: Blockchain service singleton (health checks, reconnection)
  - FLAW 11: Nonce race condition (INSERT ... ON CONFLICT)
  - FLAW 12: SDK direct backend access (CORS port 3000)
  - FLAW 13: Audit trail (audit_log table + logAuditEvent())
- All packages build successfully: backend, sdk, frontend
- **Critical Bug Fix (FLAW 11):** Removed duplicate INSERT in actionAuth.ts - verification agent caught duplicate INSERT statement that would always fail
- **Verification Result:** 18/18 tests pass, all API endpoints operational
- Fixed AWS RDS database schema drift (ai_agents, merkle_tree, action_authorizations tables)
- Verified proof system is unaffected by schema fixes
- Created PERSONATEST.md with comprehensive design flaw analysis
- Rewrote README.md to match actual architecture
- Committed checkpoint to production branch

---

*Last updated: 2026-05-12*
