# AgentIX System Architecture

## Principle

Every subsystem answers exactly seven questions:

1. What does it own?
2. What does it read?
3. What does it never own?
4. What events does it publish?
5. What events does it subscribe to?
6. What states does it have?
7. Where does it run (memory / disk / chain)?

---

## Ownership Matrix

| Component | Owns | Reads | Never Owns |
|---|---|---|---|
| **Agent Manifest** | Agent identity definition | Nothing | Wallet keys, secrets |
| **Compiler** | Intent IR, Execution Plans, Policy Snapshots | Capabilities, Identities, Sessions, Wallets, Organizations | Transaction execution, signing |
| **Runtime** | Orchestration, service lifecycle | All services via Event Bus | Business logic, signing, indexing |
| **Event Bus** | Event routing, subscriptions, history | Nothing | Event persistence |
| **Scheduler** | Timers, delayed jobs, GC, retries | Event Bus (for triggers) | Business logic |
| **Indexer** | Blockchain event subscriptions, JSONL logs, checkpoints | Contracts | Transaction submission |
| **SQLite** | Structured cache (wallets, identities, sessions, etc.) | Nothing | Source of truth |
| **JSONL Store** | Append-only event logs | Nothing | Snapshots |
| **TOML Config** | Configuration files | Nothing | Secrets |
| **Merkle Trees** | Verifiable data structures | Nothing | Business logic |
| **Blockchain** | Source of truth, consensus | Nothing | Local cache |
| **Wallet Service** | Wallet creation, execution, lifecycle | Blockchain, Identity | Signing keys (uses provider) |
| **Identity Service** | Identity registration, metadata, credentials | Blockchain, Wallet Service | Identity creation (Factory creates) |
| **Session Service** | Session lifecycle, validation, limits | Blockchain, Wallet Service | Session signing (uses provider) |
| **Credential Service** | ZK credential issuance, revocation, roots | Merkle Trees, Blockchain | Proof generation (uses prover) |
| **Capability Service** | Capability registration, grant management | Blockchain | Capability definition |
| **Delegation Service** | Delegation chains, root management | Blockchain | Delegation authority |
| **Organization Service** | Organization registration, anchors, activation | Blockchain | Organization creation |
| **Plugin Providers** | External system interfaces (Ethereum, Solana, etc.) | Chain state | Core protocol logic |
| **Dashboard** | Presentation, user interaction | Event Bus, SQLite | Business logic, execution |
| **MCP Server** | AI agent tool interface | Event Bus | Business logic, execution |
| **CLI** | Human operator interface | Event Bus | Business logic |
| **SDK** | Developer programmatic interface | Event Bus | Business logic |

---

## Event Bus

### Published Events (every state change)

