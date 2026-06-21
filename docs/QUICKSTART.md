# AgentIX × Covenant — Quick Start

**Give AI agents temporary, revocable authority to perform economic actions.**

## 5-Minute Setup

### 1. Install

```bash
git clone <repo-url> && cd AGENT_CREDENTIAL
npm install
```

### 2. Configure

```bash
npm run setup
```

This walks you through setting `.env` for:
- PostgreSQL connection
- Base Sepolia RPC URL
- Deployer private key
- Encryption key

### 3. Start

```bash
npm run dev:backend
```

Backend runs on `http://localhost:3000`.

### 4. Run the Demo

```bash
npm run demo
```

This executes the full flow:
1. Creates an organization and agent
2. Issues a credential with permissions
3. Creates a session with budget and expiry
4. Authorizes and creates a Covenant task
5. Submits work and settles the task
6. Views the audit trail
7. Tests security (budget exceeded, wrong org, revoked session)

### 5. Run Security Tests

```bash
bun test tests/covenant-security.test.ts
```

## Core Concepts

| Concept | What it is |
|---------|-----------|
| **Session** | Temporary authority for an agent to act on behalf of an org |
| **Credential** | On-chain identity with permission bits and expiry |
| **Budget** | Maximum value an agent can spend per session |
| **Permission** | Bitfield controlling what actions an agent can perform |
| **Revocation** | Immediate invalidation of a session or credential |
| **Audit Trail** | Every action logged with user, org, agent, session, tx hash |

## API Reference

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions` | Create a session |
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/proof/:agentId` | Get Merkle proof for session |

### Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/credentials` | Issue a credential |
| `GET` | `/credentials` | List credentials |
| `POST` | `/credentials/revoke` | Revoke a credential |

### Covenant Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/covenant/authorize` | Validate session for Covenant action |
| `POST` | `/covenant/task` | Create a Covenant task |
| `POST` | `/covenant/task/:id/submit` | Submit work |
| `POST` | `/covenant/task/:id/complete` | Complete task (settlement) |
| `POST` | `/covenant/task/:id/dispute` | Dispute a task |
| `GET` | `/covenant/task/:id` | Get task details |
| `GET` | `/covenant/audit` | Get audit trail |

### Headers for Covenant Routes

```
x-covenant-session-id: <session_id>
x-covenant-agent-id: <agent_id>
x-covenant-org-id: <org_id>
```

## Permission Bitfield

| Bit | Permission | Description |
|-----|-----------|-------------|
| 0 | `read_file` | Read files |
| 1 | `write_file` | Write files |
| 2 | `execute_command` | Execute commands |
| 3 | `query` | Query data |
| 4 | `api_call` | Call APIs (create_task) |
| 5 | `sign_transaction` | Sign transactions (fund_task, complete_task) |
| 6 | `deploy_contract` | Deploy contracts |
| 7 | `custom` | Custom actions |

Example: `0b01111111` = all permissions (255)

## Example: Create a Session

```typescript
import { AgentClient } from "agentix-sdk"

const client = new AgentClient("http://localhost:3000")
await client.init()

// Issue credential
await client.registerCredential({
  agentId: 1,
  orgId: 1,
  permissions: 0b01111111,
  expiry: Math.floor(Date.now() / 1000) + 86400,
})

// Create session
const manager = client.sessionManager()
const wallet = manager.createSessionWallet()
const proof = await manager.fetchMerkleProof(1)
const zk = await manager.generateProof(1, 1, 0b01111111, Math.floor(Date.now() / 1000) + 86400, Date.now(), proof)
const session = await manager.submitSession(1, zk, wallet.address)
```

## Example: Execute a Covenant Task

```typescript
// Authorize
const auth = await fetch("http://localhost:3000/covenant/authorize", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-covenant-session-id": sessionId,
    "x-covenant-agent-id": "1",
    "x-covenant-org-id": "1",
  },
  body: JSON.stringify({
    sessionId,
    agentId: 1,
    action: "create_task",
    value: 0.001,
  }),
}).then(r => r.json())

if (!auth.authorized) throw new Error(auth.error)

// Create task
const task = await fetch("http://localhost:3000/covenant/task", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-covenant-session-id": sessionId,
    "x-covenant-agent-id": "1",
    "x-covenant-org-id": "1",
  },
  body: JSON.stringify({
    worker: "0x...",
    payment: "0.001",
    deadline: Math.floor(Date.now() / 1000) + 86400,
    metaHash: "0x...",
  }),
}).then(r => r.json())
```

## What's Next

- [Production Checklist](./PRODUCTION_CHECKLIST.md)
- [Architecture](./ARCHITECTURE.md)
- [Security Report](./SECURITY_REPORT.md)
