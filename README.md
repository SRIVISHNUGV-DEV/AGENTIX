# AGENTIX — The Private Agent Authorization Rail

**Built to give autonomous agents constrained, revocable, on-chain access without exposing raw credentials**

![AGENTIX](https://img.shields.io/badge/AGENTIX-Agent%20Authorization-black)
![Sepolia](https://img.shields.io/badge/Network-Sepolia-purple)
![ERC-4337](https://img.shields.io/badge/ERC--4337-Ready-lightgrey)
![Groth16](https://img.shields.io/badge/ZK-Groth16-white)
![License](https://img.shields.io/badge/License-BUSL--1.1-orange)

---

## Live Deployment (Sepolia)

| Contract | Address |
|----------|---------|
| Verifier | [`0x9536...6B46`](https://sepolia.etherscan.io/address/0x9536B6350c39475AE6191f2c1A8CDFdbd8586B46) |
| CredentialRegistry | [`0x77ca...0dc`](https://sepolia.etherscan.io/address/0x77caeF0dD1F00cf36D2870E7Fb43112adB8fB0dc) |
| SessionManager | [`0x3044...1259`](https://sepolia.etherscan.io/address/0x30442c4F4E7098c4698276BBc8D3F79C7Fc41259) |
| AgentWalletFactory | [`0xFaDA...824`](https://sepolia.etherscan.io/address/0xFaDAe432B8821C4B0690fd80f923F43fd85b4824) |
| AgentWallet Implementation | [`0x03F7...9fe`](https://sepolia.etherscan.io/address/0x03F7Fc29cEFAC155419761Ac61705B84b71f29fe) |
| EntryPoint | [`0x4337...F108`](https://sepolia.etherscan.io/address/0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108) |

---

## Frontend Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with protocol overview |
| `/dashboard` | Organization workspace showing contract stack, agents, treasury |
| `/agents` | Agent inventory for the active organization |
| `/agents/[id]` | Per-agent detail: credential, wallet, session, funding, user-ops |
| `/ai-agents` | Provider-first AI agent connect flow |
| `/external-agents` | External agent integrations, security audits, whitelists, credentials |
| `/events` | Indexed on-chain activity feed |
| `/credentials` | Credential issuance and management |
| `/sessions` | Session overview and lifecycle |
| `/audit` | Audit trail and compliance logs |
| `/docs` | Protocol documentation |
| `/sdk` | Self-hosted SDK path and integration guide |
| `/login` | Wallet-based authentication |

---

## Quick Start (30 seconds)

```bash
# install all workspace dependencies
npm install

# copy environment files
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env.local

# start both services
npm run dev
```

Then open:

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:3001`

> Full setup guide with database, Redis, and contract deployment: see [docs/SETUP.md](./docs/SETUP.md).

---

## The Vision

Agentix is a **private authorization rail** for the agent economy.

It gives organizations a way to:

- create agent identities under an organization workspace
- issue private credentials without publishing plaintext allowlists
- deploy organization-scoped contract stacks (deterministic wallets per agent)
- fund agent wallets without handing unrestricted treasury access to model providers
- create bounded sessions with expiry, spend limits, and transaction caps
- revoke future session access without revealing the agent secret
- operate ERC-4337-ready wallets through a managed operator UI or a self-hosted SDK

**Default operator flow:** _Connect. Credential. Wallet. Session. Execute._

1. The org owner connects a wallet
2. The org creates an agent
3. The org issues a credential commitment (updated in the Merkle tree)
4. The org deploys a wallet and funds it
5. The backend or SDK proves credential validity in zero knowledge
6. The session manager opens a bounded session (ZK-proof or lightweight)
7. The wallet executes only within that session boundary

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                               AGENTIX PROTOCOL                                   │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────┐      │
│   │  Layer 5 — Interface & Consumption                                    │      │
│   │  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │      │
│   │  │  Next.js Operator│  │  Self-Hosted SDK  │  │  External Agent     │  │      │
│   │  │  Platform (UI)   │  │  (TypeScript)     │  │  Runtime Connectors │  │      │
│   │  └─────────────────┘  └──────────────────┘  └─────────────────────┘  │      │
│   └──────────────────────────────────────────────────────────────────────┘      │
│                                      │                                          │
│   ┌──────────────────────────────────────────────────────────────────────┐      │
│   │  Layer 4 — Backend Control Plane                                     │      │
│   │  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │      │
│   │  │  Express/Hono API│  │  Platform Service │  │  Event Indexer      │  │      │
│   │  │  (REST Routes)   │  │  (Orchestration)  │  │  (Chain Polling)    │  │      │
│   │  └─────────────────┘  └──────────────────┘  └─────────────────────┘  │      │
│   └──────────────────────────────────────────────────────────────────────┘      │
│                                      │                                          │
│   ┌──────────────────────────────────────────────────────────────────────┐      │
│   │  Layer 3 — Proof & State Services                                    │      │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐  │      │
│   │  │  Merkle Tree  │  │  Revocation   │  │  Groth16   │  │  4337     │  │      │
│   │  │  (Poseidon)   │  │  Tree (Sparse)│  │  Prover    │  │  Bundler   │  │      │
│   │  └──────────────┘  └──────────────┘  └────────────┘  └───────────┘  │      │
│   └──────────────────────────────────────────────────────────────────────┘      │
│                                      │                                          │
│   ┌──────────────────────────────────────────────────────────────────────┐      │
│   │  Layer 2 — Protocol Contracts (Sepolia)                              │      │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐  │      │
│   │  │CredentialReg │  │SessionManager│  │AgentWallet │  │AgentWallet │  │      │
│   │  │ (roots)      │  │ (ZK + Light) │  │Factory     │  │ (ERC-4337) │  │      │
│   │  └──────────────┘  └──────────────┘  └────────────┘  └────────────┘  │      │
│   └──────────────────────────────────────────────────────────────────────┘      │
│                                      │                                          │
│   ┌──────────────────────────────────────────────────────────────────────┐      │
│   │  Layer 1 — Trust Anchors                                             │      │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐     │      │
│   │  │  Groth16     │  │  ERC-4337    │  │  Organization Owner    │     │      │
│   │  │  Verifier    │  │  EntryPoint  │  │  Wallet (EOA)          │     │      │
│   │  └──────────────┘  └──────────────┘  └────────────────────────┘     │      │
│   └──────────────────────────────────────────────────────────────────────┘      │
│                                                                                  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Execution Flow

```
Org Owner Wallet                       Agentix Backend                    Ethereum (Sepolia)
      │                                      │                                   │
      │  1. Connect + Create Org              │                                   │
      │─────────────────────────────────────►│                                   │
      │  2. Sign action: Register Agent       │                                   │
      │─────────────────────────────────────►│                                   │
      │                                      │  3. Insert credential commitment   │
      │                                      │     into Poseidon Merkle tree      │
      │                                      │──────────────────────────────────►│
      │                                      │     setActiveRoot()                │
      │                                      │                                   │
      │  4. Sign action: Deploy Wallet        │                                   │
      │─────────────────────────────────────►│  5. createAccount()                │
      │                                      │──────────────────────────────────►│
      │                                      │     AgentWallet deployed           │
      │                                      │                                   │
      │  6. Sign action: Fund Wallet          │                                   │
      │─────────────────────────────────────►│  7. transfer()                     │
      │                                      │──────────────────────────────────►│
      │                                      │                                   │
      │  8. Sign action: Create Session       │                                   │
      │─────────────────────────────────────►│  9. Build proof bundle             │
      │                                      │  10. createSession(proof, signals) │
      │                                      │──────────────────────────────────►│
      │                                      │     SessionCreated event           │
      │                                      │                                   │
      │  11. Sign UserOp                      │                                   │
      │─────────────────────────────────────►│  12. handleOps() via Bundler       │
      │                                      │──────────────────────────────────►│
      │                                      │     EntryPoint.validateUserOp()    │
      │                                      │     AgentWallet.execute()          │
      │                                      │                                   │
```

### Session Types

| Type | Creation | Verification | Gas Cost | Use Case |
|------|----------|--------------|----------|----------|
| **ZK-Proof Session** | `createSession(proof, signals)` | Groth16 on-chain verification | ~300k gas | Privacy-preserving agents, third-party agents |
| **Lightweight Session** | `createLightweightSession(sig, params)` | EIP-191 signature verification | ~80k gas | Trusted agents, direct operator control |

---

## Smart Contracts

### CredentialRegistry.sol
Stores the active Merkle root and revoked sparse-Merkle root. Every credential issuance or revocation updates these roots. The registry is the single source of truth for agent authorization state.

### SessionManager.sol
Validates Groth16 proofs (ZK sessions) and EIP-191 signatures (lightweight sessions). Creates replay-safe, bounded sessions with `maxValue`, `maxTxCount`, and `expiresAt` constraints. Emits `SessionCreated` events indexed by the backend.

### AgentWalletFactory.sol
Deterministic deployment of ERC-4337 smart accounts using CREATE2. Each agent gets a predictable wallet address derived from the organization salt and agent ID.

### AgentWallet.sol
ERC-4337-compatible smart account. Validates UserOperations against either active sessions or the owner address. Supports `execute()` and `executeBatch()` for composing multiple actions in a single UserOp.

### Verifier.sol
Auto-generated Groth16 verifier from the Circom circuit. Used by SessionManager to verify zero-knowledge proofs during session creation.

---

## Backend

### API Routes

| Method | Route | Description |
|--------|-------|-------------|
| — | **Organizations** | |
| POST | `/v1/orgs` | Create organization |
| GET | `/v1/orgs` | List organizations |
| POST | `/v1/orgs/:id/deploy` | Deploy contract stack for org |
| POST | `/v1/orgs/:id/fund` | Fund org treasury |
| — | **Agents** | |
| POST | `/v1/agents` | Register agent |
| GET | `/v1/agents` | List agents |
| POST | `/v1/agents/:id/credential` | Issue credential commitment |
| POST | `/v1/agents/:id/wallet` | Deploy deterministic wallet |
| POST | `/v1/agents/:id/session` | Create session (ZK or lightweight) |
| POST | `/v1/agents/:id/fund` | Fund agent wallet |
| POST | `/v1/agents/:id/revoke` | Revoke agent credentials |
| — | **Wallets** | |
| POST | `/v1/wallets/:addr/userop/prepare` | Prepare UserOperation |
| POST | `/v1/wallets/:addr/userop/submit` | Submit UserOperation to bundler |
| GET | `/v1/wallets/userops/:hash` | Get UserOperation receipt |
| — | **Proofs** | |
| GET | `/v1/proofs/:agentId` | Get Merkle proof for agent credential |
| — | **Events** | |
| GET | `/v1/events` | Indexed on-chain events |
| — | **External Agents** | |
| GET | `/v1/external-agents` | List connected agent runtimes |
| POST | `/v1/external-agents` | Connect external agent runtime |
| POST | `/v1/external-agents/:id/poll` | Poll for pending actions |
| — | **AI** | |
| GET | `/v1/ai/agents` | AI agent capabilities and status |
| — | **Audit** | |
| GET | `/v1/audit/logs` | Audit trail |
| — | **Auth** | |
| POST | `/v1/auth/login` | Wallet-based login |
| POST | `/v1/auth/logout` | End session |
| GET | `/v1/auth/me` | Current user info |
| — | **System** | |
| GET | `/health` | Health check |

### Key Services

| Service | Responsibility |
|---------|----------------|
| `platform.ts` | Core orchestration — ties all actions together |
| `actionAuth.ts` | EIP-191 wallet signature verification for all critical operations |
| `merkle.ts` | Poseidon-based Merkle tree for credential commitments |
| `revocationTree.ts` | Sparse Merkle tree for revocation state |
| `prover.ts` | Groth16 proof bundle generation and witness construction |
| `blockchain.ts` | Contract interaction layer (reads, writes, event parsing) |
| `bundler.ts` | ERC-4337 UserOperation prepare/submit/receipt flow |
| `eventSync.ts` | Polls for on-chain events and persists to database |
| `sessionKey.ts` | Encrypted session key management for autonomous agent execution |
| `anomalyDetection.ts` | Detects anomalous agent behavior patterns |
| `capabilityPolicy.ts` | Manages agent capability policies independently of credentials |
| `audit.ts` | Structured audit trail logging |
| `agentTools.ts` | Blockchain tools available to agents |

### Middleware

| Middleware | Purpose |
|------------|---------|
| `auth.ts` | JWT + wallet session authentication |
| `security.ts` | CORS, rate limiting, Helmet headers |
| `rateLimiter.ts` | Per-endpoint rate limiting |
| `validate.ts` | Request body validation with Zod schemas |

---

## ZK Circuit

The circuit at `circuits/credential.circom` implements a credential membership + non-revocation proof:

- **Public inputs**: Merkle root, revocation root, session parameters
- **Private inputs**: Credential secret, Merkle path, revocation path
- **Outputs**: Proof that the prover knows a secret whose commitment is in the active tree AND not in the revoked tree

Compiled artifacts (`credential.wasm`, `credential_final.zkey`, `verification_key.json`) are in `circuits/build/`.

---

## SDK

The self-hosted TypeScript SDK (`sdk/`) enables agent orchestration outside the hosted UI:

| Module | Purpose |
|--------|---------|
| `AgentClient.ts` | Org, agent, credential, wallet operations |
| `SessionManager.ts` | Proof generation and session creation |
| `types.ts` | Shared type definitions |
| `examples/create-session.ts` | Full session creation example |
| `examples/perform-action.ts` | Execute on-chain action via session |

---

## Project Structure

```
agentix/
├── package.json                    # Workspace root (bun workspaces)
├── docker-compose.yml              # Development: PostgreSQL + Redis
├── docker-compose.prod.yml         # Production compose
├── .env.example                    # Root env template
│
├── backend/                        # Express/Hono API server
│   ├── src/
│   │   ├── index.ts                # Server entry, Hono app
│   │   ├── db.ts                   # PostgreSQL + Drizzle schema
│   │   ├── migrations.ts           # Versioned migrations
│   │   ├── routes/                 # API route handlers
│   │   ├── services/               # Business logic layer
│   │   ├── middleware/             # Auth, security, rate-limit
│   │   ├── types/                  # TypeScript types
│   │   ├── utils/                  # Validators, errors, env, logger
│   │   └── validation/             # Zod schemas
│   └── tests/                      # Backend tests
│
├── frontend/                       # Next.js 14 operator UI
│   ├── app/                        # App router pages
│   │   ├── page.tsx                # Landing
│   │   ├── dashboard/              # Org workspace
│   │   ├── agents/                 # Agent management
│   │   ├── credentials/            # Credential issuance
│   │   ├── sessions/               # Session overview
│   │   ├── events/                 # Event timeline
│   │   ├── audit/                  # Audit trail
│   │   ├── login/                  # Wallet auth
│   │   └── api/                    # API proxy routes
│   ├── components/                 # React components
│   │   ├── wallet/                 # Wallet connection
│   │   ├── platform/              # Platform action panels
│   │   ├── agents/                # Agent components
│   │   ├── execute/               # Execution panels
│   │   ├── audit/                 # Audit components
│   │   ├── effects/               # 3D effects (Three.js)
│   │   ├── landing/               # Landing page sections
│   │   ├── common/                # Shared components
│   │   └── ui/                    # shadcn/ui primitives
│   ├── hooks/                      # Custom React hooks
│   ├── lib/                        # API client, types, utils
│   └── public/                     # Static assets, provider logos
│
├── contracts/                      # Solidity smart contracts
│   ├── src/
│   │   ├── AgentWallet.sol         # ERC-4337 smart account
│   │   ├── AgentWalletFactory.sol  # CREATE2 deterministic deploy
│   │   ├── SessionManager.sol      # ZK + Lightweight sessions
│   │   ├── CredentialRegistry.sol  # Active + revoked roots
│   │   └── Verifier.sol            # Groth16 verifier
│   ├── test/                       # Hardhat contract tests
│   └── scripts/                    # Deploy & verify scripts
│
├── circuits/                       # Circom ZK circuits
│   ├── credential.circom           # Membership + non-revocation
│   ├── test/                       # Circuit tests
│   └── build/                      # .wasm, .zkey, verification_key
│
├── sdk/                            # Self-hosted TypeScript SDK
│   ├── src/                        # Client, session manager, types
│   └── examples/                   # Usage examples
│
├── runtime-local/                  # Local agent runtime server
│
├── docs/                           # Documentation
│   ├── API.md                      # Full API reference
│   ├── ARCHITECTURE.md             # Architecture deep-dive
│   ├── SETUP.md                    # Setup & deployment
│   └── ENTERPRISE_ARCHITECTURE_REVIEW.md
│
└── scripts/                        # Dev helper scripts
```

---

## Development

```bash
# Start everything (backend + frontend)
npm run dev

# Start individually
npm run dev:backend     # Port 3001
npm run dev:frontend    # Port 3000

# Compile contracts
cd contracts && npx hardhat compile

# Run contract tests
npm run test:contracts

# Run SDK example
npm run example:create-session
```

### Prerequisites

- **Node.js** 18+ (or Bun)
- **PostgreSQL** 14+ — via Docker: `docker run -e POSTGRES_USER=agentix -e POSTGRES_PASSWORD=agentix-secret -e POSTGRES_DB=agentix -p 5432:5432 postgres:16`
- **Redis** 7+ (optional, for async proof queue) — via Docker: `docker run -p 6379:6379 redis:7`
- **Hardhat** or **Foundry** for contract development

### Environment

| Variable | Where | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `backend/.env` | PostgreSQL connection string |
| `RPC_URL` | `backend/.env` | Ethereum RPC (Sepolia Alchemy) |
| `PRIVATE_KEY` | `backend/.env` | Backend signer wallet key |
| `BUNDLER_URL` | `backend/.env` | ERC-4337 bundler endpoint |
| `REDIS_URL` | `backend/.env` | Redis for BullMQ queues |
| `ENCRYPTION_KEY` | `backend/.env` | AES-256-GCM key (64 hex chars) |
| `AGENT_CREDENTIALS_API_URL` | `frontend/.env.local` | Backend API URL |

---

## Deployment Model

### Frontend
- Deploy `frontend/` to **Vercel**
- Set env: `AGENT_CREDENTIALS_API_URL`, `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL`

### Backend
- Deploy `backend/` as a long-running Node service
- **Railway** provides the simplest deployment path
- Requires:
  - Persistent PostgreSQL (Railway managed, AWS RDS, or Supabase)
  - Persistent Redis for proof queue (optional, disable with `ENABLE_PROOF_QUEUE=false`)
  - Alchemy RPC + Bundler URL
  - Backend wallet private key funded with Sepolia ETH

### Important
- The **frontend** is serverless-friendly (Vercel-native).
- The **backend** is **not** Vercel-native — it needs persistent state, event indexing, and chain orchestration.

---

## Security Model

| Principle | Implementation |
|-----------|----------------|
| **No raw secrets on-chain** | ZK proofs verify credential membership without revealing the secret |
| **Owner signature required** | Every critical action requires an EIP-191 wallet signature |
| **Session boundaries** | Per-session `maxValue`, `maxTxCount`, `expiresAt` enforced in contracts |
| **Credential revocation** | Sparse Merkle tree prevents future session creation |
| **Capability isolation** | Policy stored separately from credentials (defence in depth) |
| **Nonce protection** | Every signed action has a unique nonce — replay attacks prevented |
| **Encrypted session keys** | Agent session keys encrypted at rest with AES-256-GCM |
| **Audit trail** | Every operator action logged with wallet address and timestamp |

---

## Documentation

- **[docs/SETUP.md](./docs/SETUP.md)** — Full setup guide: dependencies, environment, contract deployment
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — Deeper architecture and design rationale
- **[docs/API.md](./docs/API.md)** — Complete REST API reference
- **[docs/ENTERPRISE_ARCHITECTURE_REVIEW.md](./docs/ENTERPRISE_ARCHITECTURE_REVIEW.md)** — Production-readiness assessment
- **[sdk/README.md](./sdk/README.md)** — SDK usage guide and examples

---

## License

AGENTIX is source-available under the **Business Source License 1.1 (BUSL-1.1)**.

You may:
- View the source
- Fork the repository
- Experiment locally
- Use the protocol for research and non-commercial purposes

You may not:
- Commercially deploy the protocol without permission
- Create competing hosted services

The license automatically converts to **Apache 2.0** on January 1, 2030.

---

*"The cleanest agent systems never confuse identity, permission, and money."*
