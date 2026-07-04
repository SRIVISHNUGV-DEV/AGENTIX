# AgentIX V1 — Architecture Audit

## 1. Executive Summary

Two codebases exist: **`agentix/`** (full local runtime, CLI, dashboard, MCP) and **`orchestrator/`** (TypeScript SDK). They have **zero imports between them** despite containing **significant duplicate logic**. Neither is the "truth" — both independently implement the same contract interactions with different abstractions.

## 2. Existing Code Audit

### agentix/ — What Works

| Component | Status | Notes |
|-----------|--------|-------|
| CLI (15 commands) | ✅ Working | Commander.js, clear structure |
| SQLite Database (19 tables) | ✅ Working | better-sqlite3, WAL mode, schema v1.1.0 |
| HTTP API Server (35 endpoints) | ✅ Working | Raw Node http on :3001 |
| MCP Server (40 tools) | ✅ Working | stdio transport, @modelcontextprotocol/sdk |
| Dashboard (13 pages) | ✅ Working | Next.js 14, Tailwind, Framer Motion |
| Event Bus | ✅ Working | Pub/sub, 18 event types, wildcard handlers |
| Merkle Trees | ✅ Working | Active + revoked, Poseidon hash |
| Backup Engine | ✅ Working | Create, list, restore, checksummed |
| AI Harness Detection | ✅ Working | 5 adapters: Claude, Mimo, OpenCode, Copilot, Hermes |
| Diagnostics (12 checks) | ✅ Working | Health + full diagnostics |
| Setup Wizard | ✅ Working | 9-step onboarding at :3000/onboarding |
| Test Suite (24 files) | ✅ Working | Vitest-based, various coverage areas |
| Fiat On-Ramp Comparision | ✅ Working | MoonPay, Coinbase, Transak, Ramp |

### agentix/ — What's Broken or Redundant

| Component | Issue |
|-----------|-------|
| **Two SQLite databases** | `src/core/database.ts` and `packages/core/database/index.ts` have near-identical schemas (17 vs 14 tables). Both use better-sqlite3. One is the "real" one used by the CLI; the other is packaged but only used in some service imports. |
| **Three contract interaction layers** | `src/tools/*.ts` direct contract calls + `src/blockchain/adapter.ts` raw encoding + `src/contracts/index.ts` ABI loader. All do the same thing with different patterns. |
| **MCP server duality** | `src/mcp/server.ts` (40 tools, writes allowed) and `src/mcp/index.ts` (26 tools, read-only). The hardened one is what gets installed, meaning half the MCP tools are inaccessible. |
| **Package/services duplication** | `packages/services/*` implement CRUD operations that are also implemented in `src/tools/*`. Services are imported by the API server, tools by the CLI — two paths to the same data. |

### orchestrator/ — What Works

| Component | Status | Notes |
|-----------|--------|-------|
| ContractRegistry | ✅ Clean | Human-readable ABI fragments, get/send pattern, ethers v6 |
| TransactionManager | ✅ Clean | send/estimate/simulate/wait, retry, event parsing |
| WalletModule | ✅ Clean | create, execute, batch, deposits, ownership |
| SessionModule | ✅ Clean | ZK + lightweight sessions, revocation, pruning |
| IdentityModule | ✅ Clean | Register, link, metadata, deactivate, reactivate |
| CredentialModule | ✅ Clean | Roots, nullifiers, issuers |
| DelegationModule | ✅ Clean | Roots, chains, verification |
| CapabilityModule | ✅ Clean | Register, revoke, grants, verify |
| OrganizationModule | ✅ Clean | Read-only queries |
| EventIndexer | ✅ Clean | KNOWN_EVENTS mapping, named param parsing |
| Error System (70+ classes) | ✅ Excellent | Typed errors, ERROR_MAP, mapContractError |
| Access Control (onlyOwner) | ✅ Clean | OwnerModule separated from public modules |
| AgentIX entry class | ✅ Clean | Convenience methods, module wiring |
| Config loader | ✅ Clean | Env vars + overrides |

