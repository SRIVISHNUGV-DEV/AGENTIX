# AgentIX Dashboard — Complete Audit

## 1. Existing Dashboard Audit

### Current Tech Stack
| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (Pages Router) | 14.x |
| Styling | Tailwind CSS | 3.x |
| Animation | Framer Motion | 11.x |
| Icons | Lucide React | 0.x |
| Wallet | Web3Modal (ethers v5) | 3.x |
| State | React Query (TanStack) | 5.x |
| API | Fetch (custom wrapper) | — |
| Font | Monospace (SF Mono, Fira Code) | — |
| Theme | Dark-only | — |

### Page Inventory

| # | Page | File | Lines | API Calls | Status |
|---|---|---|---|---|---|
| 1 | Overview | `overview.tsx` | 91 | `/api/stats`, `/api/events?limit=10` | ✅ Working |
| 2 | Organizations | `organizations.tsx` | 227 | `/api/organizations`, `/api/organizations/requests`, POST/PUT | ✅ Working |
| 3 | Credentials | `credentials.tsx` | 628 | `/api/credentials`, `/api/credentials/oracle`, `/api/credentials/orgs`, `/api/credentials/next-agent-id`, POST/PUT | ✅ Working |
| 4 | Wallets | `wallets.tsx` | 113 | `/api/wallets`, POST `/api/wallets/create-tx` | ✅ Working |
| 5 | Sessions | `sessions.tsx` | 107 | `/api/sessions/all` | ✅ Working |
| 6 | Agents | `agents.tsx` | 117 | `/api/wallets` + `/api/sessions/all` (combined client-side) | ✅ Working |
| 7 | Actions | `actions.tsx` | 81 | `/api/actions` | ✅ Working |
| 8 | Trees | `trees.tsx` | 223 | `/api/trees/all` | ✅ Working |
| 9 | Analytics | `analytics.tsx` | 70 | `/api/stats` | ✅ Working |
| 10 | Backups | `backups.tsx` | 84 | `/api/backups`, POST `/api/backups` | ✅ Working |
| 11 | Diagnostics | `diagnostics.tsx` | 108 | `/api/diagnostics` | ✅ Working |
| 12 | Settings | `settings.tsx` | 159 | `/api/config`, PUT `/api/config` | ✅ Working |
| 13 | Onboarding | `onboarding.tsx` | 552 | `/api/onboarding/diagnostics`, `/api/onboarding/harnesses`, PUT `/api/config`, `/api/onboarding/status`, `/api/health` | ⚠️ Timed steps |

### Component Inventory

| Component | File | Props | Status |
|-----------|------|-------|--------|
| StatCard | `ui.tsx` | label, value, icon, color, trend | ✅ Working |
| PageHeader | `ui.tsx` | title, description, action | ✅ Working |
| Skeleton | `ui.tsx` | className | ✅ Working |
| Badge | `ui.tsx` | variant, children | ✅ Working |
| EmptyState | `ui.tsx` | icon, title, description | ✅ Working |
| Button | `ui.tsx` | variant, size, onClick, disabled | ✅ Working |
| Sidebar | `sidebar.tsx` | activePage, onNavigate | ✅ Working |
| API client | `api.ts` | fetchJSON, postJSON, putJSON, deleteJSON | ✅ Working |
| useApi hook | `hooks.ts` | path, deps | ✅ Working |
| tx-sender | `tx-sender.ts` | sendTransaction, sendAndWaitForWalletCreation, etc. | ✅ Working |
| Web3Modal | `web3modal-provider.tsx` | wallet connection context | ✅ Working |
| ClientProvider | `client-provider.tsx` | wraps Web3ModalProvider | ✅ Working |

### Missing Pages (required but absent)

