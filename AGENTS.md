# AGENTS.md — Session Context

## Current Focus
AgentIX V1 — 6-stream integrity hardening pass. Streams 1-5 DONE + verified. All work is WORKING-TREE ONLY (not committed) pending review.

## Session 2026-07-14 — 6-Stream Integrity Hardening (Contract calls, ZK, Merkle, SQLite, Dashboard)

Resumed a 6-stream hardening pass. Stream 1 done prior session; completed Streams 2-5 + final verification this session. NOTHING COMMITTED YET — user wants to review first.

### Verification snapshot (all green at session end)
- Runtime `bun x tsc --project tsconfig.json` → exit 0
- `bun run test` (e2e) → 31/31 pass
- `bun x vitest run` circuit-compat + 07-merkle + 06-sqlite + 12-credentials → 37/37 pass
- Dashboard (`apps/dashboard`): `bun x tsc --noEmit` exit 0, `bun run build` succeeds (163kB first load; benign npm-workspaces lockfile-patch warning during bun build is harmless)

### Files changed this session (git working tree, uncommitted)
- NEW `agentix/src/core/zk-prover.ts`
- NEW `agentix/tests/circuit-compat.test.ts`
- NEW `circuits/artifacts.manifest.json`
- MOD `agentix/scripts/bundle.ts`, `src/core/database.ts`, `src/runtime/server.ts`,
  `src/tools/credential.ts`, `src/tools/proof.ts`, `src/trees/active-tree.ts`, `src/utils/merkle.ts`
- MOD `agentix/packages/indexer/storage/state-reconstructor.ts` (only if it was touched — verify with git status)

### STREAM 2 — ZK portability + CRITICAL Poseidon bug (root cause of "no proof ever verified")
- **Critical fix:** every Poseidon call used the SPREAD form `poseidon(...inputs)`, but circomlibjs expects a single ARRAY arg — the 2nd positional param is `initState`, not the second element. Canonical iden3 vector: `Poseidon([1,2]) = 7853200120776062878684798364095072458815029376092732009249414926327459813530`. Spread form silently produced wrong hashes, so ALL commitments/nullifiers/revocation-keys/Merkle nodes diverged from the circuit → no Groth16 proof could ever verify.
- Fixed 6 call sites: `zk-prover.ts` (×3: commitment Poseidon7, nullifier Poseidon3, revocationKey Poseidon2 mod 2^64), `merkle.ts` hashPair, `credential.ts`.
- After fix: real proof generates + verifies locally (`local verify: true`, 7 public signals). Credentials table was empty → NO data migration needed.
- Portability hardening: `circuits/artifacts.manifest.json` (sha256 + byte length per artifact), hash-verified `verifyIntegrity()` preflight in zk-prover that refuses corrupted artifacts (verified a 1-byte tamper is caught), `AGENTIX_CIRCUITS_DIR` env override + multi-location resolution, `bundle.ts` ships circuits for standalone `npx agentix`.
- Regression: circuit-compat.test.ts now pins canonical Poseidon([a,b]) vector + hashPair (the OLD test itself used the buggy spread form).

### STREAM 3 — Merkle durability
- Fixed `revokeCredential` (`src/tools/credential.ts`): was adding the COMMITMENT to the revoked SMT, but circuit + reload path (`revoked-tree.ts` loadFromDb) key by `revocationKey = Poseidon2(secret,0) mod 2^64`. Live revoke diverged from reloaded tree. Now computes real revocationKey via `computeRevocationKey`.
- Added root-drift detection in `ActiveTree.loadFromDb` (`src/trees/active-tree.ts`): logs ERROR if rebuilt root != last anchored root in credential_roots instead of silently overwriting. Rebuilt root stays authoritative for proving; mismatch signals need to re-anchor on-chain.
- Added Stream 3 regression test in circuit-compat.test.ts (revocationKey determinism + rebuild-from-keys root stability).

### STREAM 4 — SQLite write-path audit
- Audited every INSERT/UPDATE vs schema (accounting for ALTER TABLE ADD COLUMN migrations in database.ts).
- **Bug found + fixed:** `identities` table was written by indexer `IdentityRegistered` reconstructor (`packages/indexer/storage/state-reconstructor.ts`) but NEVER created in schema → reconstruction throws. Added `CREATE TABLE identities (identity_id PK, wallet_address, credential_id, active, created_at)` + `idx_identities_wallet` to SCHEMA in `src/core/database.ts`. Smoke-tested insert works.
- All other production write paths verified column-aligned (owner_policies 13 cols OK, all reconstructor col/value counts aligned). Remaining audit "hits" were test-local temp tables (test_organizations, chaos_concurrent, perf_test) — not real.

