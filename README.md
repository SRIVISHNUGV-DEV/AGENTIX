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

All contracts deployed and **verified on [Basescan](https://sepolia.basescan.org)**. 36/36 on-chain tests passing.

| Contract | Proxy | Implementation | Role |
|----------|-------|----------------|------|
| **Groth16Verifier** | [`0x6cBb...EB61f`](https://sepolia.basescan.org/address/0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424) | (non-upgradeable) | Groth16 ZK proof verification |
| **CredentialRegistry** | [`0x83e0...65F5c`](https://sepolia.basescan.org/address/0xC3F474e08Fe68bBa39daCCE52FC4F11262364701) | [`0x6CF1...fbeC8`](https://sepolia.basescan.org/address/0xee90ca74f7ACB71Df399B5141f1477dB2Aa009DC) | Credential Merkle roots |
| **SessionManager** | [`0xcC0a...4C58`](https://sepolia.basescan.org/address/0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2) | [`0x98aB...B17f`](https://sepolia.basescan.org/address/0xA40cD41aB090B58ba441c8Dd60dB514724b76229) | ZK + lightweight sessions |
| **AgentWalletFactory** | [`0x6313...1677`](https://sepolia.basescan.org/address/0x36ECC27acd245dbac23Ca1bC72798E75BfbA4a84) | [`0xEE1A...29F2`](https://sepolia.basescan.org/address/0xa57FEeB3BCC47e5Ac684E825a68B695B9356a907) | Deterministic wallet deploy |
| **AgentWallet** | — | [`0x3144...1e9A`](https://sepolia.basescan.org/address/0xB00c0a6A821D054098D3a9D87A93c1fE2A76b4e8) | ERC-4337 smart account |
| **CapabilityRegistry** | [`0xA562...98297`](https://sepolia.basescan.org/address/0xa3166c63920305B7fBE11f97683B99F239bC7975) | [`0xaf73...83024`](https://sepolia.basescan.org/address/0xb9eA3648ad157e5EAeE043526Dacc0E9087B168b) | Capability definitions & grants |
| **DelegationManager** | [`0xa52e...02DA`](https://sepolia.basescan.org/address/0x355b30477125c6a2F1323095baf99D3781bABd3B) | [`0x301f...88aD`](https://sepolia.basescan.org/address/0x7A6556C295c07F85bCb0B63f73b3c21eaB40B2ea) | Trust delegation chains |
| **EntryPoint** | [`0x4337...F108`](https://sepolia.basescan.org/address/0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108) | (ERC-4337 singleton) | UserOperation relay |

**Deployer:** [`0xE2e3...ADAcC`](https://sepolia.basescan.org/address/0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC)

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

### Groth16Verifier (`0x6cBb...EB61f`)
Auto-generated Groth16 verifier from the Circom circuit. Used by SessionManager to verify ZK proofs during session creation. Non-upgradeable, deployed as a standalone contract.

### CredentialRegistry (`0x83e0...65F5c`)
UUPS proxy. Stores the active Merkle root and revoked sparse-Merkle root. Every credential issuance or revocation updates these roots. The single source of truth for agent authorization state.

### SessionManager (`0xcC0a...4C58`)
UUPS proxy. Validates Groth16 proofs (ZK sessions) and EIP-191 signatures (lightweight sessions). Creates replay-safe, bounded sessions with `maxValue`, daily spend/tx limits, and `expiresAt` constraints:
- **ZK-Proof Session** (~300k gas) — Privacy-preserving, requires Groth16 proof
- **Lightweight Session** (~80k gas) — EIP-191 signature, daily spend/tx limits

### CapabilityRegistry (`0xA562...98297`)
UUPS proxy. On-chain catalog for agent capabilities. Capabilities are defined with an action, effect (allow/deny/audit), and constraint set. Grants link capabilities to agent addresses. Key functions:
- `registerCapability()` / `revokeCapability()`
- `setRootUpdater()` / `updateGrantRoot()`
- `verifyCapability()` — for third-party verifiers

### DelegationManager (`0xa52e...02DA`)
UUPS proxy. Enables trust delegation chains between agents. A delegator grants a delegate a scope of authority, who can further delegate (up to a configurable depth). Revocation cascades to all children. Key functions:
- `updateDelegationRoot()` / `revokeDelegation()`
- `verifyDelegation()` / `verifyDelegationForAction()` / `verifyDelegationChain()`

### AgentWalletFactory (`0x6313...1677`)
UUPS proxy. Deterministic deployment of ERC-4337 smart accounts using CREATE2. Each agent gets a predictable wallet address derived from organization salt and agent ID.

### AgentWallet (`0x3144...1e9A`)
ERC-4337-compatible smart account (clone implementation). Validates UserOperations against active sessions or owner address. Supports `execute()`, `executeBatch()`, whitelist management, and ownership transfer.

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
  credentialRegistry: "0xC3F474e08Fe68bBa39daCCE52FC4F11262364701",
  sessionManager: "0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2",
  capabilityRegistry: "0xa3166c63920305B7fBE11f97683B99F239bC7975",
  delegationManager: "0x355b30477125c6a2F1323095baf99D3781bABd3B",
})

await verifier.init()

// Verify a ZK credential proof
const result = await verifier.verifyCredentialProof(proof, publicSignals, {
  verifierAddress: "0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424",
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

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `DATABASE_URL` | `postgresql://agentix:secret@localhost:5432/agentix` | PostgreSQL connection string |
| `RPC_URL` | `https://base-sepolia.g.alchemy.com/v2/KEY` | Base Sepolia RPC (Alchemy/Infura) |
| `PRIVATE_KEY` | `0x...` | Backend signer wallet key (Base Sepolia ETH required) |
| `BUNDLER_URL` | `https://base-sepolia.g.alchemy.com/v2/KEY` | ERC-4337 bundler endpoint |
| `REDIS_URL` | `redis://localhost:6379` | Redis for BullMQ queues (optional) |
| `ENCRYPTION_KEY` | `64 hex chars` | AES-256-GCM key for stored secrets |
| `SESSION_ENCRYPTION_KEY` | `64 hex chars` | Session key encryption key |
| `VERIFIER_ADDRESS` | `0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424` | Groth16 verifier contract |
| `CREDENTIAL_REGISTRY_ADDRESS` | `0xC3F474e08Fe68bBa39daCCE52FC4F11262364701` | Credential registry contract |
| `SESSION_MANAGER_ADDRESS` | `0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2` | Session manager contract |
| `AGENT_WALLET_FACTORY_ADDRESS` | `0x36ECC27acd245dbac23Ca1bC72798E75BfbA4a84` | Wallet factory contract |
| `AGENT_WALLET_IMPLEMENTATION_ADDRESS` | `0xB00c0a6A821D054098D3a9D87A93c1fE2A76b4e8` | Wallet implementation contract |
| `ENTRY_POINT_ADDRESS` | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | ERC-4337 EntryPoint |
| `CAPABILITY_REGISTRY_ADDRESS` | `0xa3166c63920305B7fBE11f97683B99F239bC7975` | Capability registry contract |
| `DELEGATION_MANAGER_ADDRESS` | `0x355b30477125c6a2F1323095baf99D3781bABd3B` | Delegation manager contract |
| `CHAIN_ID` | `84532` | Network chain ID (Base Sepolia) |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origins |

---

## Project Structure

```
agentix/
├── package.json                       # Workspace root
├── docker-compose.yml                 # Dev: PostgreSQL + Redis
├── .mcp.json                          # MCP config for Claude Code / Cursor / VS Code
├── mcp-configs.json                   # Generated configs for 7 MCP clients
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
│   │   ├── CapabilityRegistry.sol
│   │   ├── DelegationManager.sol
│   │   ├── AgentWallet.sol
│   │   ├── AgentWalletFactory.sol
│   │   ├── Credentialverifier.sol    # Groth16 verifier (auto-generated)
│   │   └── mocks/MockVerifier.sol
│   ├── test/
│   │   ├── AgentWallet.test.ts
│   │   ├── SessionManager.test.ts
│   │   └── LightweightSession.test.ts
│   └── scripts/
│       ├── deploy-all.ts
│       ├── deploy-and-test.ts        # Deploy + 36 on-chain tests
│       ├── test-onchain.ts           # Test-only against deployed addresses
│       └── verify-all.ts
├── mcp-test/                          # MCP test server (standalone)
├── sdk/                               # TypeScript SDK
│   └── src/
│       ├── AgentClient.ts
│       ├── SessionManager.ts
│       ├── verifier.ts               # External trust verification
│       └── types.ts
├── frontend/                          # Next.js 14 operator UI
├── cli/                               # CLI client
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

## V1 Documentation

| Document | Description |
|----------|-------------|
| [Implementation Plan](agentix_v1_implementation_plan.md) | V1 deployment plan with all fixes applied |
| [Runtime Integrity](agentix_runtime_integrity.md) | Data flow and integrity verification report |
| [Architecture](agentix_architecture.md) | System architecture and design decisions |
| [Test Plan](agentix_test_plan.md) | Comprehensive testing strategy |
| [Developer Guide](agentix_developer_guide.md) | Quickstart, SDK reference, API docs |
| [Production Checklist](agentix_production_checklist.md) | Pre-deployment verification steps |

---

## License

BUSL-1.1 — Converts to Apache 2.0 on January 1, 2030.

---

*"The cleanest agent systems never confuse identity, permission, and money."*