| Page | Requirement | Status |
|------|------------|--------|
| **Identities** | IdentityModule exists in SDK but no dashboard page reads it | ❌ Missing |
| **Capabilities** | CapabilityModule exists in SDK but no dashboard page | ❌ Missing |
| **Delegations** | DelegationModule exists in SDK but no dashboard page | ❌ Missing |
| **Transactions** | Transaction history exists in DB but no dashboard page | ❌ Missing |
| **Events** | Event history from DB, not just in-memory bus | ❌ Missing |
| **Anomalies** | Anomaly detection mentioned but no page | ❌ Missing |
| **Developer Tools** | SDK playground, ABI viewer | ❌ Missing |
| **Transaction Detail** | Per-tx view with simulation, events, logs | ❌ Missing |

### Mock / Placeholder Issues

| Location | Issue |
|----------|-------|
| `onboarding.tsx` — RuntimeStep | Uses `setTimeout` instead of real `/api/onboarding/init` |
| `onboarding.tsx` — DatabaseStep | 800ms timer, no real DB status check |
| `onboarding.tsx` — ServicesStep | Timed service status simulation |
| `credentials.tsx` — oracle price | Works but fallback display is weak |
| `overview.tsx` — events | Reads from in-memory EventBus, not persistent event DB |
| `globals.css` | Uses monospace as body font instead of Satoshi |

## 2. Request Flow Verification

### Every API Endpoint and Its Complete Trace

#### GET /api/health
```
Dashboard → fetch("/api/health") 
  → server.ts: returns { status: "ok", version: "1.0.0", uptime }
  No DB, no SDK, no contracts
```

#### GET /api/stats
```
Dashboard → fetch("/api/stats")
  → server.ts: 
    → getOrganizationService().count() → runQuery("SELECT COUNT(*)") → SQLite
    → getCredentialService().count() → runQuery → SQLite
    → getWalletService().count() → runQuery → SQLite
    → getSessionService().count() → runQuery → SQLite
    → getProofService().count() → runQuery → SQLite
    → loadConfig() → config file
  Returns { organizations, credentials, wallets, sessions, proofs, network, chainId }
```

#### GET /api/events
```
Dashboard → fetch("/api/events?limit=10")
  → server.ts:
    → getEventBus().getHistory(10) → in-memory array
  No DB persistence
  ⚠️ Only in-memory, lost on restart
```

#### POST /api/wallets/create-tx
```
Dashboard → postJSON("/api/wallets/create-tx", { ownerAddress })
  → server.ts:
    → dynamically imports adapter.ts
    → adapter.encodeCreateWallet(ownerAddress)
      → getProvider() → ethers JsonRpcProvider
      → getProxyGuard().validate(walletFactoryAddress)
      → Contract(AgentWalletFactory.abi).interface.encodeFunctionData("createWallet", [owner])
      → returns { success, factoryAddress, calldata, chainId, salt }
  ⚠️ Encodes only — actual on-chain write happens client-side via MetaMask
```

#### POST /api/wallets (create and persist)
```
Dashboard → postJSON("/api/wallets", { ownerAddress })
  → server.ts:
    → dynamically imports tools/wallet
    → createWallet(ownerAddress):
      → getProvider() + getSigner() → ethers Wallet
      → factory.connect(signer).createWallet(owner)
      → wait for receipt
      → parse WalletCreated event → extract walletAddress
      → runExecute("INSERT INTO wallets") → SQLite
      → getEventBus().emit("WalletCreated") → in-memory event
  ⚠️ Requires server-side PRIVATE_KEY — this is the "server signs" path
  The dashboard uses create-tx + MetaMask instead (client signs)
```

#### POST /api/credentials/update-root
```
Dashboard → postJSON("/api/credentials/update-root", { root })
  → server.ts:
    → dynamically imports blockchain/adapter
    → adapter.sendRootUpdate(root):
      → getSigner() → ethers Wallet from PRIVATE_KEY env
      → check isIssuer(signer.address) → CredentialRegistry.issuers() on-chain call
      → credentialRegistry.connect(signer).updateActiveRoot(root)
      → wait for receipt
      → returns { success, txHash }
  ⚠️ Also requires server-side PRIVATE_KEY — issuer role
```

