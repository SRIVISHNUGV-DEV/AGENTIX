# Chat Panel Redesign Spec

**Date:** 2026-05-18
**Status:** Design Approved
**Scope:** Fix chat panel, unify agent IDs, simplify quick actions to protocol-supported operations

---

## Problem Statement

### Issue 1: Broken Chat Flow
- Chat not connecting to runtime endpoints properly
- Hardcoded to localhost:3002 instead of any connected runtime

### Issue 2: Non-Functional Quick Actions
- Actions like "Execute Command", "Read File", "Query", "Deploy Contract" are not implemented
- Users see buttons that don't work

### Issue 3: Duplicate Agent ID Sequences
- `agents` table has ID sequence: 1, 2, 3...
- `external_agents` table has ID sequence: 1, 2, 3...
- Confusing display: "External Agent 3 connected to Protocol Agent 1"

### Issue 4: ID Increments on Reconnect
- When runtime disconnects and reconnects, a new external_agent row is created with incremented ID
- Should reuse existing agent identity

---

## Design Goals

1. **Chat works with any connected runtime** (local, Lambda, Cloudflare, self-hosted)
2. **Quick actions show only what protocol supports**
3. **Unified agent IDs** - one sequence, one table concept
4. **Stable IDs on reconnect** - reuse existing agent identity

---

## Architecture

### Unified Agent Model

**Current (Broken):**
```
agents (id: 1, 2, 3...)     ← Protocol agents
    ↑ linked_agent_id
external_agents (id: 1, 2, 3...) ← External runtimes
```
Result: "External Agent 3 connected to Protocol Agent 1"

**New Design:**
```
agents (id: 1, 2, 3...)
├── type: 'protocol' | 'external'
├── source: 'platform' | 'runtime'
└── runtime fields only if type='external'
```
Result: "Agent 1 - Runtime Connected" or "Agent 2 - Platform Native"

### Agent Types

| Type | Source | Capabilities |
|------|--------|--------------|
| `protocol` | Platform-created | Create credentials, wallets, sessions first, then connect runtime |
| `external` | Runtime-connected | Connect runtime first, then create credentials, wallets |

**Both types have same capabilities after setup.**

---

## Protocol-Supported Actions

From `AgentWallet.sol` smart contract:

| Action | Solidity Function | Quick Action |
|--------|-------------------|--------------|
| **Execute** | `execute(address, uint256, bytes)` | Send Transaction |
| **Execute Batch** | `executeBatch(address[], uint256[], bytes[])` | Batch Transactions |
| **Add Whitelist** | `addToWhitelist(address)` | Via chat only |
| **Remove Whitelist** | `removeFromWhitelist(address)` | Via chat only |
| **Deposit** | `depositToEntryPoint()` | Via chat only |
| **Withdraw** | `withdrawFromEntryPoint()` | Via chat only |

**Transactions ONLY execute to whitelisted addresses.**

---

## Implementation Details

### 1. Quick Actions (Simplified)

**File:** `frontend/components/execute/quick-actions.tsx`

```typescript
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "send_transaction",
    label: "Send Transaction",
    icon: <Send className="h-4 w-4" />,
    template: "Send 0.1 ETH to 0x...",
    description: "Send ETH to a single whitelisted address"
  },
  {
    id: "batch_transactions",
    label: "Batch Transactions",
    icon: <Layers className="h-4 w-4" />,
    template: "Send 0.05 ETH each to: 0x..., 0x...",
    description: "Send ETH to multiple whitelisted addresses"
  },
  {
    id: "custom",
    label: "Custom",
    icon: <MessageSquare className="h-4 w-4" />,
    template: "",
    description: "Free-form request (whitelist, withdraw, etc.)"
  }
]
```

**Remove:** Execute Command, Read File, API Call, Query, Sign Transaction, Deploy Contract

---

### 2. Chat Execution Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐
│   Frontend  │────▶│   Backend   │────▶│   Runtime (any type)    │
│  Chat Panel │     │   Port 3001 │     │ • Local (:3002)         │
│             │     │             │     │ • Lambda (Function URL) │
│             │     │             │     │ • Cloudflare Workers   │
└─────────────┘     └─────────────┘     │ • Self-hosted           │
                          │             └─────────────────────────┘
                          ▼
                    ┌─────────────┐
                    │  Database   │
                    │ (PostgreSQL)│
                    └─────────────┘
```

**File:** `frontend/lib/external-agents-api.ts`

```typescript
export async function executeChatMessage(
  agentId: number,
  message: string,
  orgId: number,
  signature?: SignaturePayload
): Promise<{
  success: boolean
  response?: string
  result?: any
  error?: string
}> {
  // Backend routes to correct runtime based on agent's endpoint
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'chat',
      params: { message },
      orgId,
      ...signature
    })
  })
  return response.json()
}
```

---

### 3. Unified Agent Database Schema

**Migration:** `backend/src/migrations.ts`

```sql
-- Add type column to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type VARCHAR(20) DEFAULT 'protocol';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'platform';

