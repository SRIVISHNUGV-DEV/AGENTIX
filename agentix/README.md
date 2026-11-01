# AgentIX V1

**Local-first AI agent credential protocol runtime.**

AgentIX gives AI agents smart wallets, credentials, sessions, and risk-bound execution — without exposing private keys, without a central server, without trusting the agent.

```
npx agentix init
```

60 seconds later, your AI agent has a wallet, a session, credentials, and every action it takes is validated, simulated, risk-scored, and explained before it touches the chain.

---

## Quick Start

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Initialize the runtime (read-only; does not touch your IDE configs)
bun x tsx src/index.ts init

# Start the whole stack (API + dashboard) on auto-selected free ports
bun run serve

# Optional: wire detected AI harnesses (Claude Code, Cursor, ...) into AgentIX.
# This edits their MCP configs, so it is opt-in — run it only when you want it.
bun x tsx src/index.ts connect
```

`bun run serve` prints the URLs it picked. It prefers `http://127.0.0.1:3000`
(dashboard) and `:3001` (API) but automatically falls back to the next free
port if either is taken, so it never collides with something already running.
The dashboard discovers the API port automatically — no manual wiring.

> **Note:** `init` is deliberately non-invasive — it sets up local storage and
> the database but does **not** modify any external tool configuration. Harness
> wiring only happens when you run `agentix connect` (or `init --connect-harnesses`).

### Security & advisories

- The API server binds to `127.0.0.1` only and has **no authentication** — it
  trusts every local caller. Do not expose its port to a network.
- `snarkjs` (ZK proving) pulls transitive dev-tooling dependencies
  (`bfj`/`jsonpath`/`underscore`, `ws`, `@ethersproject` v5) that carry
  published DoS-class advisories. They are **not reachable** from the runtime
  proving path (`groth16.fullProve`); the top-level `ethers` is v6. `bun audit`
  will flag them until upstream snarkjs updates its dependency tree.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Consumption Layer                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │  MCP     │  │  REST    │  │  CLI     │  │  Dashboard   │    │