### STREAM 5 — Dashboard data layer
- No fix needed — already sound. Shared `apps/dashboard/src/lib/api.ts` (fetchJSON/postJSON/etc) + `useApi` hook (loading/error). Sections use local useState fetch (stylistic, not a bug) with uniformly defensive extraction (`data.value || data || []`, camelCase+snake_case fallbacks, Promise.allSettled for multi-fetch).
- Verified ALL 40 client endpoints map to real server routes in `src/runtime/server.ts`. No shape drift. Typecheck + prod build pass.

### NEXT STEPS (tomorrow)
- User to review working-tree changes, then decide commit. (Suggested: stage the 10 files above with a hardening summary message.)
- Consider committing in logical chunks: (a) ZK Poseidon fix + portability, (b) Merkle revoke fix + drift detection, (c) identities table.
- Streams 1-5 complete; no Stream 6 (final verify was the 6th todo, done).

## Session 2026-07-01 — Fresh Deployment, Identity System, Agents Page Consolidation

### Fresh Contract Deployment on Base Sepolia
- Deployed all 11 contracts via `deploy-production.ts` with fresh proxy addresses
- Timelocks removed (TIMELOCK_DELAY = 0) for development — wiring completed immediately
- Configs updated: agentix runtime, orchestrator SDK, SDK copy all have fresh addresses

| Contract | Proxy Address |
|----------|--------------|
| Groth16Verifier | `0x3056bB17323228d1829D2f6A2a96Af8e079095c2` |
| CredentialRegistry | `0xF1C30a96aa97faB2A29B2E8Cdc05fc321AA7511E` |
| SessionManager | `0x9b7B7d631098f046eaFb4637DC859eBA51e238C0` |
| AgentWalletFactory | `0x6A4C643f59952CfBfEcEdaf182B3C98D778df2c1` |
| AgentWallet (impl) | `0x6C826A49aD8447FD94d61f515013ea93066e94C5` |
| CapabilityRegistry | `0x90D4d0D35709D4e29765F5132DaD0E85Fc07aD6A` |
| DelegationManager | `0x6Ee3cdeB9c1a1aE83CF0bb0E469B98736Cb07CB5` |
| OrganizationRegistry | `0xdF3e6819fC65966d0D43A3768Aaa40fd50B59443` |
| OrgCredentialAnchor | `0x491aD666EFb0E79Ce8406a10914033eEdB6165b6` |
| AgentIdentity | `0xaF20A4CF58CF8E3DF6bF2545Ed9371d39E97cD71` |

### Identity API Endpoint Added
- Added `GET /api/identity/:wallet` to API server
- Reads from AgentIdentity contract (identityOf, walletOf, isActive, metadataOf, timestampsOf)
- ProxyGuard updated to support AgentIdentity lookups
- Config extended with `contracts.agentIdentity` field

### Combined Agents Page
- Merged harness detection, wallets, identity, credentials, sessions into one page
- Tabbed layout: AI Harnesses → Wallet → Identity → Credentials → Sessions
- Harness logos from frontend/provider-logos copied to dashboard public/
- Create wallet, issue credential, lightweight session dialogs in-page
- Wallet selector for identity lookup
- Secret key banner on credential issuance
- Old Identities and Credentials pages removed from sidebar nav

### MCP Server Rebuild (63 tools)
Complete rewrite with 63 tools across 14 categories:
- System (6), Config (3), Wallet (10), Identity (2), Session (5), Organization (5), Credential (5), Capability (3), Delegation (5), Trees (1), Proofs (2), Backups (3), Events (1), Logs & Anomalies (3), Harnesses (5), Transactions (2), Bundler (1), Onboarding (2), Fund (1), Service Launcher (1)
- New tools: identity lookup, wallet ownership transfer, batch execution, session pruning, credential verification, delegation chain verification, harness persistence, transaction querying, bundler submission

### Fresh Contract Deployment on Base Sepolia
- Deployed all 11 contracts via `deploy-production.ts` with TIMELOCK_DELAY = 0
- Old `~/.agentix/config/agentix.config.json` had stale addresses causing `NotAgentWallet()` revert on session creation — fixed by updating config with new proxy addresses

## AgentIX V1 Install Wizard & Harness Connector (2026-06-24)
Built the complete production-grade onboarding experience and universal agent harness connector.

### What Was Built (Install Wizard)
- **9-Step Onboarding Wizard** — Premium UI at localhost:3000/onboarding
  - Welcome, System Check, AI Harnesses, Connect Wallet, Initialize Runtime, Configure, Database, Start Services, Ready
  - Framer Motion animations with step transitions and progress indicators
  - Dark-mode-first glassmorphism design with gradient mesh backgrounds
  - Auto-detection of installed AI harnesses with connection status