```
# Identity
IdentityRegistered     { identityId, wallet }
IdentityDeactivated    { identityId }
IdentityReactivated    { identityId }
CredentialLinked       { identityId, credentialId }
MetadataUpdated        { identityId, metadataRoot }

# Wallet
WalletCreated          { walletAddress, owner, salt, entryPoint }
WalletExecuted         { walletAddress, target, value, txHash }
WalletBatchExecuted    { walletAddress, callCount, totalValue, txHash }
WalletDeposited        { walletAddress, amount }
WalletWithdrawn        { walletAddress, recipient, amount }
OwnershipTransferStarted { walletAddress, oldOwner, newOwner }
OwnershipTransferred   { walletAddress, oldOwner, newOwner }

# Session
SessionCreated         { sessionId, wallet, sessionKey, expiry, maxValue, nullifier }
SessionUsed            { sessionId, value, totalUsed }
SessionRevoked         { sessionId }
LightSessionCreated    { sessionId, wallet, sessionKey, dailySpendLimit, dailyTxLimit, expiry }
LightSessionUsed       { sessionId, value, newDailySpend }
LightSessionRevoked    { sessionId }
DailyLimitsReset       { sessionId, newDay }

# Credential
RootUpdated            { organizationId, oldRoot, newRoot, epoch }
CredentialIssued       { credentialId, organizationId, agentId }
CredentialRevoked      { organizationId, agentId }
NullifierUsed          { nullifier }

# Organization
OrganizationRegistered { organizationId, name, owner, credentialAnchor }
OrganizationDeactivated { organizationId }
OrganizationReactivated { organizationId }
CredentialAnchorUpdated { organizationId, oldAnchor, newAnchor }

# Capability
CapabilityRegistered   { capabilityId, actionHash, registrar }
CapabilityRevoked      { capabilityId }
GrantRootUpdated       { grantor, grantee, capabilityId, newRoot }
GrantRevoked           { grantLeafHash }

# Delegation
DelegationRootUpdated  { delegator, scopeHash, newRoot, expiresAt }
DelegationRevoked      { delegationLeafHash, delegator }
DelegatorRevoked       { delegator }
DelegatorReAuthorized  { delegator }
ScopeRegistered        { action, scopeHash }

# Compiler
IntentCompiled         { planId, contentHash, intent }
PlanApproved           { planId }
PlanRejected           { planId, reason }
PlanExecuting          { planId }
PlanCompleted          { planId, txHash }
PlanFailed             { planId, error }
PolicySnapshotCreated  { snapshotId, policyHash }
CompilationCached      { contentHash }

# Indexer
EventsIndexed          { fromBlock, toBlock, eventCount }
CheckpointSaved        { contractName, block }
ReorgDetected          { depth, affectedBlocks }
StateReconstructed     { tableCount, verified }

# Scheduler
JobScheduled           { jobId, type, scheduledAt }
JobExecuted            { jobId, duration }
JobFailed              { jobId, error, retriesRemaining }
JobRetrying            { jobId, nextAttemptAt }
CachePruned            { entriesRemoved }
GarbageCollected       { bytesFreed }

# System
DiagnosticsRun         { status, checks }
HealthCheckRun         { status, checks }
SystemStarted          { version, chainId }
SystemStopped          { uptime }
PluginLoaded           { pluginName, version }
PluginLoadFailed       { pluginName, error }
```

### Who Subscribes to What

```
Indexer
  → subscribes to ALL on-chain events (40+ contract events)
  → publishes EventsIndexed, CheckpointSaved, ReorgDetected, StateReconstructed

SQLite (via services)
  → subscribes to Identity*, Wallet*, Session*, Credential*, Organization*, Capability*, Delegation*
  → updates local cache

Dashboard
  → subscribes to ALL events
  → refreshes UI

Compiler
  → subscribes to CapabilityRegistered, GrantRootUpdated, CredentialLinked
  → invalidates capability cache

MCP Server
  → subscribes to PlanCompleted, PlanFailed
  → returns results to AI agent

Scheduler
  → subscribes to SessionCreated (schedule expiry check)
  → subscribes to PlanExecuting (schedule timeout)
  → subscribes to SystemStarted (schedule periodic GC)
```

---

## Intermediate Representations

### Intent IR

The canonical, source-independent representation of user intent.

```typescript
interface IntentIR {
  // Identity
  version: 1;
  id: string;                    // UUID
  source: "cli" | "sdk" | "rest" | "mcp" | "dashboard" | "nl";

  // What
  action: string;                // Canonical action name
  params: Record<string, unknown>; // Typed parameters

  // Who
  agent?: {
    identityId: number;
    walletAddress: string;
  };
  organizationId?: string;
  sessionId?: string;

  // Constraints
  limits?: {
    maxValue?: string;           // Wei
    maxGas?: string;             // Wei
    expiry?: number;             // Unix timestamp
  };
  targets?: string[];            // Allowed target addresses

  // Metadata
  requestedAt: number;
  priority: "low" | "normal" | "high";
  idempotencyKey?: string;       // For dedup
}
```

### Capability Graph