#### POST /api/sessions (DB-only)
```
Dashboard → postJSON("/api/sessions", { walletAddress, sessionKey, ... })
  → server.ts:
    → getSessionService().create({ walletAddress, sessionKey, ... })
      → runExecute("INSERT INTO sessions") → SQLite
      → getEventBus().emit("SessionCreated")
  ⚠️ DB-only — no on-chain session creation
  On-chain session is done via /api/sessions/create-lightweight-tx (encoding) + MetaMask
```

### Dead or Unreachable Endpoints

| Endpoint | Used By | Status |
|----------|---------|--------|
| `/api/organizations/:id` | Dashboard organizations page | ❌ Not called — page uses `/api/organizations` list instead |
| `/api/credentials/next-org-id` | Not referenced in dashboard | ❌ Dead endpoint |
| `/api/proofs` | Not referenced in dashboard | ❌ Dead endpoint |
| `/api/contracts` | Not referenced in dashboard | ❌ Dead endpoint |
| `/api/trees` (single org) | Dashboard uses `/api/trees/all` instead | ❌ Dead endpoint |
| PUT `/api/config` | Used by Settings page | ✅ Working |
| DELETE `/api/sessions` | Session revoke not implemented in UI | ❌ Defined but no UI button calls it |

## 3. Design System Audit

### Current State
```
Design System Coverage: 30%
- Button (3 variants, 3 sizes) ✅
- Badge (4 variants) ✅
- Card (via glassmorphism classes) ⚠️ No Card component
- Table ❌ No table component
- Dialog/Modal ❌ No modal component
- Toast ❌ No toast component
- Alert/Alert Banner ✅ Inline via direct JSX
- Search ❌ No search component
- Command Palette ❌ Not implemented
- Breadcrumbs ❌ Not implemented
- Timeline ❌ Not implemented
- Code Block ❌ Not implemented
- Progress ❌ Not implemented
- Transaction Card ❌ Not implemented
- Identity Card ❌ Not implemented
- Wallet Card ❌ Not implemented
- Event Card ❌ Not implemented
- Session Card ❌ Not implemented
- Organization Card ❌ Not implemented
```

### Theme Support
```
Dark Theme: ✅ 100% coverage (single :root with dark values)
Light Theme: ❌ Not implemented
Theme Toggle: ❌ Not implemented
CSS Variables: ✅ Semantic tokens defined (bg, text, border, etc.)
Font: ❌ Monospace only — needs Satoshi
```

### Typography
```
Current: Monospace everywhere ('SF Mono', 'Fira Code', 'Cascadia Code')
Required: Satoshi — variable weight, proper hierarchy
- H1: Large titles (18-24px)
- H2: Section headers (14-16px)
- Body: Readable 11-13px
- Mono: Code snippets only
```

## 4. Navigation Map (Current vs Required)

### Current
```
Single-level sidebar, 12 items
State-based routing (no URL paths)
No breadcrumbs, no search, no keyboard shortcuts
```

### Required
```
Overview
├── System Status
├── Connected Chain
├── Connected Wallet
├── Connected Agent
├── Current Identity
├── Latest Events
├── Pending Transactions
├── Anomaly Summary

Wallets
├── Create Wallet
├── Wallet List
│   └── Wallet Detail
│       ├── Address / Balance
│       ├── Sessions
│       ├── Transactions
│       └── Identity

Identities
├── By Wallet
├── By ID
│   └── Identity Detail
│       ├── Credential Status
│       ├── Metadata
│       ├── Organizations
│       ├── Capabilities
│       └── Delegations

Organizations (read-only)
├── Organization List
│   └── Organization Detail
│       ├── Anchor Info
│       └── Credential Roots

Credentials
├── Issue Credential Flow
├── Credential List
├── Oracle State
└── Merkle Root

Sessions
├── Create Session
├── Session List
│   └── Session Detail
│       ├── Limits
│       ├── Targets
│       └── Timeline

Transactions
├── Transaction List
│   └── Transaction Detail
│       ├── Simulation
│       ├── Gas Estimate
│       ├── Events
│       └── Explorer Link

Events
├── All Events
├── Filter by Type
├── Filter by Wallet
└── Filter by Time

Logs
├── All Logs
├── Filter by Level
└── Filter by Component

Diagnostics
├── Health Checks
├── RPC Status
└── Sync Status

Anomalies
├── All Anomalies
├── Severity Filter
└── Resolution

Developer Tools
├── SDK Playground
├── ABI Viewer
└── Contract Browser

Settings
├── Network Config
├── Storage
└── Danger Zone
```

