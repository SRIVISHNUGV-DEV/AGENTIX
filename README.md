# Agentix

**Autonomous Agent Credentials Protocol**

A platform for issuing private agent credentials, verifying authorization with ZK proofs, and enabling bounded autonomous execution through session-based wallets.

![AGENTIX](https://img.shields.io/badge/AGENTIX-Agent%20Authorization-black)
![Sepolia](https://img.shields.io/badge/Network-Sepolia-purple)
![ERC-4337](https://img.shields.io/badge/ERC--4337-Ready-lightgrey)
![Groth16](https://img.shields.io/badge/ZK-Groth16-white)
![License](https://img.shields.io/badge/BUSR-1.1-orange)

---

## Overview

Agentix enables AI agents to act autonomously on behalf of users within cryptographically enforced boundaries:

| Feature | Description |
|---------|-------------|
| **Credential Issuance** | Issue private, verifiable credentials to agents |
| **ZK Proof Verification** | Prove authorization without revealing identity |
| **Session Management** | Time-bounded, value-limited execution sessions |
| **Autonomous Execution** | Agents execute transactions within defined limits |

---

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| Verifier | [0x9536...6B46](https://sepolia.etherscan.io/address/0x9536B6350c39475AE6191f2c1A8CDFdbd8586B46) |
| CredentialRegistry | [0x77ca...0dc](https://sepolia.etherscan.io/address/0x77caeF0dD1F00cf36D2870E7Fb43112adB8fB0dc) |
| SessionManager | [0x3044...1259](https://sepolia.etherscan.io/address/0x30442c4F4E7098c4698276BBc8D3F79C7Fc41259) |
| AgentWalletFactory | [0xFaDA...824](https://sepolia.etherscan.io/address/0xFaDAe432B8821C4B0690fd80f923F43fd85b4824) |
| AgentWallet | [0x03F7...9fe](https://sepolia.etherscan.io/address/0x03F7Fc29cEFAC155419761Ac61705B84b71f29fe) |
| EntryPoint | [0x4337...F108](https://sepolia.etherscan.io/address/0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AGENTIX                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐         ┌──────────────┐         ┌───────────────┐   │
│   │   Frontend   │◄───────►│   Backend    │◄───────►│   Contracts   │   │
│   │   (Next.js)  │         │   (Express)  │         │   (Solidity)  │   │
│   └──────────────┘         └──────────────┘         └───────────────┘   │
│          │                        │                        │             │
│          │                        ▼                        │             │
│          │                 ┌───────────┐                   │             │
│          │                 │PostgreSQL │                   │             │
│          │                 │ Database  │                   │             │
│          │                 └───────────┘                   │             │
│          │                                                │             │
│          ▼                        ▼                        ▼             │
│   ┌──────────────┐         ┌──────────────┐         ┌───────────────┐   │
│   │     SDK      │         │   Runtime    │         │   Circuits    │   │
│   │ (TypeScript) │         │   (Local)    │         │   (Circom)    │   │
│   └──────────────┘         └──────────────┘         └───────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Operator ──► Frontend ──► Backend ──► PostgreSQL
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Contract Stack     │
                    │  ┌───────────────┐  │
                    │  │ EntryPoint    │  │
                    │  │     ▼         │  │
                    │  │ AgentWallet   │  │
                    │  │     ▼         │  │
                    │  │SessionManager │  │
                    │  │     ▼         │  │
                    │  │CredentialReg │  │
                    │  └───────────────┘  │
                    └─────────────────────┘
```

---

## Project Structure

```
agentix/
│
├── frontend/                     # Next.js operator dashboard
│   ├── app/                       # App router pages
│   │   ├── agents/               # Agent management
│   │   │   ├── page.tsx          # Agent list
│   │   │   └── [id]/page.tsx     # Agent details
│   │   ├── credentials/           # Credential workflows
│   │   ├── dashboard/            # Main dashboard
│   │   ├── docs/                # Documentation pages
│   │   ├── sessions/             # Session management
│   │   └── events/              # Event timeline
│   ├── components/               # React components
│   │   ├── wallet/              # Wallet connection
│   │   ├── agents/              # Agent cards
│   │   └── execute/             # Execution panels
│   ├── hooks/                    # Custom hooks
│   └── lib/                      # Utilities
│
├── backend/                      # Express API server
│   ├── src/
│   │   ├── routes/              # API endpoints
│   │   │   ├── orgs.ts          # Organization CRUD
│   │   │   ├── agents.ts        # Agent management
│   │   │   ├── credentials.ts   # Credential issuance
│   │   │   ├── sessions.ts      # Session creation
│   │   │   ├── wallets.ts       # Wallet operations
│   │   │   ├── externalAgents.ts # Runtime connections
│   │   │   └── v1.ts            # API v1 routes
│   │   ├── services/            # Business logic
│   │   │   ├── platform.ts      # Core orchestration
│   │   │   ├── actionAuth.ts    # Signature verification
│   │   │   ├── merkle.ts        # Merkle tree
│   │   │   ├── prover.ts        # ZK proof generation
│   │   │   ├── blockchain.ts   # Contract interactions
│   │   │   └── eventSync.ts    # Event indexing
│   │   ├── middleware/          # Auth and security
│   │   └── utils/               # Utilities
│   └── migrations.ts            # Database migrations
│
├── contracts/                   # Solidity smart contracts
│   ├── src/
│   │   ├── AgentWallet.sol        # ERC-4337 smart account
│   │   ├── AgentWalletFactory.sol # Deterministic deployment
│   │   ├── SessionManager.sol     # Session lifecycle
│   │   ├── CredentialRegistry.sol # Credential roots
│   │   └── Verifier.sol           # Groth16 verifier
│   ├── test/                    # Contract tests
│   └── scripts/                 # Deployment scripts
│
├── circuits/                    # Circom ZK circuits
│   ├── circom/                  # Circuit definitions
│   └── build/                   # Compiled artifacts
│
├── sdk/                         # TypeScript SDK
│   ├── src/
│   │   ├── AgentClient.ts       # Main client
│   │   ├── SessionManager.ts    # Session handling
│   │   └── types.ts             # Type definitions
│   └── examples/                # Usage examples
│
├── runtime-local/               # Local agent runtime
│   └── server.ts                # Runtime server
│
├── docs/                        # Documentation
│   ├── API.md                   # API reference
│   ├── ARCHITECTURE.md          # Architecture details
│   └── SETUP.md                 # Setup guide
│
├── scripts/                     # Utility scripts
├── nginx/                       # Nginx config
├── docker-compose.yml           # Development compose
└── docker-compose.prod.yml      # Production compose
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14, React, Tailwind CSS, Three.js |
| Backend | Express, TypeScript, PostgreSQL |
| Contracts | Solidity, Hardhat, OpenZeppelin |
| ZK Circuits | Circom, snarkjs |
| Account Abstraction | ERC-4337, EntryPoint |
| SDK | TypeScript, ethers.js |

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Foundry or Hardhat

### Installation

```bash
# Install dependencies
npm install

# Install workspace dependencies
npm run install:all
```

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:

```env
# Backend
DATABASE_URL=postgresql://user:password@localhost:5432/agentix
PRIVATE_KEY=your_wallet_private_key
JWT_SECRET=your_jwt_secret
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_CHAIN_ID=11155111
```

### Development

```bash
# Start all services
npm run dev

# Or individually:
npm run dev:backend   # Backend API on :3001
npm run dev:frontend  # Frontend on :3000
```

### Contract Compilation & Testing

```bash
cd contracts
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network sepolia
```

---

## Core Workflows

### 1. Organization Setup

```
Operator ──► Connect Wallet ──► Create Org ──► Deploy Contracts
```

### 2. Agent Registration

```
Org Owner ──► Create Agent ──► Issue Credential ──► Update Merkle Root
```

### 3. Wallet Deployment

```
Org Owner ──► Deploy AgentWallet ──► Fund Wallet ──► Ready for Execution
```

### 4. Session Creation

```
Agent Runtime ──► Generate Session Key ──► ZK Proof ──► Create Session
```

### 5. Transaction Execution

```
Agent ──► Sign UserOp ──► Submit to EntryPoint ──► Execute on AgentWallet
```

---

## API Endpoints

### Platform Routes (Require Wallet Signature)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/orgs` | Create organization |
| GET | `/orgs` | List organizations |
| POST | `/agents` | Create agent |
| POST | `/agents/:id/credential` | Issue credential |
| POST | `/agents/:id/wallet` | Deploy wallet |
| POST | `/agents/:id/session` | Create session |
| POST | `/agents/:id/fund` | Fund wallet |

### External Agent Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/external-agents` | List connected runtimes |
| POST | `/external-agents` | Connect runtime |
| GET | `/external-agents/:id/poll` | Poll for actions |

### Public Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
<<<<<<< HEAD
| GET | `/proofs/:agentId` | Get merkle proof for agent |

## Deployment Model

### Frontend

- Deploy `frontend/` to Vercel
- Environment variables:
  - `AGENT_CREDENTIALS_API_URL` (internal API URL)
  - `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL` (public API URL)

### Backend

- Deploy `backend/` as a long-running Node service
- Recommended platforms: Railway, AWS ECS, DigitalOcean
- Required environment:
  - `DATABASE_URL` (PostgreSQL connection string)
  - `RPC_URL` or `RPC_URLS` (Ethereum RPC)
  - `PRIVATE_KEY` (for transaction signing)
  - `BUNDLER_URL` (ERC-4337 bundler)
  - `REDIS_URL` (for BullMQ proof queue)

### Database

- PostgreSQL 14+ required
- Supports AWS RDS, Neon, Supabase, or self-hosted
- Connection pooling enabled by default
- SSL required for production

### Important Notes

- The frontend is serverless-friendly (Vercel)
- The backend requires persistent hosting due to:
  - PostgreSQL database state
  - Event indexing processes
  - Proof queue workers
  - Chain orchestration

## Security and Trust Assumptions

- Raw agent secrets do not appear on-chain
- Every critical operator action requires a wallet signature
- Organization state is isolated by per-org contract deployment
- Nonce-based replay protection for all signed actions
- Revocation prevents future session creation (does not delete history)
- Wallet funding does not imply unrestricted model access
- Session boundaries define spend permissions, not provider identity alone

## Additional Documentation

- [quickstart.md](./quickstart.md) - Start, redeploy, and environment flow
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Deeper architecture notes
- [docs/SETUP.md](./docs/SETUP.md) - Setup and deployment details
- [docs/API.md](./docs/API.md) - Backend route reference
- [sdk/README.md](./sdk/README.md) - SDK usage
- [PERSONATEST.md](./PERSONATEST.md) - Developer persona analysis and design critique

## License

BUSR 1.1
=======
| GET | `/proofs/:agentId` | Get merkle proof |
>>>>>>> eeb3d9b (docs: rewrite README and CLAUDE.md with new repository structure)

---

## Frontend Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with 3D hero |
| `/dashboard` | Organization workspace |
| `/agents` | Agent inventory |
| `/agents/[id]` | Agent details |
| `/credentials` | Credential management |
| `/sessions` | Session overview |
| `/events` | Contract event timeline |
| `/docs` | Documentation |

---

## Security Model

| Principle | Implementation |
|-----------|----------------|
| No raw secrets on-chain | ZK proofs verify authorization |
| Owner signature required | EIP-191 for all critical actions |
| Session boundaries | Daily spend/tx limits, expiry |
| Credential revocation | Blocks new session creation |
| Nonce protection | Replay attack prevention |

---

## Documentation

- **[API Reference](docs/API.md)** - REST API endpoints
- **[Architecture](docs/ARCHITECTURE.md)** - System design details
- **[Setup Guide](docs/SETUP.md)** - Installation instructions

---

## License

MIT