│  │  (69     │  │  (40+    │  │  (20+    │  │  (Next.js    │    │
│  │  tools)  │  │  routes) │  │  cmds)   │  │  14 + React) │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │
│       │              │              │              │              │
│  ┌────┴──────────────┴──────────────┴──────────────┴──────────┐ │
│  │  Compiler Gateway (gateway-gated intent path)              │ │
│  │  Policy → Risk → Compile → Execute                         │ │
│  └────────────────────────────┬───────────────────────────────┘ │
│                               │                                  │
│  ┌────────────────────────────┴───────────────────────────────┐ │
│  │  Core Runtime                                               │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  │ SQLite   │  │ EventBus │  │ Merkle   │  │ ZK       │  │ │
│  │  │ (30+     │  │ (pub/sub │  │ Trees    │  │ Prover   │  │ │
│  │  │ tables)  │  │ history) │  │ (depth20)│  │ (Groth16)│  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                               │                                  │
│  ┌────────────────────────────┴───────────────────────────────┐ │
│  │  Blockchain (Base Sepolia)                                  │ │
│  │  CredentialRegistry · SessionManager · AgentWalletFactory   │ │
│  │  CapabilityRegistry · DelegationManager · OrganizationReg   │ │
│  │  AgentIdentity · Groth16Verifier · EntryPoint               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
agentix/
├── src/
│   ├── index.ts                  # CLI entry (Commander.js)
│   ├── compiler-gateway.ts       # Gated intent path (normalise → policy → risk → compile → execute)
│   ├── core/
│   │   ├── database.ts           # SQLite (better-sqlite3, WAL mode)
│   │   ├── config.ts             # Configuration management
│   │   ├── provider.ts           # Ethers provider + signer
│   │   ├── proxy-guard.ts        # Proxy validation
│   │   ├── zk-prover.ts          # Groth16 proof generation
│   │   ├── event-indexer.ts      # On-chain event indexing
│   │   └── owner-policy.ts       # Spending policy enforcement
│   ├── tools/                    # 22 tool modules
│   ├── trees/                    # Merkle tree implementations
│   ├── mcp/server.ts             # MCP server (69 tools)
│   ├── runtime/server.ts         # HTTP API (40+ routes)
│   └── blockchain/adapter.ts     # Contract interactions
├── packages/
│   ├── compiler/                 # 10-stage compilation pipeline
│   ├── core/
│   │   ├── eventbus/             # Pub/sub with history
│   │   ├── backup-engine/        # Backup/restore
│   │   ├── tree-engine/          # Merkle tree management
│   │   ├── ai-harness/           # Intent, Policy, Safety, Router
│   │   └── harness-adapter/      # 5 AI harness adapters
│   └── services/                 # 6 service modules
├── apps/dashboard/               # Next.js 14 dashboard
├── tests/                        # 23 test files
├── scripts/                      # Build scripts
└── circuits/                     # ZK circuit artifacts
```

---

## CLI Commands

```bash
agentix init                          # Initialize runtime
agentix setup                         # One-command setup (init + RPC + health)
agentix connect                       # Connect to the network
agentix health                        # Quick health check
agentix doctor                        # Health checks
agentix diagnostics                   # Full system diagnostics
agentix config [get|set|show|reset]   # Configuration
agentix org [create|get|list]         # Organizations
agentix cred [issue|revoke|get|list]  # Credentials
agentix session [create|validate]     # Sessions
agentix wallet [create|get|execute]   # Wallets
agentix tree [status|rebuild|export]  # Merkle trees
agentix delegation [create|revoke]    # Delegations
agentix capability [register|list]    # Capabilities
agentix proof [generate|verify|list]  # ZK proofs
agentix backup [create|list|restore]  # Backups
agentix contracts                     # List contract addresses
agentix rpc                           # Test RPC connectivity
agentix fund                          # Fiat on-ramp options
agentix protocol [topic]              # Protocol documentation
agentix wizard                        # Guided setup wizard
agentix compile <intent-file>         # Compile intent to execution plan
agentix execute-plan <plan-id>        # Execute an approved plan
agentix plans                         # List execution plans
agentix plan <plan-id>                # Show plan details
agentix agent [create|wallet|session] # Quick agent setup
```

---

## MCP Server (69 Tools)

The MCP server speaks the [Model Context Protocol](https://modelcontextprotocol.io) and works with any MCP-compatible client (Claude Code, Cursor, VS Code, etc.).

### Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| System | 6 | Health, stats, contracts, diagnostics, RPC test, protocol docs |
| Config | 2 | Get/show configuration |
| Wallet | 6 | Create, list, get, balance, identity, execute |
| Identity | 2 | Get by wallet, get by ID |
| Session | 4 | List, validate, find mine, status |
| Organization | 3 | List, get, get anchor |
| Credential | 5 | List, get, history, verify, oracle |
| Capability | 3 | List, get, verify |
| Delegation | 4 | Verify, verify chain, list, get root |
| Trees | 1 | Tree status |
| Proofs | 2 | List, verify |
| Events | 1 | Recent events |
| Logs | 2 | Session logs, log stats |
| Harnesses | 2 | Scan, list |
| Transactions | 2 | List, get |
| Bundler | 5 | Submit, status, flush, address, send |
| Keygen | 1 | Generate agent key pair |
| Onboarding | 2 | Status, fund options |
| Compiler | 5 | Parse intent, compile, get plan, list plans, approve plan |
| Policy | 3 | Get, check, capability envelope — the 4th policy tool, `policy_set`, is counted under Dashboard-Only, not here, so the categories sum to the 69 distinct tools with no double-count |
| Dashboard-Only | 8 | Blocked operations (session create/revoke, config set, etc., including `policy_set`) |

### Dashboard-Only Gate

These tools are blocked for AI agents at the MCP layer and require the owner. The MCP name check is not the whole enforcement: state-changing REST calls additionally require a per-run localhost token, policy changes additionally require an owner signature verified against the wallet's registered owner, and plan approval over MCP additionally requires an owner attestation signature. `session_prune` and `wallet_whitelist` have no live REST equivalent.

- `agentix_session_create` — Requires owner signature
- `agentix_session_revoke` — Requires owner signature
- `agentix_session_prune` — System operation
- `agentix_wallet_whitelist` — Deprecated
- `agentix_wallet_execute_batch` — Requires owner signature
- `agentix_config_set` — System configuration
- `agentix_backup_create` — System operation
- `agentix_policy_set` — Requires owner signature

---

## API Routes (40+)

### Health & Status
- `GET /api/health` — System health check
- `GET /api/stats` — System statistics
- `GET /api/price` — ETH/USD price
- `GET /api/config` — Configuration
- `PUT /api/config` — Update configuration

### Organizations
- `GET /api/organizations` — List organizations
- `GET /api/organizations/:id` — Get organization
- `POST /api/organizations/requests` — Create request
- `POST /api/organizations/requests/:id` — Approve/reject

### Credentials
- `GET /api/credentials` — List credentials
- `POST /api/credentials` — Issue credential
- `GET /api/credentials/oracle` — Oracle state
- `GET /api/credentials/next-agent-id` — Next agent ID
- `GET /api/credentials/orgs` — Org dropdown
- `POST /api/credentials/update-root` — Propose root (effective only after the 2-day timelock + accept-root)
- `POST /api/credentials/accept-root` — Accept a pending root proposal (after the timelock)

### Wallets
- `GET /api/wallets` — List wallets
- `POST /api/wallets` — Create wallet
- `POST /api/wallets/link` — Link harness
- `POST /api/wallets/create-tx` — Encode create tx
- `POST /api/wallets/confirm` — Confirm wallet
- `POST /api/wallets/execute-tx` — Encode execute tx
- `POST /api/wallets/deposit-tx` — Encode deposit tx

### Sessions
- `GET /api/sessions` — List sessions
- `POST /api/sessions` — Create session
- `DELETE /api/sessions` — Revoke session
- `POST /api/sessions/prepare-lightweight` — Prepare params
- `POST /api/sessions/create-lightweight-tx` — Encode session tx

### Proofs
- `GET /api/proofs` — List proofs
- `POST /api/proofs/generate` — Generate proof
- `POST /api/proofs/verify` — Verify proof
- `GET /api/proofs/artifacts` — ZK artifact status

### Contracts
- `GET /api/contracts` — List contracts
- `GET /api/contracts/registry` — Contract registry
- `GET /api/contracts/functions` — Contract functions
- `POST /api/contracts/read` — Read contract
- `POST /api/contracts/prepare-write` — Prepare write tx

### Trees
- `GET /api/trees` — Tree status
- `GET /api/trees/all` — All trees
- `POST /api/trees/rebuild` — Rebuild tree
- `GET /api/trees/verify` — Verify tree
- `GET /api/trees/export` — Export tree
- `POST /api/trees/import` — Import tree
- `GET /api/trees/snapshots` — List snapshots

### Events
- `GET /api/events` — List events
- `GET /api/events/indexer/status` — Indexer status
- `POST /api/events/indexer/run` — Run indexer
- `POST /api/events/indexer/reindex` — Reindex events

### Actions & Transactions
- `GET /api/actions` — List actions
- `GET /api/transactions` — List transactions

### Capabilities & Delegations
- `GET /api/capabilities` — List capabilities
- `POST /api/capabilities` — Create capability
- `GET /api/delegations` — List delegations
- `POST /api/delegations` — Create delegation

### Anomalies & Backups
- `GET /api/anomalies` — List anomalies
- `GET /api/backups` — List backups
- `POST /api/backups` — Create backup

### Diagnostics
- `GET /api/diagnostics` — Full diagnostics

### Onboarding
- `GET /api/onboarding/status` — Onboarding status
- `GET /api/onboarding/diagnostics` — Onboarding diagnostics
- `GET /api/onboarding/harnesses` — Harness scan
- `POST /api/onboarding/harnesses/connect` — Connect harnesses
- `POST /api/onboarding/init` — Initialize runtime
- `POST /api/onboarding/fund` — Fund options

### Identity
- `GET /api/identity/:wallet` — Identity lookup
- `POST /api/identity/register` — Register identity
- `POST /api/identity/update-metadata` — Update metadata

### Compiler
- `POST /api/execute` — Compiler gateway
- `GET /api/plans` — List plans
- `POST /api/plans/approve` — Approve plan
- `POST /api/plans/reject` — Reject plan
- `POST /api/capability-envelope` — Capability envelope

### Policy
- `GET /api/policy/:wallet` — Get policy
- `POST /api/policy` — Set policy
- `POST /api/policy/check` — Check policy

### Bundler
- `POST /api/bundler/send` — Send UserOp

### Debug
- `POST /api/debug/simulate` — Simulate tx

### Runtimes
- `GET /api/runtimes` — List runtimes
- `POST /api/runtimes` — Create runtime
- `DELETE /api/runtimes` — Delete runtime
- `POST /api/runtimes/health` — Runtime health

### x402 Payments
- `GET /api/x402/payments` — Payment history
- `GET /api/x402/stats` — Payment stats
- `GET /api/x402/policy` — Payment policy
- `POST /api/x402/policy` — Set payment policy
- `POST /api/x402/buy` — Make payment
- `GET /api/x402/balance` — USDC balance

---

## Dashboard (20 Pages)

| Page | Description |
|------|-------------|
| Overview | System status, stats, recent events |
| Wallets | Create, list, view wallet details |
| Agents | AI harness detection and status |
| Identities | On-chain identity lookup |
| Organizations | Org registry and requests |
| Sessions | Create, list, revoke sessions |
| Capabilities | Capability registry |
| Delegations | Delegation chains |
| Transactions | Transaction history |
| Events | Event timeline |
| Actions | Agent action log |
| Plans | Execution plan viewer |
| x402 | x402 payment management |
| Analytics | System analytics |
| Diagnostics | Full system diagnostics |
| Anomalies | Anomaly detection |
| Backups | Backup management |
| Developer | Contract registry, ABI viewer |
| Settings | Configuration management |
| Onboarding | 9-step setup wizard |

---

## Database (30+ Tables)

| Table | Purpose |
|-------|---------|
| `config` | Key-value configuration |
| `organizations` | Organization registry |
| `credentials` | Credential records |
| `wallets` | Wallet records |
| `sessions` | Session records |
| `proofs` | Proof records |
| `capabilities` | Capability definitions |
| `delegations` | Delegation records |
| `logs` | System logs |
| `backups` | Backup records |
| `merkle_snapshots` | Tree snapshots |
| `agent_actions` | Action audit log |
| `organization_requests` | Org requests |
| `harnesses` | AI harnesses |
| `transactions` | Transaction records |
| `events` | Local events |
| `indexed_events` | On-chain events |
| `execution_plans` | Compiler plans |
| `compilation_cache` | Compiler cache |
| `policy_snapshots` | Policy snapshots |
| `indexer_checkpoints` | Indexer state |
| `scheduler_jobs` | Job queue |
| `owner_policies` | Spending policies |
| `bundler_queue` | UserOp queue |
| `identities` | Identity records |
| `x402_payments` | x402 payments |
| `x402_incoming_payments` | x402 incoming |
| `x402_vouchers` | x402 vouchers |
| `x402_used_nonces` | Nonce dedup |
| `runtimes` | Runtime configs |
| `metadata` | Schema version |

---

## Smart Contracts (Base Sepolia)

Addresses below are copied from [`contracts/deployments/baseSepolia-84532.json`](../contracts/deployments/baseSepolia-84532.json), which is the canonical record — if any other document in this repo shows a different address, that file wins. **Live-health warning:** both the old config-default set and this deployment set have contracts deployed on Base Sepolia, and all 12 proxy addresses in both sets read an all-zero ERC1967 implementation slot — do not run a real-contract demo against either set. Live on-chain flows need a fresh verified deployment first.

| Contract | Proxy | Purpose |
|----------|-------|---------|
| Groth16Verifier | `0x3056bB17323228d1829D2f6A2a96Af8e079095c2` | ZK proof verification |
| CredentialRegistry | `0xF1C30a96aa97faB2A29B2E8Cdc05fc321AA7511E` | Credential Merkle roots |
| SessionManager | `0x9b7B7d631098f046eaFb4637DC859eBA51e238C0` | ZK + lightweight sessions |
| AgentWalletFactory | `0x6A4C643f59952CfBfEcEdaf182B3C98D778df2c1` | Deterministic wallet deploy |
| AgentWallet (impl) | `0x6C826A49aD8447FD94d61f515013ea93066e94C5` | ERC-4337 smart account |
| CapabilityRegistry | `0x90D4d0D35709D4e29765F5132DaD0E85Fc07aD6A` | Capability definitions |
| DelegationManager | `0x6Ee3cdeB9c1a1aE83CF0bb0E469B98736Cb07CB5` | Trust delegation chains |
| OrganizationRegistry | `0xdF3e6819fC65966d0D43A3768Aaa40fd50B59443` | Organization registry |
| OrgCredentialAnchor | `0x491aD666EFb0E79Ce8406a10914033eEdB6165b6` | Org credential anchor |
| AgentIdentity | `0xaF20A4CF58CF8E3DF6bF2545Ed9371d39E97cD71` | Agent identity |
| EntryPoint | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | ERC-4337 EntryPoint |

---

## ZK Circuit

**Circuit:** `credential_V1.circom` (depth-20 Merkle + SMT revocation, Poseidon hashes)

**Public Signals (7):**
1. `activeRoot` — Active credential Merkle root
2. `revokedRoot` — Revoked credential SMT root
3. `maxValue` — Maximum transaction value
4. `sessionExpiry` — Session expiry timestamp
5. `wallet` — Agent wallet address
6. `credentialVersion` — Always 1
7. `nullifier` — Poseidon3(orgId, secret, sessionNonce)

**Poseidon Usage (all array-arg form, canonical iden3 vectors):**
- Commitment: `Poseidon7(agentId, orgId, budgetLimit, wallet, expiry, credVersion, secret)`
- Nullifier: `Poseidon3(orgId, secret, sessionNonce)`
- Revocation Key: `Poseidon2(secret, 0) mod 2^64`
- Merkle Hash: `Poseidon2(left, right)`

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Base Sepolia RPC endpoint | `https://sepolia.base.org` |
| `RPC_FALLBACK_URL` | Fallback RPC endpoint | `https://base-sepolia-rpc.publicnode.com` |
| `PRIVATE_KEY` | Backend signer wallet key | (required for writes) |
| `AGENTIX_HOME` | AgentIX home directory | `~/.agentix` |
| `AGENTIX_CIRCUITS_DIR` | ZK circuit artifacts directory | (auto-detected) |