The resolved set of what an agent can do.

```typescript
interface CapabilityGraph {
  agent: {
    identityId: number;
    walletAddress: string;
  };
  organization: {
    id: string;
    active: boolean;
  };
  capabilities: CapabilityNode[];
  delegations: DelegationEdge[];
  credentials: CredentialNode[];

  // Computed
  grantedActions: Set<string>;   // Union of all capability actions
  restrictedActions: Set<string>; // Actions requiring delegation
  missingActions: Set<string>;    // Actions not available
}

interface CapabilityNode {
  capabilityId: string;
  actionHash: string;
  grantor: string;
  constraints: Constraints;
  expiresAt: number;
  proof: MerkleProof;            // On-chain proof of grant
}

interface DelegationEdge {
  from: string;                  // Delegator
  to: string;                    // Delegatee
  scopeHash: string;
  expiresAt: number;
  proof: MerkleProof;
  depth: number;
}

interface CredentialNode {
  credentialId: string;
  agentId: number;
  nullifier: string;
  permissions: number;
  expiry: number;
  revoked: boolean;
  proof: MerkleProof;            // Proof of inclusion in active tree
}
```

### Policy Graph

The generated constraints from capabilities, sessions, and organization rules.

```typescript
interface PolicyGraph {
  rules: PolicyRule[];
  edges: PolicyEdge[];           // Dependencies between rules
  root: string;                  // Root rule ID

  // Computed
  effectiveLimits: {
    maxValue: string;            // Minimum across all rules
    maxGas: string;
    expiry: number;
    allowedTargets: string[];
  };
  conflicts: PolicyConflict[];
}

interface PolicyRule {
  id: string;
  type: "limit" | "constraint" | "requirement" | "delegation";
  source: string;                // Which capability/session/org generated this
  precedence: number;            // Higher = overrides lower

  // What it constrains
  limit?: {
    field: "value" | "gas" | "time" | "count" | "target";
    operator: "lte" | "gte" | "eq" | "in" | "not_in";
    value: unknown;
  };
  constraint?: {
    mustHave: string[];          // Required capabilities
    mustNotHave: string[];       // Forbidden capabilities
    mustDelegate: boolean;       // Requires delegation chain
  };
  requirement?: {
    credentialVersion: number;
    requiredPermissions: number;
    zkProofRequired: boolean;
  };
}
```

### Execution Graph

The ordered, dependency-aware sequence of operations.

```typescript
interface ExecutionGraph {
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];        // Dependencies: A must complete before B
  entryPoints: string[];         // Nodes with no dependencies
  exitPoints: string[];          // Nodes nothing depends on

  // Computed
  criticalPath: string[];        // Longest dependency chain
  parallelBatches: string[][];   // Nodes that can run concurrently
}

interface ExecutionNode {
  id: string;
  type: "contract_call" | "wait_confirmation" | "read_event" |
        "db_write" | "merkle_update" | "signature_request" | "conditional";

  // Contract call specifics
  call?: {
    contractName: string;
    address: string;
    function: string;
    args: unknown[];
    value: string;
    gasLimit: string;
  };

  // Control flow
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
  timeout?: number;              // Milliseconds
  rollback?: ExecutionNode[];    // What to do on failure

  // Dependencies
  dependsOn: string[];           // Node IDs that must complete first
  allowsParallel: boolean;       // Can run concurrently with siblings

  // Conditionals
  condition?: {
    field: string;
    operator: "eq" | "neq" | "gt" | "lt";
    value: unknown;
    onTrue: string;              // Next node if true
    onFalse: string;             // Next node if false
  };
}
```

### Execution Plan (Final Immutable Artifact)