- **Universal Harness Connector** — Extensible adapter architecture
  - `HarnessManager` — Central orchestrator for all harness operations
  - `BaseHarnessAdapter` — Abstract base class with detect/connect/disconnect/health/sync/repair
  - 5 Built-in adapters: Claude Code, MimoCode, OpenCode, GitHub Copilot, Hermes
  - Each adapter scans platform-specific config paths and MCP configurations
  - Auto-installs AgentIX MCP server entry into detected harness configs
- **AgentIX Fund Tool** — Fiat on-ramp comparison engine
  - Compares MoonPay, Coinbase, Transak, Ramp pricing and fees
  - Filters by network, amount, currency, and country
  - Returns sorted options with official links only
  - Never executes purchases — recommendations only
- **Enhanced Diagnostics Engine** — 12-point system check
  - Node.js, NPM, SQLite, Runtime, Database, Storage, Network, Contracts, Dashboard, MCP, Backups, Harnesses
  - Each check produces OK/WARNING/ERROR with repair suggestions
- **Full Runtime Initialization** — Automated setup engine
  - Creates directories, initializes database, configures network
  - Detects and connects to AI harnesses automatically
  - Runs health verification on completion
- **Onboarding API Endpoints** — 8 new REST endpoints
  - `/api/onboarding/status`, `/api/onboarding/diagnostics`, `/api/onboarding/harnesses`
  - `/api/onboarding/harnesses/connect`, `/api/onboarding/harnesses/health`, `/api/onboarding/harnesses/repair`
  - `/api/onboarding/init`, `/api/onboarding/fund`
- **Enhanced MCP Tools** — 5 new MCP tools
  - `agentix_fund`, `agentix_onboarding_status`, `agentix_onboarding_harnesses`
  - `agentix_onboarding_connect`, `agentix_onboarding_repair`
- **Enhanced CLI Commands** — 3 new commands
  - `agentix wizard` — Launch onboarding wizard in browser
  - `agentix fund` — Get fiat on-ramp options
  - `agentix doctor` — Enhanced with full diagnostics and repair suggestions
- **Premium CSS Design System** — Glassmorphism, gradient mesh, shimmer animations
- **27 E2E Tests** — All passing (was 15)

### Directory Structure (New Files)
```
agentix/
├── packages/core/harness-adapter/
│   ├── types.ts           # All type definitions
│   ├── base.ts            # BaseHarnessAdapter abstract class
│   ├── index.ts           # HarnessManager orchestrator
│   └── adapters/
│       ├── claude-code.ts
│       ├── mimocode.ts
│       ├── opencode.ts
│       ├── github-copilot.ts
│       └── hermes.ts
├── src/tools/
│   ├── fund.ts            # Fiat on-ramp comparison
│   └── wizard.ts          # Diagnostics + full init engine
├── apps/dashboard/src/
│   ├── pages/onboarding.tsx   # 9-step wizard UI
│   ├── app/onboarding/page.tsx # Route
│   └── app/globals.css        # Premium design system
```

### New CLI Commands
```bash
agentix wizard                    # Launch onboarding wizard
agentix fund --network baseSepolia --amount 10  # Buy ETH options
agentix doctor                    # Enhanced diagnostics with repair hints
```

### New MCP Tools (Total: 35)
```
agentix_fund                      # Fiat on-ramp options
agentix_onboarding_status         # Check onboarding status
agentix_onboarding_harnesses      # Scan for AI harnesses
agentix_onboarding_connect        # Connect to all harnesses
agentix_onboarding_repair         # Repair connections
```

### New API Endpoints
```
GET  /api/onboarding/status
GET  /api/onboarding/diagnostics
GET  /api/onboarding/harnesses
POST /api/onboarding/harnesses/connect
DELETE /api/onboarding/harnesses/connect
GET  /api/onboarding/harnesses/health
POST /api/onboarding/harnesses/repair
POST /api/onboarding/init
POST /api/onboarding/fund
```

### Harness Adapter Architecture
```
HarnessAdapter (interface)
  ├── detect() → DetectResult
  ├── install() → ConnectResult
  ├── connect() → ConnectResult
  ├── disconnect() → {success, message}
  ├── healthCheck() → HealthCheckResult
  ├── sync() → SyncResult
  └── repair() → RepairResult

BaseHarnessAdapter (abstract class)
  ├── ClaudeCodeAdapter
  ├── MimoCodeAdapter
  ├── OpenCodeAdapter
  ├── GitHubCopilotAdapter
  └── HermesAdapter

HarnessManager
  ├── scanAll() → ScanResult
  ├── connectAll() → ConnectAllResult
  ├── healthCheckAll() → HealthAllResult
  ├── repairAll() → RepairResult[]
  ├── syncAll() → SyncResult[]
  └── registerAdapter() → void
```