### orchestrator/ — What's Missing or Broken

| Component | Issue |
|-----------|-------|
| **Database** | JSON file (`db.json`) — not suitable for production. No indexing, concurrency, or migrations. |
| **Tests** | **None.** Empty `test/` directory. |
| **Build** | `dist/` is stale — missing `onlyOwner/` subdirectory from compiled output. |
| **MCP Server** | Not included — orchestrator is SDK only. |
| **HTTP API** | Not included — orchestrator is SDK only. |
| **Event Bus** | Not included — orchestrator has EventIndexer but no pub/sub bus. |
| **Backup Engine** | Not included. |
| **Merkle Trees** | Not included. |
| **AI Harness Detection** | Not included. |
| **Harness adapter (entity)** | Not included (only template and detection) |
| **Anomaly Detection** | Not included. |

## 3. Duplication Map

| Functionality | agentix/ | orchestrator/ | Verdict |
|---------------|----------|---------------|---------|
| Wallet create/execute | `src/tools/wallet.ts` + `src/blockchain/adapter.ts` | `src/wallet.ts` | **DUPLICATED — orchestrator cleaner** |
| Session create/revoke | `src/tools/session.ts` | `src/session.ts` | **DUPLICATED — orchestrator cleaner** |
| Credential roots/issuers | `src/tools/credential.ts` | `src/credential.ts` | **DUPLICATED — orchestrator cleaner** |
| Org CRUD | `src/tools/organization.ts` | `src/organization.ts` | **DUPLICATED — orchestrator cleaner** |
| Delegations | `src/tools/delegation.ts` | `src/delegation.ts` | **DUPLICATED — orchestrator cleaner** |
| Capabilities | `src/tools/capability.ts` | `src/capability.ts` | **DUPLICATED — orchestrator cleaner** |
| Contract ABIs | `src/contracts/abis/*.json` | `src/contracts.ts` (inline) | **DUPLICATED — keep one** |
| Database | `src/core/database.ts` + `packages/core/database/` | `src/database.ts` (JSON) | **THREE implementations — keep SQLite only** |
| Transaction pipeline | `src/blockchain/adapter.ts` | `src/transaction.ts` | **DUPLICATED — orchestrator TransactionManager is superior** |
| Configuration | `src/core/config.ts` (file-based) | `src/config.ts` (env+param) | **DIFFERENT — both needed** |

## 4. Architecture Decision: Runtime-First

The **Runtime** becomes the single process that owns everything. It replaces the current split between agentix's CLI/API/MCP and orchestrator's SDK.

```
┌─────────────────────────────────────────────────────┐
│                  agentix runtime                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │   CLI/REPL   │  │  API Server   │  │ MCP Server │ │
│  │  (commander) │  │   (hono)      │  │  (stdio)   │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │         │
│  ┌──────┴─────────────────┴─────────────────┴──────┐ │
│  │               orchestrator (SDK)                │ │
│  │  WalletModule  SessionModule  CredentialModule │ │
│  │  IdentityModule CapabilityModule DelegationMod  │ │
│  │  OrganizationModule TransactionManager          │ │
│  └──────────────────────┬──────────────────────────┘ │
│                         │                             │
│  ┌──────────────────────┴──────────────────────────┐ │
│  │  Local Runtime (daemon)                        │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────────┐ │ │
│  │  │ SQLite  │ │ EventBus │ │ Harness Detector │ │ │
│  │  │ (19 tbl)│ │ Indexer  │ │ (5 adapters)     │ │ │
│  │  └─────────┘ └──────────┘ └──────────────────┘ │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────────┐ │ │
│  │  │ Merkle  │ │ Backup   │ │ Diagnostics      │ │ │
│  │  │ Trees   │ │ Engine   │ │ + Anomaly Detect │ │ │
│  │  └─────────┘ └──────────┘ └──────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                    JSON-RPC
                         │
              Base Sepolia (Chain 84532)
```