```typescript
interface ExecutionPlan {
  // Identity
  planId: string;
  contentHash: string;           // keccak256 of entire plan
  version: 1;

  // Provenance
  intent: IntentIR;
  capabilityGraph: CapabilityGraph;
  policyGraph: PolicyGraph;
  executionGraph: ExecutionGraph;

  // Simulation
  simulation: SimulationResult;
  risk: RiskAssessment;
  explanation: string;

  // Signatures required
  requiredSignatures: {
    type: "owner" | "session" | "delegation";
    address: string;
    signed: boolean;
    signature?: string;
  }[];

  // Lifecycle
  status: PlanLifecycle;
  createdAt: number;
  expiresAt: number;
  executedAt?: number;
  completedAt?: number;
  txHash?: string;
}
```

---

## State Machines

### ExecutionPlan Lifecycle

```
              ┌──────────┐
              │  DRAFT   │
              └────┬─────┘
                   │ compile()
                   ▼
              ┌──────────┐
              │ COMPILED │
              └────┬─────┘
                   │ simulate()
                   ▼
              ┌──────────┐
              │SIMULATED │
              └────┬─────┘
                   │
          ┌────────┴────────┐
          │ risk >= threshold│   risk < threshold
          ▼                 ▼
    ┌──────────┐     ┌──────────┐
    │APPROVAL  │     │ APPROVED │
    │REQUIRED  │     └────┬─────┘
    └────┬─────┘          │
         │ approve()      │ execute()
         ▼                ▼
    ┌──────────┐     ┌──────────┐
    │ APPROVED │────▶│EXECUTING │
    └──────────┘     └────┬─────┘
                          │
              ┌───────────┼───────────┐
              │ success   │ failure   │
              ▼           ▼           │
        ┌──────────┐ ┌──────────┐    │
        │COMPLETED │ │  FAILED  │────┘ (retry)
        └────┬─────┘ └──────────┘
             │
             │ archive()
             ▼
        ┌──────────┐
        │ ARCHIVED │
        └──────────┘

  Rejection: any state → REJECTED (terminal)
```

### Agent Identity Lifecycle

```
  Factory.createWallet()
        │
        ▼
  ┌───────────┐
  │REGISTERED │
  └─────┬─────┘
        │ linkCredential()
        ▼
  ┌───────────┐
  │  ACTIVE   │◄──────── reactivate()
  └─────┬─────┘
        │ deactivate()
        ▼
  ┌───────────┐
  │ INACTIVE  │
  └───────────┘
```

### Session Lifecycle

```
  createSession() / createLightweightSession()
        │
        ▼
  ┌───────────┐
  │  ACTIVE   │
  └─────┬─────┘
        │
   ┌────┴────┐
   │ expire  │ revoke()
   ▼         ▼
┌────────┐ ┌──────────┐
│EXPIRED │ │ REVOKED  │
└────────┘ └──────────┘
```

### Wallet Lifecycle

```
  Factory.createWallet()
        │
        ▼
  ┌───────────┐
  │ DEPLOYED  │
  └─────┬─────┘
        │
   ┌────┴────┐
   │ transfer│ deposit()
   │ownership│
   ▼         ▼
┌────────┐ ┌───────────┐
│TRANSFER│ │  FUNDED   │
│PENDING │ └───────────┘
└───┬────┘
    │ accept()
    ▼
┌───────────┐
│  ACTIVE   │ (new owner)
└───────────┘
```

---

## Resource Model

Every subsystem declares its resource requirements.

```typescript
interface ResourceDeclaration {
  subsystem: string;

  memory: {
    maxBytes: number;            // Maximum memory allocation
    persistent: boolean;         // Survives restart?
  };

  disk: {
    path: string;                // Where it stores data
    maxBytes: number;
    type: "sqlite" | "jsonl" | "toml" | "binary" | "none";
  };

  network: {
    required: boolean;           // Needs internet?
    endpoints: string[];         // What it connects to
    maxConcurrent: number;
  };

  cpu: {
    intensive: boolean;          // Heavy computation?
    blocking: boolean;           // Blocks main thread?
    threadable: boolean;         // Can run in worker?
  };
}
```

### Resource Allocations

