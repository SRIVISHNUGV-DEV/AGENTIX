# Chat Panel Redesign Spec

**Date:** 2026-05-18
**Status:** Design Approved
**Scope:** Fix chat panel to work with any connected runtime, simplify quick actions

---

## Problem Statement

The chat execution panel has several issues:

1. **Broken chat flow** - Not connecting to runtime endpoints properly
2. **Non-functional quick actions** - Actions like "Execute Command", "Read File", "Query", "Deploy Contract" are not implemented
3. **Hardcoded to local runtime** - Should work with any connected runtime (local, Lambda, Cloudflare Workers, etc.)

---

## Design Goals

1. Chat works with **any connected runtime** (not just localhost:3002)
2. Quick actions show only **what the protocol can actually do**
3. Clean API path: Frontend → Backend → Runtime
4. Proper error handling and connection status

---

## Architecture

### Runtime-Agnostic Design

The chat panel must not hardcode runtime URLs. Instead:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐
│   Frontend  │────▶│   Backend   │────▶│   Runtime (any type)    │
│  Chat Panel │     │   Port 3001 │     │ • Local (:3002)         │
│             │     │             │     │ • Lambda (Function URL) │
│             │     │             │     │ • Cloudflare Workers   │
└─────────────┘     └─────────────┘     │ • Self-hosted           │
                          │             └─────────────────────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │  Database   │
                    │ (PostgreSQL)│
                    └─────────────┘
```

**Key insight:** The backend knows the runtime endpoint. Frontend only calls backend.

---

## Implementation Details

### 1. Quick Actions (Simplified)

**File:** `frontend/components/execute/quick-actions.tsx`

Replace current actions with protocol-supported actions only:

```typescript
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "send_transaction",
    label: "Send Transaction",
    icon: <Send className="h-4 w-4" />,
    template: "Send ETH to a whitelisted address",
    action: "send_transaction",
    paramsHint: { amount: "0.1", address: "" }
  },
  {
    id: "batch_transactions",
    label: "Batch Transactions",
    icon: <Layers className="h-4 w-4" />,
    template: "Send ETH to multiple whitelisted addresses",
    action: "batch_transactions",
    paramsHint: { amount: "0.1", addresses: [] }
  },
  {
    id: "custom",
    label: "Custom",
    icon: <MessageSquare className="h-4 w-4" />,
    template: "",
    action: "custom",
  }
]
```

**Remove:** `Execute Command`, `Read File`, `API Call`, `Query`, `Deploy Contract`

**Remove:** `MORE_ACTIONS` dropdown (no longer needed)

---

### 2. Chat Execution API

**File:** `frontend/lib/external-agents-api.ts`

Add function to execute chat via backend:

```typescript
/**
 * Send chat message to agent runtime
 * Works with any connected runtime (local, Lambda, etc.)
 * Backend routes to the correct runtime endpoint
 */
