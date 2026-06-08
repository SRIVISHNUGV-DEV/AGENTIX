# AGENTIX — Trust Infrastructure for Autonomous AI Agents

**The OAuth + Okta + Auth0 for AI agents. Issue private credentials, verify with ZK, delegate capabilities, create on-chain sessions, and execute through ERC-4337 smart wallets.**

![AGENTIX](https://img.shields.io/badge/AGENTIX-Agent%20Authorization-black)
![Base Sepolia](https://img.shields.io/badge/Network-Base_Sepolia-purple)
![ERC-4337](https://img.shields.io/badge/ERC--4337-Ready-lightgrey)
![Groth16](https://img.shields.io/badge/ZK-Groth16-white)
![MCP](https://img.shields.io/badge/MCP-v1.29-blue)
![License](https://img.shields.io/badge/License-BUSL--1.1-orange)

---

## Run in 10 Seconds

```bash
# Clone and start the MCP server (PostgreSQL + Redis required)
npx @agentix/mcp
```

Or from source:

```bash
git clone https://github.com/your-org/agentix
cd agentix
npm install
npm run dev
```

The MCP server starts on **port 3001**. Connect any MCP-compatible client (Claude Desktop, Cursor, VS Code, custom) and get 30 agent management tools.

---

## Live Deployment (Base Sepolia)

| Contract | Address | Role |
|----------|---------|------|
| **Verifier** | [`0xa9ED...AC48`](https://sepolia.basescan.org/address/0xa9ED81d44847729a7C8D33907BaDFb767ac9AC48) | Groth16 proof verification |
| **CredentialRegistry** | [`0xb184...4F95`](https://sepolia.basescan.org/address/0xb1841A44b57904849898EaA956b1C01a182e4F95) | Credential Merkle roots |
| **SessionManager** | [`0x58E1...Ee7a`](https://sepolia.basescan.org/address/0x58E1D578ecd41e0D2639BA1C3C8E4795A8F6Ee7a) | ZK + lightweight sessions |
| **AgentWalletFactory** | [`0x7689...138b`](https://sepolia.basescan.org/address/0x7689B8C445fAd670b03A0f68A912f5e93131138b) | Deterministic wallet deploy |
| **AgentWallet Impl** | [`0xa282...f5c0`](https://sepolia.basescan.org/address/0xa282F01c520bD73eF7100eA0436539988a36f5c0) | ERC-4337 smart account |
| **EntryPoint** | [`0x4337...F108`](https://sepolia.basescan.org/address/0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108) | ERC-4337 singleton |
| **CapabilityRegistry** | [`0x7Ebb...5Bb9`](https://sepolia.basescan.org/address/0x7Ebb4E2574613D73a1DC112E129f2c3b20b75Bb9) | Capability definitions & grants |
| **DelegationManager** | [`0xc752...95d7`](https://sepolia.basescan.org/address/0xc7522D29E63f2a2cdEdeC405093920D2FC3B95d7) | Trust delegation chains |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              AGENTIX TRUST INFRASTRUCTURE                            │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌────────────────────────────────────────────────────────────────────────────┐     │
│   │  Layer 5 — Consumption                                                     │     │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │     │
│   │  │  MCP     │  │  REST    │  │  SDK     │  │  Operator│  │  3rd-Party   │  │     │
│   │  │  Client  │  │  Client  │  │  Client  │  │  UI      │  │  Verifier    │  │     │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │     │
│   └────────────────────────────────────────────────────────────────────────────┘     │
│                                        │                                             │
│   ┌────────────────────────────────────────────────────────────────────────────┐     │
│   │  Layer 4 — Backend Control Plane (Express/Hono + PostgreSQL)               │     │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐  │     │
│   │  │  MCP Server  │  │  REST API    │  │  Platform  │  │  Event Indexer   │  │     │
│   │  │  (30 tools)  │  │  40+ routes  │  │  Service   │  │  (Chain Polling) │  │     │
│   │  └──────────────┘  └──────────────┘  └────────────┘  └──────────────────┘  │     │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐  │     │
│   │  │  Capability  │  │  Delegation  │  │  Chain     │  │  Audit Service   │  │     │
│   │  │  Registry    │  │  Service     │  │  Adapter   │  │  (Governance)    │  │     │
│   │  └──────────────┘  └──────────────┘  └────────────┘  └──────────────────┘  │     │
│   └────────────────────────────────────────────────────────────────────────────┘     │
│                                        │                                             │
│   ┌────────────────────────────────────────────────────────────────────────────┐     │
│   │  Layer 3 — Proof & State Services                                          │     │
│   │  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐   │     │
│   │  │  Merkle    │  │  Revocation│  │  Groth16 │  │  4337    │  │  Agent  │   │     │
│   │  │  Tree      │  │  SMT       │  │  Prover  │  │  Bundler │  │  Tools  │   │     │
│   │  └────────────┘  └────────────┘  └──────────┘  └──────────┘  └─────────┘   │     │
│   └────────────────────────────────────────────────────────────────────────────┘     │
│                                        │                                             │
│   ┌────────────────────────────────────────────────────────────────────────────┐     │
│   │  Layer 2 — Protocol Contracts (Base Sepolia)                               │     │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐│     │
│   │  │CredentialReg │  │SessionManager│  │CapabilityReg │  │ DelegationMgr    ││     │
│   │  │ (roots)      │  │ (ZK + Light) │  │ (catalog)    │  │ (chains)         ││     │
│   │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘│     │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐              │     │
│   │  │AgentWallet   │  │AgentWallet   │  │ Groth16 Verifier     │              │     │
│   │  │Factory       │  │ (ERC-4337)   │  │ (ZK verification)    │              │     │
│   │  └──────────────┘  └──────────────┘  └──────────────────────┘              │     │
│   └────────────────────────────────────────────────────────────────────────────┘     │
│                                        │                                             │
│   ┌────────────────────────────────────────────────────────────────────────────┐     │
│   │  Layer 1 — Trust Anchors                                                   │     │
│   │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────────┐     │     │
│   │  │  Ethereum    │  │  ERC-4337    │  │  Organization Owner Wallet    │     │     │
│   │  │  (Sepolia)   │  │  EntryPoint  │  │  (EOA signature authority)    │     │     │
│   │  └──────────────┘  └──────────────┘  └───────────────────────────────┘     │     │
│   └────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## MCP Server — 30 Tools

The MCP server is the primary interface for AI agents. It speaks the [Model Context Protocol](https://modelcontextprotocol.io) and works with any MCP-compatible client.

### Agent Lifecycle (6 tools)

| Tool | Description |
|------|-------------|
| `register_agent` | Register a new external AI agent (OpenClaude, LangChain, Claude Code, CrewAI, LlamaIndex, AutoGen, SmolAgents, custom) |
| `update_agent` | Update agent name, endpoint, API keys, active status |
| `revoke_agent` | Revoke agent credentials and deactivate |
| `list_agents` | List agents with status filter and pagination |
| `get_agent_state` | Full agent state: status, credentials, sessions, whitelist, stats |
| `get_permissions` | Get permission bitmask and capabilities |

### Execution & Proofs (5 tools)

| Tool | Description |
|------|-------------|
| `execute_action` | Execute action on agent runtime (read/write file, command, query, API call, sign tx, deploy contract) |
| `generate_proof` | Generate ZK authorization proof for an action |
| `verify_proof` | Verify a ZK proof against on-chain state |
| `create_session` | Generate session authorization proof for on-chain session creation |
| `get_execution_stats` | Execution statistics: total, success, failure counts |

### Credential Vault (4 tools)

| Tool | Description |
|------|-------------|
| `add_credential` | Store encrypted credential (API keys, secrets) |
| `list_credentials` | List vault credentials (values masked) |
| `delete_credential` | Delete a vault credential |
| `list_executions` | Execution logs with action filter and pagination |

### Contract Whitelist (2 tools)

| Tool | Description |
|------|-------------|
| `add_whitelist` | Add contract address to agent whitelist |
| `list_whitelist` | List whitelisted contracts |

### Agent Operations (2 tools)

| Tool | Description |
|------|-------------|
| `heartbeat` | Send heartbeat to update agent status and last seen |
| `get_agent_state` | Full agent state (duplicated for convenience) |

### Capability Registry (6 tools)

| Tool | Description |
|------|-------------|
| `create_capability` | Define a capability (15 action types, constraints: maxValue, allowedTargets, chains, quotas) |
| `list_capabilities` | List all capability definitions for org |
| `grant_capability` | Grant a capability to an agent with optional constraint overrides |
| `revoke_grant` | Revoke a capability grant |
| `check_capability` | Check if agent has a capability (evaluates all constraints) |
| `list_agent_grants` | List all grants for an agent |

### Delegation (4 tools)

| Tool | Description |
|------|-------------|
| `create_delegation` | Create trust delegation (supports chaining with depth tracking) |
| `revoke_delegation` | Revoke delegation (cascades to child delegations) |
| `check_delegation` | Check if delegate has permission via delegation |
| `get_delegation_chain` | Trace full delegation chain back to originator |

### Chain Discovery (2 tools)

| Tool | Description |
|------|-------------|
| `get_chains` | List all available chains with health status and contract addresses |
| `get_chain_contracts` | Get deployed contract addresses for a specific chain |

---

## Smart Contracts

### CredentialRegistry.sol
Stores the active Merkle root and revoked sparse-Merkle root. Every credential issuance or revocation updates these roots. The single source of truth for agent authorization state. Credentials contain identity + expiry only — no embedded capabilities.

### SessionManager.sol
Validates Groth16 proofs (ZK sessions) and EIP-191 signatures (lightweight sessions). Creates replay-safe, bounded sessions with `maxValue`, daily spend/tx limits, and `expiresAt` constraints. Two session types:
- **ZK-Proof Session** (~300k gas) — Privacy-preserving, requires Groth16 proof
- **Lightweight Session** (~80k gas) — EIP-191 signature, daily spend/tx limits

### CapabilityRegistry.sol (NEW)
A separate on-chain catalog for agent capabilities. Capabilities are defined with an action, effect (allow/deny/audit), and constraint set. Grants link capabilities to agent addresses. This separation ensures **credential stability**: changing capabilities never invalidates credentials. Key functions:
- `registerCapability()` / `revokeCapability()`
- `grantCapability()` / `revokeGrant()`
- `verifyCapability(agent, capabilityId, grantId)` — for third-party verifiers

### DelegationManager.sol (NEW)
Enables trust delegation chains between agents. A delegator grants a delegate a scope of authority, who can further delegate (up to a configurable depth). Revocation cascades to all children. Key functions:
- `createDelegation()` with scope hash, expiry, max depth, and parent chain
- `revokeDelegation()` with cascade revoke
- `verifyDelegationChain(delegationId, delegate, scopeHash, expectedOriginator)` — full chain walk

### AgentWalletFactory.sol
Deterministic deployment of ERC-4337 smart accounts using CREATE2. Each agent gets a predictable wallet address derived from organization salt and agent ID.

### AgentWallet.sol
ERC-4337-compatible smart account. Validates UserOperations against active sessions or owner address. Supports `execute()` and `executeBatch()`.

### Verifier.sol
Auto-generated Groth16 verifier from the Circom circuit. Used by SessionManager to verify ZK proofs during session creation.

---

## SDK

The self-hosted TypeScript SDK (`sdk/`) enables agent orchestration outside the hosted UI:

| Module | Purpose |
|--------|---------|
| `AgentClient.ts` | Org, agent, credential, wallet operations |
| `SessionManager.ts` | Proof generation and session creation |
| `verifier.ts` (NEW) | **External trust verification** — verify credentials, capabilities, delegations, and session authorization on-chain without backend access |
| `types.ts` | Shared type definitions |

### AgentVerifier (SDK)

```typescript
import { AgentVerifier } from "@agentix/sdk"

const verifier = new AgentVerifier({
  chainId: 84532,
  rpcUrl: "https://base-sepolia.g.alchemy.com/v2/YOUR_KEY",
  credentialRegistry: "0xb184...4F95",
  sessionManager: "0x58E1...Ee7a",
  capabilityRegistry: "0x7Ebb...5Bb9",
  delegationManager: "0xc752...95d7",
})

await verifier.init()

// Verify a ZK credential proof
const result = await verifier.verifyCredentialProof(proof, publicSignals, {
  verifierAddress: "0xa9ED...AC48",
})

// Verify an agent capability
const capResult = await verifier.verifyCapability({
  agent: "0xAgentAddress",
  action: "payments.send",
  capabilityId: "0xCapId",
  grantId: "0xGrantId",
})

// Verify a delegation chain
const delResult = await verifier.verifyDelegation({
  delegationId: "0xDelId",
  delegate: "0xDelegate",
  scopeHash: "0xScopeHash",
  expectedOriginator: "0xOriginator",
})
```

---

## Security Model

| Principle | Implementation |
|-----------|----------------|
| **No raw secrets on-chain** | ZK proofs verify credential membership without revealing the secret |
| **Credentials ≠ Capabilities** | CapabilityRegistry is separate from CredentialRegistry — changing permissions never invalidates credentials |
| **Owner signature required** | Every critical action requires an EIP-191 wallet signature |
| **Session boundaries** | Per-session `maxValue`, daily spend/tx limits, `expiresAt` enforced in contracts |
| **Credential revocation** | Sparse Merkle tree prevents future session creation |
| **Delegation depth limits** | Configurable max chain depth (default 5, max 10) prevents unbounded delegation |
| **Cascade revocation** | Revoking a parent delegation automatically revokes all children |
| **Nonce protection** | Every signed action has a unique nonce — replay attacks prevented |
| **Encrypted session keys** | Agent session keys encrypted at rest with AES-256-GCM |
| **Chain abstraction** | No chain-specific code — add any EVM chain via env config |
| **Audit trail** | Every action logged with wallet address, timestamp, event category, severity |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `RPC_URL` | Base Sepolia RPC (Alchemy/Infura) |
| `PRIVATE_KEY` | Backend signer wallet key (Base Sepolia ETH required) |
| `BUNDLER_URL` | ERC-4337 bundler endpoint |
| `REDIS_URL` | Redis for BullMQ queues (optional) |
| `ENCRYPTION_KEY` | AES-256-GCM key (64 hex chars) |
| `SESSION_ENCRYPTION_KEY` | Session key encryption key (64 hex chars) |
| `VERIFIER_ADDRESS` | Groth16 verifier contract |
| `CREDENTIAL_REGISTRY_ADDRESS` | Credential registry contract |
| `SESSION_MANAGER_ADDRESS` | Session manager contract |
| `AGENT_WALLET_FACTORY_ADDRESS` | Wallet factory contract |
| `AGENT_WALLET_IMPLEMENTATION_ADDRESS` | Wallet implementation contract |
| `ENTRY_POINT_ADDRESS` | ERC-4337 EntryPoint |
| `CAPABILITY_REGISTRY_ADDRESS` | Capability registry contract |
| `DELEGATION_MANAGER_ADDRESS` | Delegation manager contract |
| `CHAIN_ID` | Network chain ID (default: 84532) |
| `CORS_ORIGIN` | Allowed CORS origins |

---

## Project Structure

```
agentix/
├── package.json                       # Workspace root
├── docker-compose.yml                 # Dev: PostgreSQL + Redis
├── backend/                           # Express/Hono API + MCP Server
│   ├── src/
│   │   ├── index.ts                   # Server entry point
│   │   ├── db.ts                      # PostgreSQL pool + migrations
│   │   ├── migrations.ts             # 21 versioned migrations
│   │   ├── mcp/
│   │   │   ├── server.ts             # MCP server — 30 tool handlers
│   │   │   └── types.ts              # MCP tool schemas + definitions
│   │   ├── routes/                    # REST API routes
│   │   ├── services/
│   │   │   ├── platform.ts           # Core orchestration
│   │   │   ├── chainAdapter.ts       # Multi-chain abstraction
│   │   │   ├── capabilityRegistry.ts # Capability catalog + grants
│   │   │   ├── delegation.ts         # Delegation chain logic
│   │   │   ├── externalAgent.ts      # External agent management
│   │   │   ├── audit.ts             # Governance audit trail
│   │   │   └── ...                   # merkle, prover, bundler, etc.
│   │   ├── types/
│   │   │   └── externalAgent.ts      # External agent type definitions
│   │   └── middleware/               # Auth, security, rate limiting
│   └── .env.example
├── contracts/                         # Solidity smart contracts
│   ├── src/
│   │   ├── CredentialRegistry.sol
│   │   ├── SessionManager.sol
│   │   ├── CapabilityRegistry.sol    # NEW — capability catalog
│   │   ├── DelegationManager.sol     # NEW — trust delegation
│   │   ├── AgentWallet.sol
│   │   ├── AgentWalletFactory.sol
│   │   └── Verifier.sol
│   ├── test/
│   └── scripts/
├── circuits/                          # Circom ZK circuit
├── sdk/                               # TypeScript SDK
│   └── src/
│       ├── AgentClient.ts
│       ├── SessionManager.ts
│       ├── verifier.ts               # NEW — external trust verification
│       └── types.ts
├── frontend/                          # Next.js 14 operator UI
└── docs/
```

---

## Development Commands

```bash
# Start everything (backend + frontend)
npm run dev

# Start backend only (port 3001)
npm run dev:backend

# Start frontend only (port 3000)
npm run dev:frontend

# Compile contracts
cd contracts && npx hardhat compile

# Run contract tests
npm run test:contracts

# Deploy all contracts to Base Sepolia
cd contracts && npx hardhat run scripts/deploy-all.ts --network baseSepolia

# Verify all contracts on Base Sepolia
cd contracts && npx hardhat verify --network baseSepolia <address> [constructor args]

# Build all workspaces
npm run build
```

---

## Deployment Model

### One-Command MCP Server
```bash
# Prerequisites: PostgreSQL + Redis running, .env configured
npm run dev:backend
# MCP available at http://localhost:3001/mcp
```

### Frontend
- Deploy `frontend/` to **Vercel**
- Set env: `AGENT_CREDENTIALS_API_URL`, `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL`

### Backend
- Deploy `backend/` as a long-running Node service
- **Railway** / **Fly.io** provide the simplest deployment path
- Requires: PostgreSQL, Redis (optional), Alchemy RPC + Bundler, funded wallet

---

## License

BUSL-1.1 — Converts to Apache 2.0 on January 1, 2030.

---

*"The cleanest agent systems never confuse identity, permission, and money."*