| Subsystem | Memory | Disk | Network | CPU |
|---|---|---|---|---|
| Compiler | 50MB | SQLite (cache) | RPC for simulation | Heavy (ZK verification) |
| Runtime | 10MB | None | HTTP server | Light |
| Indexer | 100MB (event buffer) | JSONL (logs) + SQLite (checkpoints) | RPC (continuous) | Medium |
| Event Bus | 50MB (history) | None | None | Light |
| Scheduler | 5MB | SQLite (job queue) | None | Light |
| SQLite | 20MB (cache) | agentix.db | None | Light (WAL writes) |
| Merkle Trees | 200MB (in-memory) | Binary snapshots | None | Heavy (Poseidon) |
| Dashboard | 100MB | None | HTTP client | Light (rendering) |
| MCP Server | 10MB | None | Stdio | Light |
| Wallet Service | 5MB | None | RPC | Light |
| Identity Service | 5MB | None | RPC | Light |

---

## Agent Manifest

Every agent is defined by a manifest file.

### `~/.agentix/agents/{agent-name}/agent.toml`

```toml
[agent]
name = "my-agent"
version = "1.0.0"
description = "DeFi automation agent"

[identity]
identity_id = 42
wallet_address = "0x..."

[organization]
id = "org-abc"
role = "member"

[capabilities]
required = [
    "wallet_execute",
    "credential_prove",
    "session_create_lightweight"
]

[permissions]
max_value_per_tx = "1000000000000000000"  # 1 ETH
max_daily_value = "10000000000000000000"  # 10 ETH
allowed_targets = [
    "0x...",   # Uniswap router
    "0x...",   # Aave pool
]
allowed_times = { start = "09:00", end = "17:00", timezone = "UTC" }

[sessions]
prefer_lightweight = true
max_sessions = 5
default_expiry_hours = 24

[plugins]
enabled = ["base-ethereum", "erc20-transfers"]

[runtime]
restart_on_crash = true
max_retries = 3
log_level = "info"
```

---

## Storage Separation

### SQLite — Structured Relational Cache

```
~/.agentix/db/agentix.db
├── wallets               # Wallet addresses, owners, factories
├── identities             # Identity IDs, metadata roots
├── sessions               # Active/revoked sessions
├── credentials            # Credential nullifiers, secrets (local only)
├── organizations          # Organization registrations
├── capabilities           # Capability registrations
├── delegations            # Delegation records
├── execution_plans        # Compiled plans
├── compilation_cache      # Content-addressable plan cache
├── policy_snapshots       # Policy version history
├── indexer_checkpoints    # Last indexed block per contract
├── scheduler_jobs          # Delayed/retry jobs
├── agent_actions          # Audit trail
├── merkle_snapshots       # Serialized tree state
├── config                 # Key-value runtime config
└── metadata               # Schema version, timestamps
```

### JSONL — Append-Only Event Log

```
~/.agentix/events/
├── 2026-07-04.jsonl       # One file per day
├── 2026-07-03.jsonl
├── 2026-07-02.jsonl
└── index.json             # (blockNumber, byteOffset) per event for fast lookup
```

Each line:
```json
{"blockNumber":123456,"txHash":"0x...","logIndex":3,"contractName":"SessionManager","eventName":"SessionCreated","args":{"sessionId":"0x...","wallet":"0x..."},"timestamp":1720000000}
```

### TOML — Configuration

```
~/.agentix/
├── config/
│   └── agentix.config.toml     # Main config (was JSON)
├── compiler/
│   ├── compiler.toml            # Compiler settings
│   └── plugins/                 # Plugin directory
└── agents/
    └── {name}/
        ├── agent.toml           # Agent manifest
        └── policies/            # Agent-specific policies
```

### Merkle Trees — Binary Snapshots