## 5. What to Keep vs Rebuild

### KEEP (minimal changes)

| Item | Reason |
|------|--------|
| `orchestrator/src/` (all modules) | Clean SDK with proper abstractions: ContractRegistry, TransactionManager, typed errors, 9 domain modules, onlyOwner separation |
| `agentix/src/core/database.ts` | Production SQLite with WAL, 19 tables, migrations — far better than JSON file |
| `agentix/packages/core/eventbus/` | Working pub/sub with history — needs no changes |
| `agentix/packages/core/backup-engine/` | Working backup/restore with checksums |
| `agentix/packages/core/tree-engine/` | Working Merkle tree management |
| `agentix/packages/core/ai-harness/` | Working intent/policy/safety engine |
| `agentix/packages/core/harness-adapter/` | Working AI harness detection (5 adapters) |
| `agentix/apps/dashboard/` | Working Next.js app — just needs API to talk to runtime |
| `agentix/src/runtime/server.ts` | API endpoints — most are fine, just need to use SDK internally |
| `agentix/src/mcp/server.ts` | MCP tools — most are fine, just need to use SDK internally |
| `agentix/src/core/logger.ts` | Working file + console logger |
| `agentix/src/core/provider.ts` | Ethers provider and signer setup |
| `agentix/src/core/proxy-guard.ts` | Working proxy enforcement |
| `agentix/src/core/price-oracle.ts` | ETH/USD pricing with Chainlink + CoinGecko |
| `agentix/src/tools/wizard.ts` | Full diagnostics engine |
| `agentix/src/tools/diagnostics.ts` | Diagnostics tool |
| `agentix/src/tools/health.ts` | Health check system |
| `agentix/src/tools/session-logs.ts` | Session logging + anomaly detection |

### REPLACE (use orchestrator SDK + agentix runtime)

| Item | Replace With |
|------|--------------|
| `agentix/src/tools/{wallet,session,credential,org,delegation,capability,identity}.ts` | `orchestrator/src/{wallet,session,credential,organization,delegation,capability,identity}.ts` |
| `agentix/src/blockchain/adapter.ts` | Orchestrator TransactionManager |
| `agentix/src/contracts/` (ABIs + index.ts) | Orchestrator ContractRegistry (inline ABIs) |
| `agentix/packages/core/database/` | `agentix/src/core/database.ts` (keep one) |
| `agentix/packages/services/*` | Orchestrator modules (they ARE the services) |
| `agentix/packages/shared/*` | Orchestrator types + errors (single source of truth) |

### DELETE (no longer needed)

| Item | Reason |
|------|--------|
| `agentix/packages/services/*` (all 6) | Service logic now lives in orchestrator modules |
| `agentix/packages/shared/types/` | Types consolidated into orchestrator |
| `agentix/packages/shared/constants/` | Constants inline or in orchestrator |
| `agentix/packages/shared/schemas/` | Validation moves to orchestrator |
| `agentix/packages/shared/utils/` | Utilities in orchestrator utils |
| `agentix/packages/core/database/` | Duplicate of src/core/database.ts |
| `agentix/src/contracts/abis/` | Replaced by orchestrator inline ABIs + extracted JSON in contracts/ |
| `agentix/src/blockchain/adapter.ts` | Replaced by orchestrator modules |
| `agentix/src/mcp/index.ts` | Keep only server.ts (security-hardened) |
| `agentix/src/tools/config-tool.ts` | Config handled by runtime |
| `agentix/src/tools/deployment.ts` | Init handled by runtime |
| `orchestrator/src/database.ts` | JSON file DB — replaced by SQLite |

## 6. Component Dependency Graph (New)