export async function executeChatMessage(
  externalAgentId: number,
  message: string,
  orgId: number,
  signature?: SignaturePayload
): Promise<{
  success: boolean
  response?: string
  result?: any
  error?: string
}> {
  const response = await fetch(`${API_BASE_URL}/external/${externalAgentId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'chat',
      params: { message },
      orgId,
      ...signature
    })
  })

  if (!response.ok) {
    throw new Error(`Chat execution failed: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Execute a specific action on the agent runtime
 */
export async function executeAgentAction(
  externalAgentId: number,
  action: string,
  params: Record<string, any>,
  orgId: number,
  signature?: SignaturePayload
): Promise<{
  success: boolean
  response?: string
  result?: any
  error?: string
}> {
  const response = await fetch(`${API_BASE_URL}/external/${externalAgentId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      params,
      orgId,
      ...signature
    })
  })

  if (!response.ok) {
    throw new Error(`Action execution failed: ${response.statusText}`)
  }

  return response.json()
}
```

---

### 3. Chat Panel Component Update

**File:** `frontend/components/execute/chat-execution-panel.tsx`

**Changes:**

1. **Import new API functions:**
```typescript
import { executeChatMessage, executeAgentAction, getRuntimeStatus } from '@/lib/external-agents-api'
```

2. **Remove hardcoded runtime URL:**
```typescript
// REMOVE THIS:
const RUNTIME_URL = 'http://localhost:3002'

// USE THIS: Get runtime status from backend (already connected or not)
const { data: runtimeStatus } = useQuery({
  queryKey: ['runtime-status', agentId],
  queryFn: () => getRuntimeStatus(externalAgentId),
  refetchInterval: 5000 // Poll every 5s
})
```

3. **Handle message sending:**
```typescript
const handleSendMessage = async () => {
  if (!inputMessage.trim() || !externalAgentId) return

  setIsLoading(true)
  addMessage({ role: 'user', content: inputMessage })

  try {
    const result = await executeChatMessage(
      externalAgentId,
      inputMessage,
      orgId,
      signature
    )

    if (result.success) {
      addMessage({ role: 'assistant', content: result.response || 'Action completed' })
      if (result.result) {
        // Show transaction details if applicable
        addMessage({ role: 'system', content: `Result: ${JSON.stringify(result.result, null, 2)}` })
      }
    } else {
      addMessage({ role: 'assistant', content: `Error: ${result.error}` })
    }
  } catch (error: any) {
    addMessage({ role: 'assistant', content: `Failed: ${error.message}` })
  } finally {
    setIsLoading(false)
    setInputMessage('')
  }
}
```

4. **Quick action handler:**
```typescript
const handleQuickAction = (action: QuickAction) => {
  if (action.id === 'custom') {
    setInputMessage('')
    inputRef.current?.focus()
  } else if (action.id === 'send_transaction') {
    setInputMessage(`Send 0.1 ETH to `)
    inputRef.current?.focus()
  } else if (action.id === 'batch_transactions') {
    setInputMessage(`Send 0.05 ETH each to: `)
    inputRef.current?.focus()
  }
}
```

---

### 4. Backend Execute Endpoint (Already Exists)

**File:** `backend/src/routes/externalAgents.ts`

The `POST /:agentId/execute` endpoint already forwards to runtime:

```typescript
router.post("/:agentId/execute", async (req: Request, res: Response) => {
  // 1. Validate agent exists
  // 2. Check runtime endpoint
  // 3. Forward request to runtime
  // 4. Return response
})
```

**No backend changes needed** - this endpoint already routes to the correct runtime based on `external_agents.endpoint` in the database.

---

### 5. Runtime Types

The chat works with any runtime that implements the standard execute endpoint:

| Runtime Type | Endpoint Source | Example |
|--------------|-----------------|---------|
| Local | `http://localhost:3002` | Development |
| Lambda | Function URL from env | Production |
| Cloudflare Workers | Worker URL | Edge deployment |
| Self-hosted | Custom domain | Enterprise |

**All runtimes must implement:** `POST /execute` with `{ action, params, orgId }`

---

## File Changes Summary

| File | Change |
|------|--------|
| `frontend/components/execute/quick-actions.tsx` | Replace actions array, remove dropdown |
| `frontend/lib/external-agents-api.ts` | Add `executeChatMessage`, `executeAgentAction` |
| `frontend/components/execute/chat-execution-panel.tsx` | Use new API, remove hardcoded URL |

---

## Testing Checklist

- [ ] Quick actions show only 3 buttons: Send Transaction, Batch Transactions, Custom
- [ ] Chat sends message to backend `/external/:id/execute`
- [ ] Backend forwards to correct runtime based on agent's endpoint
- [ ] Runtime processes chat and returns response
- [ ] Transaction requests check whitelist
- [ ] Error handling for disconnected runtimes
- [ ] Works with local runtime (port 3002)
- [ ] Works with Lambda runtime (Function URL)
- [ ] Works with any future runtime type

---

## Out of Scope

- Changing the runtime server code (`runtime-local/server.ts`)
- Changing backend execute endpoint (already works)
- Adding new transaction types
- Wallet signature flow changes