## AgentIX V1 Production Build (2026-06-24)
Built the complete production-grade local runtime platform for AI agent credentials.

### What Was Built (V1 Production)
- **Dashboard Layer** — Next.js 14 + Tailwind + Framer Motion at localhost:3000
  - 12 production pages: Overview, Organizations, Credentials, Merkle Trees, Agents, Wallets, Sessions, Agent Actions, Analytics, Backups, Settings, Diagnostics
  - Dark-mode-first design system with semantic color tokens
  - Skeleton loaders, badge components, stat cards, empty states
- **Runtime Layer** — HTTP API server at localhost:3001
  - RESTful endpoints for all data access
  - CORS enabled for local development
- **AI Harness Layer** — IntentEngine, PolicyEngine, SafetyEngine, ToolRouter
  - Risk classification: LOW, MEDIUM, HIGH, AUTHORITY
  - Action blocking, rate limiting, approval requirements
- **Event Bus** — Pub/sub system with wildcard handlers and history (18 event types)
- **Authority System** — Organization onboarding with rate limiting, EIP-712, approval workflow
- **Tree Engine** — Active and revoked Merkle tree management with snapshots, integrity verification
- **Backup Engine** — Full system backup/restore with checksummed integrity
- **6 Services** — Organization, Credential, Wallet, Session, Proof, Authority
- **Shared Packages** — Types, Schemas (Zod), Constants, Utils
- **SQLite Schema** — 16 tables with indexes (was 15, added organization_requests)
- **CLI** — 16 commands (unchanged, fully compatible)
- **MCP Server** — 12 tools exposed via Model Context Protocol
- **E2E Tests** — 15 passing tests (EventBus, risk classification, utilities)
- **Proxy Enforcement** — All blockchain interactions validated
- **Documentation** — CHANGELOG, DEPLOYMENT, MIGRATION, RECOVERY, ARCHITECTURE, SEQUENCE diagrams

### Directory Structure
```
agentix/
├── apps/
│   └── dashboard/              # Next.js 14 + Tailwind + Framer Motion
│       └── src/
│           ├── app/            # Next.js app router (layout, page)
│           ├── components/     # Sidebar, UI components
│           └── pages/          # 12 page components
├── packages/
│   ├── shared/
│   │   ├── types/              # Full TypeScript type definitions
│   │   ├── schemas/            # Zod validation schemas
│   │   ├── constants/          # Risk levels, tree depth, network config
│   │   └── utils/              # ID generation, hashing, formatting
│   └── core/
│       ├── eventbus/           # Pub/sub with history
│       ├── database/           # SQLite with 16 tables
│       ├── tree-engine/        # Merkle tree management
│       ├── backup-engine/      # Backup/restore with checksums
│       └── ai-harness/         # Intent, Policy, Safety, Router
├── packages/services/
│   ├── authority-service/      # Org onboarding with rate limiting
│   ├── organization-service/   # Organization CRUD
│   ├── credential-service/     # Credential lifecycle
│   ├── wallet-service/         # Wallet management
│   ├── session-service/        # Session lifecycle
│   └── proof-service/          # Proof generation/verification
├── src/
│   ├── core/                   # Config, provider, proxy-guard, logger
│   ├── tools/                  # 15 tool modules
│   ├── trees/                  # Merkle tree implementations
│   ├── mcp/                    # MCP server (server.ts)
│   ├── runtime/                # HTTP API server
│   └── index.ts                # CLI with 16 commands
├── tests/
│   └── e2e.test.ts             # 15 passing tests
├── CHANGELOG.md
├── DEPLOYMENT.md
├── MIGRATION.md
├── RECOVERY.md
├── ARCHITECTURE.md
└── SEQUENCE.md
```
    │   ├── config-tool.ts         # Get/set/show/reset config
    │   ├── health.ts              # 8-point health check system
    │   ├── rpc-tool.ts            # RPC connectivity testing
    │   ├── diagnostics.ts         # Full system diagnostics
    │   ├── deployment.ts          # Init and deployment status
    │   ├── help.ts                # Protocol documentation for AI agents
    │   └── index.ts               # Tool registry exports
    └── utils/
        └── merkle.ts              # Poseidon hash, tree building, proofs