```
agentix (npm package)
│
├── bin/agentix          # CLI entry → lifecycle manager
├── bin/agentix-mcp      # MCP server entry
│
├── src/
│   ├── index.ts         # CLI orchestration (stays as-is)
│   ├── runtime/
│   │   ├── server.ts    # Hono-based API server
│   │   ├── lifecycle.ts # Start/stop services (new)
│   │   └── config.ts    # Runtime config management
│   ├── mcp/
│   │   └── server.ts    # MCP tools (uses SDK directly)
│   ├── core/
│   │   ├── database.ts  # SQLite (KEEP)
│   │   ├── logger.ts    # Logger (KEEP)
│   │   ├── provider.ts  # Ethers provider (KEEP)
│   │   ├── proxy-guard.ts # Proxy validation (KEEP)
│   │   ├── price-oracle.ts # ETH/USD oracle (KEEP)
│   │   └── eventbus.ts  # Import from packages (KEEP)
│   ├── tools/
│   │   ├── index.ts     # Tool registry (UPDATE)
│   │   ├── health.ts    # KEEP
│   │   ├── diagnostics.ts # KEEP
│   │   ├── wizard.ts    # KEEP
│   │   ├── session-logs.ts # KEEP
│   │   ├── fund.ts      # KEEP
│   │   └── help.ts      # KEEP
│   │   └── [REMOVED] wallet.ts → uses SDK
│   │   └── [REMOVED] session.ts → uses SDK
│   │   └── [REMOVED] credential.ts → uses SDK
│   │   └── [REMOVED] organization.ts → uses SDK
│   │   └── [REMOVED] delegation.ts → uses SDK
│   │   └── [REMOVED] capability.ts → uses SDK
│   │   └── [REMOVED] proof.ts → uses SDK
│   │   └── [REMOVED] tree.ts → uses SDK
│   │   └── [REMOVED] backup.ts → uses SDK
│   ├── sdk/             # NEW: orchestrator code integrated
│   │   ├── AgentIX.ts   # Main SDK entry
│   │   ├── contracts.ts # ContractRegistry
│   │   ├── transaction.ts # TransactionManager
│   │   ├── types.ts     # TypeScript interfaces
│   │   ├── errors.ts    # Error classes + mapper
│   │   ├── config.ts    # SDK config loader
│   │   ├── utils.ts     # Validation utilities
│   │   ├── wallet.ts    # WalletModule
│   │   ├── identity.ts  # IdentityModule
│   │   ├── session.ts   # SessionModule
│   │   ├── credential.ts # CredentialModule
│   │   ├── delegation.ts # DelegationModule
│   │   ├── capability.ts # CapabilityModule
│   │   ├── organization.ts # OrganizationModule
│   │   ├── events.ts    # EventIndexer
│   │   └── onlyOwner/   # Admin operations
│   │       └── index.ts # OwnerModule
│   ├── services/        # NEW: runtime services
│   │   ├── index.ts     # Service registry
│   │   ├── runtime.ts   # Runtime daemon (start/stop/status)
│   │   ├── event-indexer.ts # Automated event indexing
│   │   ├── harness-detector.ts # AI harness detection
│   │   ├── anomaly-detector.ts # Anomaly detection
│   │   └── diagnostics.ts # Diagnostics engine
│   └── trees/           # KEEP
│       ├── active-tree.ts
│       ├── revoked-tree.ts
│       └── types.ts
│
├── packages/
│   └── core/
│       ├── eventbus/    # KEEP
│       ├── backup-engine/ # KEEP
│       ├── tree-engine/ # KEEP
│       ├── ai-harness/  # KEEP
│       └── harness-adapter/ # KEEP
│
├── apps/
│   └── dashboard/       # KEEP (update API calls to new endpoints)
│
├── tests/               # Expand with SDK tests
│
├── scripts/             # Build/publish scripts (KEEP)
│
└── contracts/           # KEEP (reference for ABI extraction)
```

## 7. Local Database Schema

Keep `agentix/src/core/database.ts` SQLite schema (19 tables, WAL mode, schema v1.1.0).

### Proposed Additions