```
~/.agentix/trees/
├── {organization_id}/
│   ├── active.bin               # Binary serialized active tree
│   ├── revoked.bin              # Binary serialized revoked tree
│   ├── snapshots/
│   │   ├── epoch-001.bin
│   │   └── epoch-002.bin
│   └── manifest.toml            # Tree metadata (depth, hash function, epoch)
└── plans/
    ├── merkle.bin               # Merkle tree of all execution plans
    └── snapshots/
```

---

## Plugin Providers

Plugins become **providers** that expose capabilities to the system.

```typescript
interface ProviderPlugin {
  // Identity
  name: string;
  version: string;
  providerType: string;          // "ethereum" | "solana" | "arweave" | "github" | "stripe" | "filesystem" | "browser"

  // Capabilities this provider exposes
  capabilities: {
    action: string;              // e.g. "ethereum_send_transaction"
    schema: ZodSchema;           // Parameter schema
    requiredResources: string[]; // e.g. ["wallet", "rpc"]
    riskWeight: number;          // 0-1 contribution to risk score
  }[];

  // Lifecycle
  initialize(config: ProviderConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;

  // Execution
  execute(action: string, params: unknown, context: ExecutionContext): Promise<ExecutionResult>;
  simulate(action: string, params: unknown, context: SimulationContext): Promise<SimulationResult>;

  // Events this provider emits (in addition to standard events)
  customEvents?: string[];
}
```

### Built-in Providers

```
providers/
├── ethereum/                # Base Sepolia, ERC-4337, direct tx
├── agentix/                 # All 9 AgentIX contracts
├── filesystem/              # Local file operations
├── sqlite/                  # Database operations
├── http/                    # HTTP API calls
└── arweave/                 # Optional archival (disabled by default)
```

No more "capability plugin", "policy plugin", "risk plugin". Those are all aspects of a provider.

---

## Scheduler

Unified job scheduling for all background work.

```typescript
interface Scheduler {
  // Schedule a one-time job
  schedule(job: Job): string;          // Returns jobId

  // Schedule a recurring job
  scheduleRecurring(job: RecurringJob): string;

  // Cancel a job
  cancel(jobId: string): void;

  // Query jobs
  getStatus(jobId: string): JobStatus;
  listJobs(filter: JobFilter): Job[];
}

interface Job {
  type: string;                        // "session_expiry" | "cache_prune" | "retry_tx" | "checkpoint" | "gc" | "replay" | "sync"
  payload: unknown;
  scheduledAt: number;                 // Unix timestamp
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
  timeoutMs: number;
  onComplete?: string;                 // Event to publish on completion
  onFailure?: string;                  // Event to publish on failure
}
```

### Default Scheduled Jobs

| Job | Interval | Purpose |
|---|---|---|
| `session_expiry_check` | Every 60s | Revoke expired sessions |
| `cache_prune` | Every 300s | Remove expired compilation cache entries |
| `garbage_collect` | Every 3600s | Vacuum SQLite, rotate JSONL logs |
| `indexer_checkpoint` | Every 100 blocks | Write indexer checkpoint |
| `merkle_snapshot` | On credential change | Snapshot tree state |
| `plan_timeout` | Per-plan (at expiresAt) | Mark expired plans as FAILED |
| `backup_rotate` | Every 86400s | Create daily backup |
| `health_check` | Every 300s | Run health checks, publish diagnostics |

---

## Minimal Runtime

The Runtime becomes an orchestrator, not a monolith.