```

### CLI Commands
```
agentix init                          # Initialize local runtime
agentix doctor                        # Health checks (8 points)
agentix diagnostics                   # Full system diagnostics
agentix config [get|set|show|reset]   # Configuration management
agentix org [create|get|list|...]     # Organization management
agentix cred [issue|revoke|get|list]  # Credential management
agentix session [create|validate|...] # Session management
agentix wallet [create|get|execute|...]# Wallet management
agentix tree [status|rebuild|export|...]# Merkle tree management
agentix delegation [create|revoke|...]# Delegation management
agentix capability [register|...]     # Capability management
agentix proof [generate|verify|list]  # Proof generation/verification
agentix backup [create|list|restore|...]# Backup management
agentix contracts                     # List all proxy addresses
agentix rpc                           # Test RPC connectivity
agentix protocol [topic]             # Protocol documentation for AI agents
```

### MCP Server (30 tools)
```bash
# Start MCP server (stdio mode for IDE integration)
node dist/src/mcp/index.js

# Auto-install into all detected IDEs
node dist/src/mcp/index.js add

# Install for specific IDE
node dist/src/mcp/index.js add claude-code
node dist/src/mcp/index.js add cursor
node dist/src/mcp/index.js add project   # .mcp.json only

# Check installation status
node dist/src/mcp/index.js status