---

## Configuration

Configuration is stored at `~/.agentix/config/agentix.config.json`:

```json
{
  "version": "1.0.0",
  "chainId": 84532,
  "rpcUrl": "https://sepolia.base.org",
  "rpcFallbackUrl": "https://base-sepolia-rpc.publicnode.com",
  "networkName": "baseSepolia",
  "contracts": {
    "groth16Verifier": "0x3056bB17323228d1829D2f6A2a96Af8e079095c2",
    "credentialRegistry": "0xF1C30a96aa97faB2A29B2E8Cdc05fc321AA7511E",
    "sessionManager": "0x9b7B7d631098f046eaFb4637DC859eBA51e238C0",
    "agentWalletFactory": "0x6A4C643f59952CfBfEcEdaf182B3C98D778df2c1",
    "agentWalletImplementation": "0x6C826A49aD8447FD94d61f515013ea93066e94C5",
    "capabilityRegistry": "0x90D4d0D35709D4e29765F5132DaD0E85Fc07aD6A",
    "delegationManager": "0x6Ee3cdeB9c1a1aE83CF0bb0E469B98736Cb07CB5",
    "organizationRegistry": "0xdF3e6819fC65966d0D43A3768Aaa40fd50B59443",
    "organizationCredentialAnchor": "0x491aD666EFb0E79Ce8406a10914033eEdB6165b6",
    "agentIdentity": "0xaF20A4CF58CF8E3DF6bF2545Ed9371d39E97cD71",
    "entryPoint": "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
  },
  "database": {
    "path": "~/.agentix/db/agentix.db"
  },
  "backup": {
    "path": "~/.agentix/backups"
  },
  "logs": {
    "path": "~/.agentix/logs"
  }
}
```