```typescript
class Runtime {
  private eventBus: EventBus;
  private scheduler: Scheduler;
  private services: Map<string, Service>;

  async start(): Promise<void> {
    // 1. Load config
    // 2. Initialize event bus
    // 3. Initialize scheduler
    // 4. Start services in dependency order:
    //    SQLite → Indexer → Wallet → Identity → Session
    //    → Credential → Capability → Delegation → Organization
    //    → Compiler → Dashboard → MCP → CLI
    // 5. Start HTTP server
    // 6. Start indexer subscription
    // 7. Publish SystemStarted
  }

  async stop(): Promise<void> {
    // 1. Stop accepting new requests
    // 2. Drain in-flight executions
    // 3. Stop indexer
    // 4. Stop services in reverse order
    // 5. Stop scheduler
    // 6. Close SQLite
    // 7. Publish SystemStopped
  }

  // The Runtime only does orchestration.
  // All business logic lives in services.
  // All communication goes through the Event Bus.
}

interface Service {
  name: string;
  dependencies: string[];
  resources: ResourceDeclaration;
  states: StateMachine;
  events: { publishes: string[]; subscribes: string[] };

  initialize(runtime: Runtime): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}
```

---

## Service Dependencies

```
                    ┌──────────┐
                    │  Event   │
                    │   Bus    │◄────────────────────────────┐
                    └────┬─────┘                             │
                         │                                   │
                    ┌────┴─────┐                             │
                    │ Scheduler│                             │
                    └────┬─────┘                             │
                         │                                   │
        ┌────────────────┼────────────────┐                 │
        │                │                │                 │
   ┌────┴─────┐    ┌─────┴────┐    ┌──────┴──────┐          │
   │  SQLite  │    │  JSONL   │    │    TOML     │          │
   │  Cache   │    │  Store   │    │   Config    │          │
   └────┬─────┘    └─────┬────┘    └──────┬──────┘          │
        │                │                │                 │
        └────────────────┼────────────────┘                 │
                         │                                  │
                    ┌────┴─────┐                             │
                    │  Indexer │──→ Blockchain              │
                    └────┬─────┘                             │
                         │                                  │
        ┌────────────────┼────────────────┐                 │
        │                │                │                 │
   ┌────┴─────┐    ┌─────┴────┐    ┌──────┴──────┐          │
   │  Wallet  │    │ Identity │    │Organization │          │
   │ Service  │◄───│ Service  │    │  Service    │          │
   └────┬─────┘    └─────┬────┘    └──────┬──────┘          │
        │                │                │                 │
   ┌────┴─────┐    ┌─────┴────┐    ┌──────┴──────┐          │
   │ Session  │    │Credential│    │ Capability  │          │
   │ Service  │    │ Service  │    │  Service    │          │
   └────┬─────┘    └─────┬────┘    └──────┬──────┘          │
        │                │                │                 │
        └────────────────┼────────────────┘                 │
                         │                                  │
                    ┌────┴─────┐                             │
                    │ Compiler │                             │
                    └────┬─────┘                             │
                         │                                  │
        ┌────────────────┼────────────────┐                 │
        │                │                │                 │
   ┌────┴─────┐    ┌─────┴────┐    ┌──────┴──────┐          │
   │ MCP      │    │Dashboard │    │    CLI      │──────────┘
   │ Server   │    │          │    │             │
   └──────────┘    └──────────┘    └─────────────┘
```

---

## Merkle Trees as Primitive

Merkle trees become a generic verifiable storage layer, not a credential-specific feature.

```typescript
interface MerkleTree<T> {
  // Identity
  name: string;                    // "credentials", "plans", "events", "attestations"
  depth: number;                   // 20 (supports ~1M leaves)
  hashFunction: "poseidon" | "keccak256" | "sha256";

  // State
  root: string;                    // Current Merkle root
  epoch: number;                    // Monotonic version counter
  leafCount: number;
  leaves: Map<number, T>;          // Sparse leaf storage

  // Operations
  insert(index: number, value: T): void;
  remove(index: number): void;
  getProof(index: number): MerkleProof;
  verify(proof: MerkleProof, root: string, index: number, value: T): boolean;
  getRoot(): string;
  getEpoch(): number;

  // Persistence
  snapshot(): MerkleSnapshot<T>;
  restore(snapshot: MerkleSnapshot<T>): void;
  exportBinary(): Buffer;
  importBinary(data: Buffer): void;

  // Verifiability
  verifyConsistency(): boolean;     // Check in-memory matches persisted
}
```

