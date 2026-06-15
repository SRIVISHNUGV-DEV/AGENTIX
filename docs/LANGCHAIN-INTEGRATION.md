# LangChain + Agentix Integration Guide

Connect your LangChain agent to Agentix for autonomous on-chain transactions.

## Quick Start (5 minutes)

### 1. Install the SDK

```bash
npm install @agentix/sdk
```

### 2. Register Your Agent

```typescript
import { AgentClient } from "@agentix/sdk"

const client = new AgentClient("http://your-agentix-backend:3000")
await client.init()

// Register agent with the platform
const { agentId, orgId } = await client.registerAgent({
  orgName: "MyOrg",
  agentName: "Treasury Manager",
  permissions: 32, // SIGN_TRANSACTION only
  expiry: Math.floor(Date.now() / 1000) + 86400 * 30 // 30 days
})
```

### 3. Create Wallet + Session

```typescript
// Create ERC-4337 smart wallet
const wallet = await client.createWallet({
  ownerAddress: "0xYourOwnerAddress"
})

// Create session with spend limits
const { session, sessionKey, sessionPrivateKey } = await client.createSession({
  agentId
})
```

### 4. Use in LangChain Agent

```typescript
import { ChatOpenAI } from "@langchain/openai"
import { AgentExecutor, createToolCallingAgent } from "langchain/agents"
import { DynamicTool } from "@langchain/core/tools"

// Create tool for sending transactions
const sendTransactionTool = new DynamicTool({
  name: "send_transaction",
  description: "Send ETH to a whitelisted address",
  func: async (input: string) => {
    const [target, amount] = input.split(",")

    // Sign UserOp with session key
    const userOpHash = await client.signUserOp({
      sessionPrivateKey,
      walletAddress: wallet.address,
      target: target.trim(),
      value: amount.trim()
    })

    // Submit via bundler
    const result = await client.submitUserOp(userOpHash)
    return `Transaction sent: ${result.txHash}`
  }
})

// Create LangChain agent with blockchain tools
const model = new ChatOpenAI({ model: "gpt-4" })
const agent = await createToolCallingAgent({
  llm: model,
  tools: [sendTransactionTool],
})

const executor = new AgentExecutor({ agent, tools: [sendTransactionTool] })

// Run the agent
const result = await executor.invoke({
  input: "Send 0.1 ETH to 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
})
```

## Full Example: Treasury Manager Agent

```typescript
import { AgentClient } from "@agentix/sdk"
import { ChatOpenAI } from "@langchain/openai"
import { AgentExecutor, createToolCallingAgent } from "langchain/agents"
import { DynamicTool } from "@langchain/core/tools"
import { z } from "zod"

// Initialize Agentix client
const client = new AgentClient("http://localhost:3000")
await client.init()

// Register and provision agent
const { agentId } = await client.registerAgent({
  orgName: "Treasury",
  agentName: " Treasury Manager",
  permissions: 32 | 16, // SIGN_TRANSACTION | API_CALL
  expiry: Math.floor(Date.now() / 1000) + 86400 * 30
})

const wallet = await client.createWallet({ ownerAddress: "0xOwner" })
const { sessionPrivateKey } = await client.createSession({ agentId })

// Define LangChain tools
const tools = [
  new DynamicTool({
    name: "send_eth",
    description: "Send ETH to an address. Input format: 'address,amount_in_eth'",
    func: async (input) => {
      const [target, amount] = input.split(",").map(s => s.trim())
      const wei = BigInt(Math.floor(parseFloat(amount) * 10 ** 18)).toString()

      const hash = await client.signUserOp({
        sessionPrivateKey,
        walletAddress: wallet.address,
        target,
        value: wei
      })
      const result = await client.submitUserOp(hash)
      return JSON.stringify({ txHash: result.txHash, status: "sent" })
    }
  }),

  new DynamicTool({
    name: "check_balance",
    description: "Check ETH balance of the agent wallet",
    func: async () => {
      const balance = await client.getBalance(wallet.address)
      return `Balance: ${balance} ETH`
    }
  }),

  new DynamicTool({
    name: "check_whitelist",
    description: "Check if an address is whitelisted",
    func: async (address) => {
      const allowed = await client.isWhitelisted(wallet.address, address)
      return `${address} is ${allowed ? "whitelisted" : "NOT whitelisted"}`
    }
  })
]

// Create agent
const model = new ChatOpenAI({ model: "gpt-4", temperature: 0 })
const agent = await createToolCallingAgent({ llm: model, tools })
const executor = new AgentExecutor({ agent, tools, verbose: true })

// Run
const result = await executor.invoke({
  input: "Send 0.05 ETH to 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
})
```

## WebSocket Connection (Real-time)

For real-time task dispatch from the backend:

```typescript
import WebSocket from "ws"

const ws = new WebSocket("ws://localhost:3001?agentId=123&token=your-token")

ws.on("open", () => {
  console.log("Connected to Agentix backend")
})

ws.on("message", (data) => {
  const message = JSON.parse(data.toString())

  if (message.type === "task") {
    // Backend dispatched a task
    console.log(`Received task: ${message.action}`)

    // Process the task...
    const result = processTask(message.action, message.params)

    // Send result back
    ws.send(JSON.stringify({
      type: "result",
      taskId: message.taskId,
      success: true,
      result
    }))
  }
})

ws.on("close", () => {
  console.log("Disconnected from backend")
  // Reconnect after delay
  setTimeout(connect, 5000)
})
```

## Webhook Mode (Agent → Backend)

If you can't maintain a WebSocket connection, use webhooks:

```typescript
// In your LangChain agent server:

app.post("/execute", async (req, res) => {
  const { action, params } = req.body

  // Process the action
  const result = await processAction(action, params)

  // Send result back to Agentix via webhook
  await fetch("http://agentix-backend:3000/agents/123/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "result",
      taskId: req.body.taskId,
      success: true,
      result
    })
  })

  res.json({ received: true })
})
```

## Required Endpoints

Your agent server must implement:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Connection test (return 200 OK) |
| `/execute` | POST | Receive action requests from Agentix |

### /health Response
```json
{ "status": "ok" }
```

### /execute Request
```json
{
  "taskId": 123,
  "action": "send_transaction",
  "params": {
    "walletAddress": "0x...",
    "target": "0x...",
    "valueWei": "100000000000000000"
  }
}
```

### /execute Response
```json
{
  "success": true,
  "result": {
    "txHash": "0x..."
  }
}
```

## Environment Variables

```bash
# Agentix backend URL
AGENTIX_URL=http://localhost:3000

# Your agent's API key (generated from dashboard)
AGENTIX_API_KEY=ak_...

# WebSocket URL (for real-time mode)
AGENTIX_WS_URL=ws://localhost:3001
```

## Security Notes

- Never expose session private keys in logs or responses
- Use environment variables for all secrets
- The session key signs transactions — if compromised, revoke the session immediately
- Set appropriate daily spend/tx limits during session creation
- Use the whitelist to restrict which addresses your agent can interact with