| Table | Purpose | Fields |
|-------|---------|--------|
| `event_subscriptions` | Track indexed event progress | `contract_name`, `last_indexed_block`, `last_indexed_at` |
| `agent_harnesses` | Detected AI harness info | `name`, `type`, `version`, `path`, `connected`, `last_seen`, `config` |
| `anomalies` | Detected anomalies | `severity`, `type`, `description`, `affected_resource`, `detected_at`, `resolved`, `resolved_at` |
| `action_timeline` | Agent action timeline | `agent_id`, `action`, `status`, `tx_hash`, `event_name`, `created_at`, `metadata` |
| `services` | Runtime service states | `name`, `status`, `pid`, `port`, `started_at`, `last_heartbeat` |

### Database Migrations

Add `schema_version` in `metadata` table. Run migrations on startup.

## 8. API Specification (Hono-based, uses SDK)

```
GET    /health                    → Runtime health status
GET    /stats                     → System statistics

POST   /wallet/create             → { owner } → WalletInfo
GET    /wallet/:address           → WalletInfo
POST   /wallet/:address/execute   → { target, value, data } → TxResult
POST   /wallet/:address/batch     → { targets, values, data } → TxResult
POST   /wallet/:address/deposit   → { amount } → TxResult
POST   /wallet/:address/transfer  → { newOwner } → TxResult

GET    /identity/:id              → IdentityInfo
POST   /identity/:id/link         → { credentialId } → TxResult
POST   /identity/:id/metadata     → { metadataRoot } → TxResult
POST   /identity/:id/deactivate   → TxResult
POST   /identity/:id/reactivate   → TxResult

POST   /session/standard          → CreateStandardSessionParams → TxResult
POST   /session/lightweight       → CreateLightSessionParams → TxResult
POST   /session/:id/revoke        → { wallet } → TxResult
GET    /session/:id               → SessionInfo
GET    /wallet/:address/sessions  → SessionInfo[]

GET    /credential/info           → CredentialRegistryInfo
POST   /credential/issue          → { newRoot } → TxResult
POST   /credential/revoke         → { newRoot } → TxResult
GET    /credential/nullifier/:id  → boolean

GET    /organization/:id          → OrganizationInfo
GET    /organization/:id/anchor   → CredentialAnchorInfo
GET    /organization/owner/:owner → string[]

GET    /events                    → ?contract, ?fromBlock, ?toBlock, ?limit
GET    /events/:txHash            → IndexedEvent[]

GET    /logs                      → ?level, ?limit, ?from
GET    /diagnostics               → FullDiagnosticsReport
GET    /anomalies                 → AnomalyReport

GET    /transactions              → ?wallet, ?status, ?limit
GET    /transactions/:hash        → TransactionDetails

POST   /rpc/status                → RpcStatus

GET    /harnesses                 → DetectedHarness[]
GET    /harnesses/:name/connect   → ConnectResult
GET    /harnesses/:name/health    → HealthCheckResult
```

## 9. MCP Tool Specification

Every tool follows a consistent pattern:
1. **Validate** inputs (Zod schemas)
2. **Simulate** the transaction (estimate gas)
3. **Submit** via SDK
4. **Index** events from receipt
5. **Cache** results in DB
6. **Return** structured response

### Tool List