### Usage

```
Credentials:   MerkleTree<CredentialLeaf>     // Who has what credentials
Plans:          MerkleTree<PlanLeaf>           // Verifiable execution history
Events:         MerkleTree<EventBatchLeaf>     // Verifiable event log batches
Attestations:   MerkleTree<AttestationLeaf>    // Verifiable claims
Policies:       MerkleTree<PolicyLeaf>         // Verifiable policy versions
```

Every Merkle tree publishes `RootUpdated` events with the tree name, epoch, and root hash.

---

## Cross-Cutting Concerns

### Error Handling

```typescript
// All errors are typed and traceable
class AgentixError extends Error {
  constructor(
    message: string,
    public readonly code: string,         // "COMPILER_INTENT_INVALID"
    public readonly subsystem: string,    // "compiler"
    public readonly details?: unknown,
    public readonly recoverable: boolean = false
  ) {
    super(message);
  }
}

// Error propagation chain
// Service → Event Bus (error events) → Diagnostics → Dashboard
```

### Observability

Every subsystem exposes:
- `healthCheck()`: Returns status + metrics
- `getMetrics()`: Counters, timings, sizes
- Event publishing for all state changes

### Security

- **ProxyGuard**: All contract addresses validated before use
- **No secrets on disk**: Private keys never stored, only referenced
- **Least privilege by default**: Policies start maximally restrictive
- **Deterministic compilation**: Same intent → same plan, every time
- **Content-addressed plans**: Tampering is detectable

### Determinism Guarantees

- Intent IR produced from any source must be byte-identical for equivalent intents
- Capability resolution is deterministic (queries on-chain state at a specific block)
- Policy generation is deterministic (rule application order is fixed)
- Compilation cache key = keccak256(canonicalJson(intentIR))
- All plan hashes are reproducible

---

## Recovery Procedures

### Database Corruption

```
1. Detect via checksum verification
2. Attempt WAL recovery (SQLite built-in)
3. If unrecoverable: delete agentix.db
4. Reconstruct via indexer → state reconstructor
5. Verify Merkle tree roots against on-chain
6. Resume normal operation
```

### Indexer Crash

```
1. On restart: read indexer_checkpoints
2. Resume subscription from last_block + 1
3. Catch up historical events from last_block to current
4. Deduplicate overlapping events
5. Resume real-time subscription
```

### Full System Recovery

```
1. Delete ~/.agentix/db/agentix.db
2. Delete ~/.agentix/trees/*
3. Start indexer from block 0
4. Replay all events
5. Rebuild all SQLite tables
6. Rebuild all Merkle trees
7. Verify state hashes
8. System operational
```

---

## What Changes from Current Codebase

| Current | New |
|---|---|
| `src/tools/*.ts` — business logic | Moves to services, called via Event Bus |
| `src/runtime/server.ts` — HTTP + business logic | Pure HTTP routing, delegates to services |
| `src/mcp/server.ts` — MCP + business logic | Pure MCP interface, delegates to services |
| `src/core/database.ts` — flat schema | Extended with compiler/indexer/scheduler tables |
| `packages/services/*` — direct DB calls | Call via SQLite service, publish events |
| `packages/core/ai-harness/` — basic intent engine | Replaced by full Compiler pipeline |
| `src/sdk/events.ts` — basic EventIndexer | Replaced by @agentix/indexer |
| `packages/core/eventbus/` — 19 event types | Expanded to 50+ event types |
| `packages/core/tree-engine/` — credential-only | Replaced by generic MerkleTree<T> |
| `~/.agentix/config/agentix.config.json` | Migrated to `agentix.config.toml` |
| No agent manifest | `agent.toml` required per agent |
| No scheduler | `@agentix/scheduler` handles all background work |
| No IR | Intent IR, Capability Graph, Policy Graph, Execution Graph |
| No plugin providers | Provider-based plugin system |