-- Add runtime fields to agents (previously in external_agents)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint VARCHAR(255);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_status VARCHAR(20) DEFAULT 'disconnected';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_ping_at INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_metadata JSONB DEFAULT '{}';

-- Create unique constraint on (org_id, endpoint) for runtime reconnection
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_org_endpoint 
  ON agents(org_id, endpoint) 
  WHERE endpoint IS NOT NULL;

-- Migrate existing external_agents data into agents
INSERT INTO agents (org_id, agent_name, agent_type, source, endpoint, runtime_status, agent_metadata, linked_agent_id)
SELECT org_id, name, 'external', 'runtime', endpoint, status, metadata, linked_agent_id
FROM external_agents
ON CONFLICT DO NOTHING;
```

**Benefits:**
- Single ID sequence
- No confusion about "External Agent X connected to Protocol Agent Y"
- Reconnecting runtime reuses existing agent by endpoint

---

### 4. Stable Agent ID on Reconnect

**Problem:** Each runtime connection creates new ID

**Solution:** Upsert by endpoint

```typescript
// backend/src/services/agentService.ts
async connectRuntime(orgId: number, endpoint: string, name: string): Promise<Agent> {
  const existingAgent = await db.get(
    `SELECT * FROM agents WHERE org_id = $1 AND endpoint = $2`,
    [orgId, endpoint]
  )

  if (existingAgent) {
    // Update status, reuse ID
    await db.run(
      `UPDATE agents SET runtime_status = 'active', last_ping_at = $1 WHERE id = $2`,
      [Date.now(), existingAgent.id]
    )
    return existingAgent
  }

  // Create new agent with type='external'
  const result = await db.run(
    `INSERT INTO agents (org_id, agent_name, agent_type, source, endpoint, runtime_status)
     VALUES ($1, $2, 'external', 'runtime', $3, 'active')
     RETURNING *`,
    [orgId, name, endpoint]
  )
  return result
}
```

---

### 5. Frontend Changes

**File:** `frontend/app/agents/page.tsx`

Show all agents (both protocol and external) in one list:

```tsx
// Filter/Tab to show: All | Platform | Runtime Connected
<Tabs defaultValue="all">
  <TabsList>
    <TabsTrigger value="all">All Agents</TabsTrigger>
    <TabsTrigger value="protocol">Platform Created</TabsTrigger>
    <TabsTrigger value="external">Runtime Connected</TabsTrigger>
  </TabsList>
</Tabs>

// Display agent type badge
{agent.agent_type === 'external' && (
  <Badge variant="outline">Runtime</Badge>
)}
{agent.agent_type === 'protocol' && (
  <Badge variant="secondary">Platform</Badge>
)}
```

**File:** `frontend/app/ai-agents/page.tsx`

Connect runtime flow reuses existing agent:

```typescript
async function handleConnectRuntime(endpoint: string, name: string) {
  // Backend will reuse existing agent if endpoint matches
  const agent = await connectRuntime(orgId, endpoint, name)
  // agent.id is STABLE - doesn't increment on reconnect
}
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `frontend/components/execute/quick-actions.tsx` | Replace actions with 3 buttons only |
| `frontend/lib/external-agents-api.ts` | Add `executeChatMessage`, `connectRuntime` |
| `frontend/components/execute/chat-execution-panel.tsx` | Use new API, remove hardcoded URL |
| `backend/src/migrations.ts` | Add unified agent migration |
| `backend/src/services/agentService.ts` | Add connectRuntime with upsert |
| `backend/src/routes/agents.ts` | Support unified agent model |
| `frontend/app/agents/page.tsx` | Show all agents with type filter |
| `frontend/app/ai-agents/page.tsx` | Use connectRuntime for stable IDs |

---

## Testing Checklist

### Quick Actions
- [ ] Only 3 buttons: Send Transaction, Batch Transactions, Custom
- [ ] Buttons work without errors
- [ ] Template text pre-fills correctly

### Chat Flow
- [ ] Chat sends message to backend `/external/:id/execute`
- [ ] Backend forwards to correct runtime based on agent's endpoint
- [ ] Returns AI response to chat
- [ ] Transactions check whitelist before execution

### Unified Agent IDs
- [ ] All agents show in `/agents` page
- [ ] Type badge shows correctly (Platform/Runtime)
- [ ] Reconnecting runtime reuses existing ID
- [ ] No more "External Agent X connected to Protocol Agent Y"

### Runtime Compatibility
- [ ] Works with local runtime (port 3002)
- [ ] Works with Lambda runtime
- [ ] Works with Cloudflare Workers
- [ ] Works with self-hosted runtime

---

## Out of Scope

- Changing smart contracts
- Adding new transaction types
- Wallet signature flow changes
- Runtime server code changes