## 5. User Flow Analysis

### Standalone Flow — Current State
```
Connect Wallet → MetaMask popup → address in context
  ↓
Create Wallet → POST /api/wallets/create-tx → encode → MetaMask sign → POST /api/wallets/confirm → DB insert
  ↓
Issue Credential → POST /api/credentials → DB insert + Merkle tree update → POST /api/credentials/update-root → on-chain tx
  ↓
Create Session → POST /api/sessions/create-lightweight-tx → encode → MetaMask sign → POST /api/sessions → DB insert
  ↓
Execute → POST /api/wallets/execute-tx → encode → MetaMask sign
  ↓
View Events → GET /api/events → in-memory event bus
  ↓
Diagnostics → GET /api/diagnostics → runFullDiagnostics()
```
**Result:** The standalone flow WORKS — every step has real API calls. But the credential flow in the dashboard is 628 lines and tries to do everything in one monolithic function (`handleStartFlow`). Session creation and wallet creation rely on client-side MetaMask signing, which means multiple popups.

### Organization Flow — Current State
```
Request Org → POST /api/organizations/requests → DB insert → pending
  ↓
Approve (authority) → POST /api/organizations/requests/:id → DB update
  ↓
Wait for anchor → Not implemented in UI
  ↓
Issue credential under org → POST /api/credentials with orgId
```
**Result:** Organization flow is partial. On-chain organization creation requires `onlyOwner` and is not exposed in the dashboard. The "existing org" credential issuance works for DB records but the on-chain anchor root update is only accessible via the `owner` module.

## 6. What Needs to Change

### Critical — Missing Functionality
1. **Identity page** — SDK has IdentityModule but no dashboard page
2. **Capabilities page** — SDK has CapabilityModule but no dashboard page
3. **Delegations page** — SDK has DelegationModule but no dashboard page
4. **Transaction page** — Transaction history exists in DB but no UI
5. **Events page** — Persistent event DB table exists but dashboard reads from in-memory bus
6. **Anomalies page** — Anomaly detection mentioned but not implemented anywhere

### Critical — UX Issues
7. **Onboarding has mock steps** — RuntimeStep, DatabaseStep, ServicesStep use setTimeout
8. **No search/command palette** — Ctrl+K required
9. **No light theme** — 50% of users will miss this
10. **No breadcrumbs** — Navigation lacks context
11. **No keyboard shortcuts** — Power users need this

### High — Design System
12. **No reusable Card component** — Every page builds its own card layout
13. **No Table component** — Data display is inconsistent
14. **No Dialog/Modal** — All "modals" are inline expandable sections
15. **No Toast system** — Errors show as alerts or console logs
16. **No Timeline component** — Agent action timeline is a basic list
17. **Font is monospace** — Needs Satoshi with proper typography hierarchy

### Medium — Refinements
18. **Overview page** — Needs live connection status, not just stat cards
19. **Credentials flow** — 628-line `handleStartFlow` needs decomposition
20. **Session create** — No "create session" button on Sessions page (only via credentials flow)
21. **Wallet balance** — Not shown in wallet list
22. **Explorer links** — Hardcoded to Base Sepolia
23. **API client** — No timeout/retry/abort for failed requests
24. **WebSocket/SSE** — No real-time updates for events