| Tool | SDK Method | Auto-simulate | Auto-index |
|------|-----------|---------------|------------|
| `agentix_create_wallet` | wallet.create | no | yes |
| `agentix_get_wallet` | wallet.getInfo | no | no |
| `agentix_execute` | wallet.execute | yes | yes |
| `agentix_execute_batch` | wallet.executeBatch | yes | yes |
| `agentix_transfer_ownership` | wallet.changeOwner | yes | yes |
| `agentix_get_identity` | identity.get | no | no |
| `agentix_get_identity_by_wallet` | identity.getByWallet | no | no |
| `agentix_link_credential` | identity.linkCredential | yes | yes |
| `agentix_deactivate_identity` | identity.deactivate | yes | yes |
| `agentix_create_standard_session` | sessions.createStandard | yes | yes |
| `agentix_create_lightweight_session` | sessions.createLightweight | yes | yes |
| `agentix_revoke_session` | sessions.revoke | yes | yes |
| `agentix_get_session` | sessions.getStandard/getLightweight | no | no |
| `agentix_list_wallet_sessions` | sessions.getWalletSessions | no | no |
| `agentix_get_credential_info` | credentials.getInfo | no | no |
| `agentix_issue_credential` | credentials.updateActiveRoot | yes | yes |
| `agentix_revoke_credential` | credentials.updateRevokedSecretRoot | yes | yes |
| `agentix_check_nullifier` | credentials.isNullifierUsed | no | no |
| `agentix_get_organization` | organizations.get | no | no |
| `agentix_get_anchor_info` | organizations.getAnchorInfo | no | no |
| `agentix_get_user_organizations` | organizations.getByOwner | no | no |
| `agentix_verify_capability` | capabilities.verify | no | no |
| `agentix_get_capability` | capabilities.get | no | no |
| `agentix_verify_delegation` | delegations.verify | no | no |
| `agentix_verify_delegation_chain` | delegations.verifyChain | no | no |
| `agentix_get_delegation_root` | delegations.getRoot | no | no |
| `agentix_get_events` | events.getEvents (from DB) | no | no |
| `agentix_get_diagnostics` | runtime.diagnostics | no | no |
| `agentix_get_anomalies` | anomalyDetector.get | no | no |
| `agentix_list_harnesses` | harnessDetector.scan | no | no |
| `agentix_connect_harness` | harnessDetector.connect | no | no |
| `agentix_get_transaction` | txManager.wait | no | no |
| `agentix_get_timeline` | runtime.getTimeline | no | no |
| `agentix_health_check` | runtime.health | no | no |
| `agentix_protocol_doc` | help command | no | no |

## 10. Dashboard Navigation Map

```
┌──────────────────────────────────────────────────────────────────┐
│  [Header: "AgentIX Runtime" | Status: Running | Ports: 3000/3001]│
├──────────────────────────────────────────────────────────────────┤
│ ┌────────┬──────────────────────────────────────────────────────┐ │
│ │        │  [Content Area — no page refresh needed]            │ │
│ │ 📊 OV  │                                                     │ │
│ │ 💰 WA  │  Every UI action → API → SDK → Contract →            │ │
│ │ 🆔 ID  │  Every event → DB update → UI auto-refresh          │ │
│ │ 🔑 SE  │                                                     │ │
│ │ 🏢 OR  │  Sections:                                          │ │
│ │ 📜 CR  │                                                     │ │
│ │ ⚡ CA  │  Overview (stats, recent activity, health)           │ │
│ │ 🔗 DE  │  Wallet (create, info, execute, deposits)           │ │
│ │ 💳 TX  │  Identity (view, link, metadata)                    │ │
│ │ 📋 EV  │  Sessions (standard, lightweight, revoke)           │ │
│ │ 📝 LO  │  Organizations (view, anchor info)                  │ │
│ │ 🩺 DI  │  Credentials (roots, nullifiers)                    │ │
│ │ ⚠️ AN  │  Capabilities (grants, verify)                      │ │
│ │ ⚙️ SE  │  Delegations (roots, verify chain)                  │ │
│ │ 🛠️ DE  │  Transactions (history, details)                    │ │
│ │        │  Events (filtered timeline)                         │ │
│ │        │  Logs (levels, filtering)                           │ │
│ │        │  Diagnostics (full report, health checks)           │ │
│ │        │  Anomalies (severity, resolution)                   │ │
│ │        │  Settings (RPC, contracts, preferences)             │ │
│ │        │  Developer Tools (SDK playground, ABI viewer)       │ │
│ └────────┴──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## 11. Transaction Pipeline (single source of truth)

```
┌─────────────────────────────────────────────────────────┐
│                   Transaction Pipeline                   │
│                                                          │
│  ┌──────────┐                                            │
│  │ Validate │ ← assertAddress, assertNonZero, etc       │
│  └────┬─────┘                                            │
│       v                                                  │
│  ┌──────────────┐                                        │
│  │ Simulate     │ ← staticCall (check for revert)        │
│  └──────┬───────┘                                        │
│         v                                                │
│  ┌───────────────┐                                       │
│  │ Estimate Gas  │ ← estimateGas                         │
│  └───────┬───────┘                                       │
│          v                                               │
│  ┌──────────────────┐                                    │
│  │ Build Calldata    │ ← encodeFunctionData              │
│  └───────┬──────────┘                                    │
│          v                                               │
│  ┌──────────────────────┐                                │
│  │ Request Signing      │ ← describe() → SigningRequest  │
│  └───────┬──────────────┘                                │
│          v                                               │
│  ┌──────────┐                                            │
│  │ Submit   │ ← signer.sendTransaction                   │
│  └────┬─────┘                                            │
│       v                                                  │
│  ┌──────────┐                                            │
│  │ Wait     │ ← tx.wait() — 1 confirmation              │
│  └────┬─────┘                                            │
│       v                                                  │
│  ┌───────────────┐                                       │
│  │ Index Events  │ ← parse receipt logs                 │
│  └───────┬───────┘                                       │
│          v                                               │
│  ┌───────────────┐                                       │
│  │ Update DB     │ ← save events, update pending tx     │
│  └───────┬───────┘                                       │
│          v                                               │
│  ┌───────────────┐                                       │
│  │ Notify        │ ← emit on event bus → dashboard      │
│  └───────┬───────┘                                       │
│          v                                               │
│  ┌──────────────┐                                        │
│  │ Return Result│ ← { hash, receipt, events }           │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
         ··· retry on "already known" (up to 3)
         ··· mapContractError on fail
         ··· reject on unrecoverable errors
