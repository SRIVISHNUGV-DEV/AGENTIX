# Changelog

All notable changes to AgentIX V1.

## [1.0.0] - 2026-06-24

### Added
- **Dashboard Layer** — Next.js 14 + Tailwind + Framer Motion localhost UI at :3000
  - 12 production pages: Overview, Organizations, Credentials, Merkle Trees, Agents, Wallets, Sessions, Agent Actions, Analytics, Backups, Settings, Diagnostics
  - Dark-mode-first design system with semantic color tokens
  - Skeleton loaders, badge components, stat cards, empty states
- **Runtime Layer** — HTTP API server at :3001 for dashboard data
  - RESTful endpoints: /api/health, /api/stats, /api/organizations, /api/credentials, /api/wallets, /api/sessions, /api/proofs, /api/actions, /api/events, /api/backups, /api/contracts, /api/diagnostics
  - CORS enabled for local development
- **AI Harness Layer** — IntentEngine, PolicyEngine, SafetyEngine, ToolRouter
  - Risk classification: LOW, MEDIUM, HIGH, AUTHORITY
  - Action blocking, rate limiting, approval requirements
  - Event emission on all actions
- **Event Bus** — Pub/sub system with wildcard handlers and history
  - 18 event types covering full protocol lifecycle
  - History buffer with configurable max size
- **Authority System** — Organization onboarding with rate limiting
  - EIP-712 signature support
  - Request expiration (24h)
  - Rate limiting (10 requests/minute per address)
  - Pending queue with approve/reject workflow
- **Tree Engine** — Active and revoked Merkle tree management
  - Deterministic ordering with Poseidon hashing
  - Epoch tracking and root history
  - Snapshots, export, import, restore
  - Integrity verification
  - Corruption detection
- **Backup Engine** — Full system backup/restore
  - Checksummed backups with integrity verification
  - Export/import to files
  - All tables backed up atomically
- **Services** — Organization, Credential, Wallet, Session, Proof, Authority
  - Single-responsibility service classes
  - Event-driven architecture
  - Database-backed persistence
- **Shared Packages** — Types, Schemas (Zod), Constants, Utils
  - Full TypeScript type definitions
  - Input validation schemas
  - Risk classification constants
  - Utility functions (ID generation, hashing, formatting)
- **SQLite Schema** — 16 tables with indexes
  - organizations, organization_requests, credentials, wallets, sessions, proofs
  - capabilities, delegations, agent_actions, logs, backups, notifications
  - credential_roots, revocation_roots, metadata, config
- **CLI** — 16 commands with colored output
  - init, doctor, diagnostics, config, org, cred, session, wallet
  - tree, delegation, capability, proof, backup, contracts, rpc, protocol
- **E2E Tests** — EventBus, risk classification, utility functions
- **Proxy Enforcement** — All blockchain interactions validated against implementation addresses

### Architecture
```
User → Dashboard (Next.js :3000) → Runtime API (:3001) → Services → Database + Blockchain
                                         ↓
                                    AI Harness → Intent → Policy → Safety → Tool Router
                                         ↓
                                    Event Bus (pub/sub)
```

### Monorepo Structure
```
agentix/
├── apps/dashboard/          # Next.js frontend
├── packages/
│   ├── shared/              # Types, schemas, constants, utils
│   └── core/                # Eventbus, database, tree-engine, backup-engine, ai-harness
├── src/
│   ├── core/                # Config, provider, proxy-guard, logger
│   ├── tools/               # 15 tool modules
│   ├── trees/               # Merkle tree implementations
│   ├── mcp/                 # MCP server (30 tools)
│   ├── runtime/             # HTTP API server
│   └── index.ts             # CLI entry point
├── tests/                   # E2E tests
└── packages/services/       # Authority, org, cred, wallet, session, proof services
```