# Remove from all IDEs
node dist/src/mcp/index.js remove
```

**MCP Tools:**
- `agentix_org_create`, `agentix_org_get`, `agentix_org_list`
- `agentix_cred_issue`, `agentix_cred_revoke`, `agentix_cred_list`
- `agentix_session_create`, `agentix_session_validate`, `agentix_session_revoke`
- `agentix_wallet_create`, `agentix_wallet_info`, `agentix_wallet_whitelist`, `agentix_wallet_execute`, `agentix_wallet_deposit_gas`
- `agentix_tree_status`, `agentix_tree_rebuild`, `agentix_tree_export`
- `agentix_proof_generate`, `agentix_proof_verify`
- `agentix_delegation_create`, `agentix_delegation_list`
- `agentix_capability_register`, `agentix_capability_list`
- `agentix_backup_create`, `agentix_backup_list`
- `agentix_health`, `agentix_diagnostics`, `agentix_contracts`, `agentix_rpc_test`, `agentix_protocol_doc`

### SQLite Schema (15 tables)
- config, organizations, credential_roots, revocation_roots
- credentials, wallets, sessions, proofs
- capabilities, delegations, logs, backups
- metadata, merkle_snapshots

### Local Storage (~/.agentix/)
```
config/     contracts/   organizations/  trees/
credentials/ sessions/   wallets/        proofs/
capabilities/ delegations/ logs/         db/
tools/      cache/       backups/
```

### Proxy Enforcement
Every tool validates addresses via ProxyGuard:
1. Checks if address is an implementation contract
2. Blocks interaction with implementation addresses
3. Warns if address is not the expected proxy
4. Returns only proxy addresses

### Usage
```bash
cd agentix
npm install
npm run build
node dist/src/index.js init
node dist/src/index.js doctor
```

## Previous Changes (2026-06-23)
- **OZ version frozen** — Pinned `@openzeppelin/contracts` and `@openzeppelin/contracts-upgradeable` to exact `5.3.0` (was `^4.9.6` in package.json but running 5.3.0)
- **Stale artifacts cleared** — Removed old `artifacts/` and `cache/`, full recompile from scratch
- **47 Solidity files compiled** — 148 typechain types generated (solc 0.8.24, viaIR, optimizer 200 runs, EVM target paris)
- **ABIs regenerated** — 9 production contracts + 6 interfaces extracted to `contracts/abis/`
- **ABI manifest** — `abis/MANIFEST.json` with full build metadata (OZ version, solc, optimizer settings)
- **ABI extraction script** — `scripts/extract-abis.js` for reproducible ABI generation

### ABI File Inventory (`contracts/abis/`)
| File | Entries | Description |
|------|---------|-------------|
| `AgentWallet.json` | 71 | Smart wallet (ERC-4337) |
| `AgentWalletFactory.json` | 59 | Wallet factory (UUPS) |
| `CapabilityRegistry.json` | 52 | On-chain capability registry (UUPS) |
| `CredentialRegistry.json` | 45 | Merkle-based credential registry (UUPS) |
| `DelegationManager.json` | 65 | Scope-based delegation (AccessControl, UUPS) |
| `Groth16Verifier.json` | 1 | ZK proof verifier (standalone) |
| `OrganizationCredentialAnchor.json` | 47 | Org credential anchor (impl only) |
| `OrganizationRegistry.json` | 59 | Organization registry (UUPS) |
| `SessionManager.json` | 89 | Session lifecycle manager (UUPS) |
| `IAgentWallet.json` | 2 | Wallet interface |
| `IAgentWalletFactory.json` | 1 | Factory interface |
| `ICredentialRegistry.json` | 4 | Registry interface |
| `ISessionManager.json` | 3 | Session manager interface |
| `IVerifier.json` | 1 | Verifier interface |
| `IEntryPoint.json` | 3 | ERC-4337 entry point interface |

### Build Metadata
```
Solidity: 0.8.24 (viaIR, optimizer 200 runs)
EVM Target: paris
OpenZeppelin: 5.3.0 (contracts + contracts-upgradeable)
Hardhat: 2.22.19
TypeChain: ethers-v6 (148 types)
```

### Regenerate ABIs
```bash
cd contracts
npx hardhat compile --force
node scripts/extract-abis.js
```

## Previous Changes (2026-06-22)
- **Security hardening** — Fixed all remaining findings from security audit:
  - F-006: Added uint128 overflow check in SessionManager.validateSession
  - F-007: Fixed wrong error message in DelegationManager scope limit (ScopeLimitExceeded)
  - F-009: WalletCreated event only emitted on new wallet creation (not idempotent re-call)
  - S-001: Added MAX_SESSIONS_PER_WALLET (100) cap to prevent unbounded walletSessions array
- **Contracts redeployed** to Base Sepolia with all fixes applied
- **V1Certification.test.ts** — Fixed 13 pre-existing test bugs (lightweight session encoding, prune funding, array lengths, error names)
- **test-onchain.ts** — Updated for new contract interfaces (DelegationManager uses AccessControl)
- **deploy-v3.ts** — Restructured deployment order to work around OZ v5 ERC1967Proxy issue with empty init data

## Security Findings Status
| Finding | Status |
|---------|--------|
| F-001 (CRITICAL — wallet not in lightweight sig) | FIXED (msg.sender in signature) |
| F-002 (CRITICAL — no wallet binding in ZK proof) | FIXED (wallet in publicSignals[5]) |
| F-003 (HIGH — pruneExpiredSessions no ACL) | FIXED (onlyWallet modifier) |
| F-004 (HIGH — setWalletFactory no zero-addr check) | FIXED |
| F-005 (HIGH — CapabilityRegistry admin revocation) | N/A (owner-only registration makes this moot) |
| F-006 (MEDIUM — uint128 overflow in valueUsed) | FIXED |
| F-007 (MEDIUM — wrong error for scope limit) | FIXED |
| F-008 (MEDIUM — AgentWallet receive() from anyone) | By design — standard smart contract wallet behavior |
| F-009 (MEDIUM — WalletCreated event on idempotent) | FIXED |
| F-010 (LOW — markNullifierUsed no ReentrancyGuard) | Mitigated (SessionManager nonReentrant protects) |
| S-001 (MEDIUM — unbounded walletSessions array) | FIXED (MAX_SESSIONS_PER_WALLET = 100) |

## Base Sepolia Deployments (2026-06-23)

All contracts deployed and **40/40 on-chain tests passing**.

| Contract | Proxy | Implementation |
|----------|-------|----------------|
| Groth16Verifier | `0x1Baae590586170A8779b31186757DaDbcaE94f57` | (same — non-upgradeable) |
| CredentialRegistry | `0xaC0A72FaAF2596DD55A20049F0ab7584b58b3DEE` | `0x3c3C568D47363aC38545197A3e779c41dF32C322` |
| SessionManager | `0x27532B3B2d0704715D5e81BDa8B0D272675751d1` | `0xF91fe9c6E6Ac7D5D1b8bd78078B36D18ee0904cA` |
| AgentWallet (impl) | — | `0x0069aaBe2BCCE3Ef22D7104684f5d091b49f7A30` |
| AgentWalletFactory | `0x9e6B32F7da3ef2C2dD1337757FbC25Eb72FdFfE3` | `0x1bbAd274954B8e73cBCF0d007067C8333bbFDB34` |
| CapabilityRegistry | `0xa9ff494D1047bC9399858394B95aCf7066740aFC` | `0x275e536DD14F12E114929Abdd24FacdCC4fB450e` |
| DelegationManager | `0x73f8591ccCdBfE1595aA4d2160e8F166E0243E38` | `0x155A302DE9ec5f7a834e62120ac91e11Bd105F7d` |

**Deployer:** `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`
**EntryPoint:** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (Base Sepolia 4337)

**Test accounts:**
- Account 0 (Deployer): `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`
- Account 1 (Oracle): `0x0b5d818a2E17CD5d2c1c626778B7364b87c94E05`
- Account 2 (Client): `0xF9604702010B90d7Bac46f9854b338d036758f4A`
- Account 3 (Worker): `0x47b71B49552B16a58e2c4B796bF3bDB25eD9F2C4`
- Account 4 (Other): `0xBF0A116921abA3DA0D3296b9a4843e999D1F1243`

## Previous Runtime Integrity Fixes (F-001 to F-046)
All 30+ backend/frontend runtime fixes remain applied. See runtime_integrity_report.md for full list.

## Etherscan Verification Status (2026-06-23)
All 8 implementation contracts verified on Basescan:
- ✅ Groth16Verifier — https://sepolia.basescan.org/address/0x1Baae590586170A8779b31186757DaDbcaE94f57#code
- ✅ CredentialRegistry impl — https://sepolia.basescan.org/address/0x3c3C568D47363aC38545197A3e779c41dF32C322#code
- ✅ OrganizationCredentialAnchor impl — https://sepolia.basescan.org/address/0x5B1D468e156E2af955Fa0985e10A573ecd8c9f47#code
- ✅ OrganizationRegistry impl — https://sepolia.basescan.org/address/0x8e1747e9D98ED4d9F02b335fB4042782e8147685#code
- ✅ AgentWallet impl — https://sepolia.basescan.org/address/0x0069aaBe2BCCE3Ef22D7104684f5d091b49f7A30#code
- ✅ SessionManager impl — https://sepolia.basescan.org/address/0xF91fe9c6E6Ac7D5D1b8bd78078B36D18ee0904cA#code
- ✅ AgentWalletFactory impl — https://sepolia.basescan.org/address/0x1bbAd274954B8e73cBCF0d007067C8333bbFDB34#code
- ✅ CapabilityRegistry impl — https://sepolia.basescan.org/address/0x275e536DD14F12E114929Abdd24FacdCC4fB450e#code
- ✅ DelegationManager impl — https://sepolia.basescan.org/address/0x155A302DE9ec5f7a834e62120ac91e11Bd105F7d#code

All 6 ERC1967 proxy contracts verified on Basescan:
- ✅ CredentialRegistry proxy — https://sepolia.basescan.org/address/0xaC0A72FaAF2596DD55A20049F0ab7584b58b3DEE#code
- ✅ OrganizationRegistry proxy — https://sepolia.basescan.org/address/0x6eeeEcB5c79eE664ab0019CC427F8Bf23a7fc8Fe#code
- ✅ SessionManager proxy — https://sepolia.basescan.org/address/0x27532B3B2d0704715D5e81BDa8B0D272675751d1#code
- ✅ AgentWalletFactory proxy — https://sepolia.basescan.org/address/0x9e6B32F7da3ef2C2dD1337757FbC25Eb72FdFfE3#code
- ✅ CapabilityRegistry proxy — https://sepolia.basescan.org/address/0xa9ff494D1047bC9399858394B95aCf7066740aFC#code
- ✅ DelegationManager proxy — https://sepolia.basescan.org/address/0x73f8591ccCdBfE1595aA4d2160e8F166E0243E38#code

## Known Issues
- `claude_desktop_config.json` path assumes Windows (`APPDATA/Claude/`)
- Env files ARE in `.gitignore` — fixed via `filter-branch`
- OZ v5 ERC1967Proxy reverts on Base Sepolia with empty init data — use `deploy-v3.ts` (restructured order)
- Frontend cookie inconsistencies (F-010 Secure flag on logout, F-017 SameSite on org cookies) — cosmetic, not security
- 24 failing unit tests in V1Certification.test.ts — pre-existing interface mismatches (`updateGrantRoot` signature, `setWalletFactory` removed from SessionManager), not caused by recompilation

## Session 2026-06-30 — Dashboard Rebuild, SDK Integration, Credential System Fixes

### ABI Regeneration
- Recompiled all 50 Solidity files (solc 0.8.24, viaIR, optimizer 200, evm paris)
- Extracted fresh ABIs: 10 contracts + 7 interfaces (17 files)
- Notable ABI changes: `SessionManager` 89→96 entries, `AgentIdentity` new (62 entries), `AgentWallet` 71→65

### Orchestrator SDK → agentix Integration
- **Created `agentix/src/sdk/`** — copied all 18 orchestrator source files with ESM→CommonJS import fixes
- Modules: `AgentIX.ts`, `contracts.ts`, `transaction.ts`, `events.ts`, `types.ts`, `errors.ts` (70+ error classes), `utils.ts`, `config.ts`, `database.ts` (JSON DB), `wallet.ts`, `identity.ts`, `session.ts`, `credential.ts`, `capability.ts`, `delegation.ts`, `organization.ts`, `onlyOwner/index.ts`
- SDK barrel export at `agentix/src/sdk/index.ts`
- **Database consolidation**: `packages/core/database/index.ts` now re-exports from `src/core/database.ts` (SQLite — single source of truth)

### Architecture Audit
- Produced `ARCHITECTURE-AUDIT.md` — 14 sections comparing agentix/ vs orchestrator/
- Produced `DASHBOARD-AUDIT.md` — Complete UX/routing/API audit with request flow verification

### Dashboard Rebuild (Complete)
- **Design System**: 17 components (Button, Card, Table, Badge, Dialog, Toast, Alert, Timeline, Progress, StatCard, Skeleton, EmptyState, Input, Select, CodeBlock, StatusDot, Spinner)
- **Themes**: Light + Dark with CSS variables, persisted via localStorage, toggle in sidebar
- **Typography**: Satoshi font (variable weight), proper hierarchy
- **Layout**: Sidebar (17 nav items, grouped sections), TopBar with search, Command Palette (Ctrl+K), Breadcrumbs
- **17 Pages total**: Overview, Wallets, Identities, Organizations, Credentials, Sessions, Capabilities, Delegations, Transactions, Events, Actions, Analytics, Diagnostics, Anomalies, Backups, Developer, Settings
- **6 new pages**: Identities, Capabilities, Delegations, Transactions, Events, Anomalies, Developer
- **Build**: 150kB first load, clean compilation

### Bug Fixes
- **Wallet creation**: Fixed property name mismatch (`to` vs `factoryAddress`, `data` vs `calldata`) in `tx-sender.ts`
- **Sessions page**: Added Create Session dialog with wallet selector, daily limits, expiry; added Revoke button
- **ETH price**: Added Binance (`api.binance.com/api/v3/ticker/price?symbol=ETHUSDT`) as fallback price source
- **Credentials page oracle**: Auto-polls every 30s, never shows "$0", shows "Fetching..." state
- **Ethers version compatibility**: Replaced dynamic ethers `id()` calls with hardcoded topic hash in tx-sender

### Merkle Tree Fixes
- Changed depth from 10→**20** across 4 files (constants, `merkle.ts`, `active-tree.ts`, `revoked-tree.ts`) to match `credential_V1.circom` circuit
- Leaf indexing: `key % 2^20` = 1,048,576 slots (was 1,024)
- Circuit compatibility verified: Merkle proofs from depth-20 tree now verify against Groth16 circuit

### Credential Issuance — Org-Only
- `src/tools/credential.ts`: `issueCredential()` rejects standalone requests (`orgId = "0"` or missing) with clear error
- Removed "standalone" tree prefix — only org IDs used for tree keys
- Dashboard credentials form: removed Standalone mode toggle, requires org selection
- Architecture: Org → credentials for ZK proofs. Standalone → lightweight sessions directly.

### Harness Identity System
- Added `logo` field to `HarnessInfo` type with logo URLs for all 5 adapters
- Added `walletAddress` and `identityId` fields for future identity mapping
- Added `detectVersion()` to base adapter (runs `--version` CLI), with `getVersionCommand()` per adapter
- Added `HARNESS_LOGOS` constant map with favicon URLs
- API server: `/api/onboarding/harnesses` now persists scan results to `harnesses` DB table via `INSERT OR REPLACE`
- Dashboard Agents page: shows detected harnesses as cards with logo, status dot, connection status

### Error System
- Added 38 missing custom error classes to match all 114 Solidity errors from 9 contracts
- Fixed `NullifierUsed` mapping bug (CredentialRegistry uses `NullifierUsed`, SessionManager uses `NullifierAlreadyUsed` — both now mapped)
- Updated `events.ts` `KNOWN_EVENTS` with 17 missing business events + correct parameter names

### Audit Documents Created
- `ARCHITECTURE-AUDIT.md` — Full architecture comparison, duplication map, migration plan
- `DASHBOARD-AUDIT.md` — UX audit, request flow verification, component inventory, implementation plan

### Running State
- API Server: `localhost:3001` (agentix/src/runtime/server.ts) — running
- Dashboard: `localhost:3000` (Next.js 14) — running

### Next Steps
- Run `npm run setup` to walk through the wizard
- Rotate compromised `PRIVATE_KEY` and API keys
- Run `git gc --prune=now` to fully remove dangling objects with secrets


When the user allows you to view the secret and make transactions on their behalf, you can go ahead and do that no problem 