```

This pipeline exists ONLY in `TransactionManager`. No other component implements it.

## 12. Event Indexing Design

```
┌─────────────────────────────────────────────┐
│              Event Indexer                   │
│                                              │
│  On startup:                                 │
│    1. Read last indexed block from DB        │
│    2. For each contract:                     │
│       a. queryFilter('*', fromBlock, now)    │
│       b. Parse args via KNOWN_EVENTS        │
│       c. Save to local DB                    │
│       d. Update last indexed block           │
│                                              │
│  On new block (polling or subscription):     │
│    Same as startup but from last block       │
│                                              │
│  Transaction pipeline also indexes:          │
│    When a tx completes, parse receipt logs   │
│    using same KNOWN_EVENTS mapping          │
│    Save to DB, emit on event bus             │
└─────────────────────────────────────────────┘
```

## 13. Anomaly Detection Design

| Anomaly | Detection Method | Severity |
|---------|-----------------|----------|
| Repeated failed txs | Count failures per wallet in time window | HIGH |
| Gas spikes | Compare gas used vs 24h average for wallet | MEDIUM |
| Session nearing expiry | Check sessions where expiry < 1h | LOW |
| Unexpected wallet owner | Compare on-chain owner vs local cache | HIGH |
| Repeated contract reverts | Count reverts by error type in time window | MEDIUM |
| RPC instability | Count timeouts/disconnects per minute | HIGH |
| Credential verification failure | Failed `isNullifierUsed` or root check | MEDIUM |
| Root mismatch | Compare local root vs on-chain root | HIGH |
| High tx frequency | Count txs per wallet in 5min window | MEDIUM |
| Duplicate submissions | Detect identical tx hashes within 1min | LOW |
| Stale organizations | Org not updated in >30 days | LOW |
| Expired sessions | Sessions past expiry not pruned | LOW |
| Wallet desync | Wallet balance differs from local state | MEDIUM |
| Event indexing failure | Last indexed block too far behind head | HIGH |

## 14. Cross-Platform Packaging Plan

```bash
# Single install command
npm install -g agentix