## 7. Component Architecture (New)

```
components/
├── ui/                    # Design system primitives
│   ├── Button.tsx         # 4 variants, 3 sizes, icon support
│   ├── Card.tsx           # Elevated, outlined, glass
│   ├── Panel.tsx          # Section container with header
│   ├── Table.tsx          # Sortable, filterable, paginated
│   ├── Badge.tsx          # Status, version, count variants
│   ├── StatusDot.tsx      # Live/warning/error indicator
│   ├── Skeleton.tsx       # Loading states
│   ├── EmptyState.tsx     # No-data state
│   ├── Dialog.tsx         # Modal dialog
│   ├── Toast.tsx          # Notification toast
│   ├── Alert.tsx          # Inline alert banner
│   ├── Timeline.tsx       # Event/action timeline
│   ├── Progress.tsx       # Step progress / loading bar
│   ├── SearchBar.tsx      # Global search input
│   ├── CommandPalette.tsx # Ctrl+K palette
│   ├── Breadcrumbs.tsx    # Navigation breadcrumbs
│   └── CodeBlock.tsx      # ABI/calldata display
├── layout/
│   ├── Sidebar.tsx        # Navigation sidebar
│   ├── TopBar.tsx         # Command bar + wallet connect
│   └── DashboardShell.tsx # Page layout wrapper
├── cards/
│   ├── WalletCard.tsx     # Wallet address, balance, sessions
│   ├── IdentityCard.tsx   # Identity detail display
│   ├── SessionCard.tsx    # Session with limits, targets, status
│   ├── TransactionCard.tsx # Tx with status, events, links
│   ├── EventCard.tsx      # Event display
│   └── OrgCard.tsx        # Organization display
└── flows/
    ├── CreateWalletFlow.tsx    # Multi-step wallet creation
    ├── IssueCredentialFlow.tsx # Credential issuance wizard
    ├── CreateSessionFlow.tsx   # Session creation
    └── ConnectWalletFlow.tsx   # Wallet connection
```

## 8. Implementation Plan

### Phase 1: Design System Foundation
```
- Add Satoshi font (Google Fonts or bundled)
- Implement light/dark theme with CSS variables
- Build all ui/* primitives (Button, Card, Table, etc.)
- Update globals.css with semantic tokens
- Add theme toggle to TopBar
```

### Phase 2: Layout & Navigation
```
- Build DashboardShell (sidebar + top bar + content)
- Implement TopBar with search trigger (Ctrl+K placeholder)
- Add breadcrumbs to every page
- Keyboard shortcuts (Ctrl+K, Ctrl+1-9 for nav items)
- Build CommandPalette component
```

### Phase 3: Missing Pages
```
- Identity page (reads from SDK IdentityModule)
- Capabilities page (reads from SDK CapabilityModule)  
- Delegations page (reads from SDK DelegationModule)
- Transactions page (reads from transactions DB table)
- Events page (reads from events DB table)
- Anomalies page (reads from anomalies table + detection)
- Developer Tools (SDK playground, ABI viewer)
```

### Phase 4: Page Rewrites
```
- Overview: live status, connected chain/wallet/agent, pending txs, anomaly summary
- Wallets: balance, sessions count, identity link, activity
- Credentials: decomposed flow, proper error handling per step
- Sessions: create button, detail view, timeline, warnings
- Organizations: read-only queries, anchor info, credential roots
- Settings: developer mode toggle
```

### Phase 5: Real-time & Polish
```
- Replace polling with interval-based auto-refresh
- Add SSE/WebSocket for live event stream
- Toast notifications for transactions and events
- Loading skeletons for every data state
- Error boundaries for every page
- Responsive layout improvements
```

### Phase 6: Testing
```
- Component tests (Vitest + React Testing Library)
- E2E tests (Playwright) for every user flow
- Visual regression tests for theme switch
- Accessibility audit
```