---

## Testing

```bash
# Run all tests
bun x vitest run

# Run E2E tests
bun x tsx tests/e2e.test.ts

# Run specific test
bun x vitest run tests/circuit-compat.test.ts

# Run soak test (24-hour continuous operation)
bun x tsx tests/soak-test.ts --duration=24h --interval=5m
```

### Test Results (Latest)

- **TypeScript Compilation:** ✅ Clean (both agentix/ and apps/dashboard/)
- **Unit Tests:** ✅ 254 passed (22 files)
- **E2E Tests:** ✅ 31/31 pass
- **Circuit Compatibility:** ✅ All Poseidon vectors verified

---

## Security Model

| Principle | Implementation |
|-----------|----------------|
| No raw secrets on-chain | ZK proofs verify credential membership without revealing the secret |
| Credentials ≠ Capabilities | CapabilityRegistry is separate from CredentialRegistry |
| Owner signature required | Every critical action requires an EIP-191 wallet signature |
| Session boundaries | Per-session maxValue, daily spend/tx limits, expiresAt |
| Credential revocation | Sparse Merkle tree prevents future session creation |
| Delegation depth limits | Configurable max chain depth (default 5, max 10) |
| Cascade revocation | Revoking a parent delegation revokes all children |
| Nonce protection | Every signed action has a unique nonce |
| Encrypted session keys | Agent session keys encrypted at rest with AES-256-GCM |
| Audit trail | Every action logged with wallet address, timestamp, risk level |

---

## License

BUSL-1.1 — Converts to Apache 2.0 on January 1, 2030.

---

## Documentation

- [CHANGELOG.md](./CHANGELOG.md) — Version history
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Deployment instructions
- [MIGRATION.md](./MIGRATION.md) — Migration guide
- [RECOVERY.md](./RECOVERY.md) — Disaster recovery
- [SEQUENCE.md](./SEQUENCE.md) — Sequence diagrams
- [RELEASE_VALIDATION_REPORT.md](./RELEASE_VALIDATION_REPORT.md) — Beta-1 release validation