# What gets installed:
#   agentix CLI           → /usr/local/bin/agentix (or %APPDATA%/npm)
#   agentix-mcp CLI       → /usr/local/bin/agentix-mcp
#   agentix runtime       → node_modules/agentix/dist/
#   agentix dashboard     → served from node_modules/agentix/apps/dashboard/

# First run:
agentix
#   → Creates ~/.agentix/ directory structure
#   → Initializes SQLite database
#   → Auto-detects AI harnesses
#   → Launches API server (port 3001)
#   → Launches dashboard (port 3000)
#   → Starts MCP server (stdio)
#   → Begins event indexing
#   → Opens browser to dashboard
```

### Cross-Platform Considerations

| Platform | Path | Notes |
|----------|------|-------|
| Linux/Mac | `~/.agentix/` | Standard XDG home |
| Windows | `%USERPROFILE%\.agentix\` | Standard Windows home |
| Dashboard | Static export (no Node server) | Ships with `next export` output |
| Database | `~/.agentix/db/agentix.db` | SQLite file (cross-platform) |
| Config | `~/.agentix/config/` | JSON files |
| Logs | `~/.agentix/logs/` | Rotated daily |

### Build Strategy

Use esbuild bundle (already exists as `scripts/bundle.ts`) to produce a single-file CLI binary. The dashboard is pre-built as static files and served by the runtime.

## 15. Complete Testing Plan

| Layer | Tool | Coverage |
|-------|------|----------|
| SDK unit tests | Vitest | All orchestrator modules (200+ tests) |
| Database tests | Vitest | CRUD, migrations, edge cases |
| Transaction pipeline | Vitest | send, estimate, simulate, wait, retry, error mapping |
| Event indexing | Vitest | KNOWN_EVENTS parsing, DB persistence, gaps |
| API server tests | Vitest + supertest | All endpoints |
| MCP tool tests | Vitest | All 30+ tools |
| Dashboard tests | Vitest + Playwright | All 13 sections |
| Integration (no chain) | Vitest | SDK ↔ DB ↔ API flow |
| Integration (Base Sepolia) | Hardhat fork | Full protocol end-to-end |
| Cross-platform | GitHub Actions | Windows, macOS, Linux |
| RPC failure tests | Vitest + mock | Timeout, disconnect, revert |
| Offline recovery | Vitest | DB recovery, reconnection |
| Security | Vitest | Proxy guard, error messages, key safety |
| Performance | Vitest + benchmark | Event indexing, DB operations, API latency |

## 16. Implementation Order

```
Phase 1: Foundation (no breaking changes)
  ├── Integrate orchestrator SDK into agentix/src/sdk/
  ├── Keep existing agentix/src/tools/* working (they delegate to SDK)
  └── Merge two SQLite databases into one

Phase 2: Runtime Daemon
  ├── Create src/services/runtime.ts (lifecycle manager)
  ├── Create src/services/event-indexer.ts (automated indexing)
  ├── Create src/services/harness-detector.ts (auto-scan)
  └── Create src/services/anomaly-detector.ts

Phase 3: API Server Rewrite
  ├── Replace raw http with Hono
  ├── Wire all endpoints to SDK
  └── Remove old tool-based contract calls

Phase 4: MCP Server Consolidation
  ├── Merge server.ts + index.ts into one
  ├── All tools use SDK
  └── Read-only default, explicit enable for writes

Phase 5: Dashboard Integration
  ├── Wire all dashboard API calls to new runtime API
  ├── Add loading/empty/error states
  └── Real-time updates via event bus

Phase 6: Tests
  ├── SDK unit tests (from orchestrator)
  ├── Integration tests
  └── E2E on Base Sepolia fork

Phase 7: Packaging & CI
  ├── esbuild bundling
  ├── Cross-platform GitHub Actions
  └── npm publish pipeline
```
