# AgentIX + Covenant — Quick Start

> "Give AI agents temporary, revocable authority to perform economic actions."

## What This Does

AgentIX handles **authorization** (who can do what, with what budget, until when).
Covenant handles **execution** (create task, escrow funds, settle, dispute).

Together: your AI agent gets a temporary session with a spending limit, executes a Covenant task, and every action is audited.

## 5-Minute Setup

### 1. Install

```bash
git clone <repo-url> && cd AGENT_CREDENTIAL
npm install
```

### 2. Start Backend

```bash
# Terminal 1: Start PostgreSQL (if not running)
docker run -e POSTGRES_USER=agentix -e POSTGRES_PASSWORD=agentix-secret -e POSTGRES_DB=agentix -p 5432:5432 postgres:16

# Terminal 2: Start backend
cd backend
cp .env.example .env  # Edit with your RPC_URL, PRIVATE_KEY, ENCRYPTION_KEY
npx tsx src/index.ts
```

### 3. Run Demo

```bash
node scripts/demo-covenant-flow.mjs
```

This runs the full flow:
1. Register agent + credential
2. Create wallet
3. Create session (budget + expiry)
4. Authorize Covenant action
5. Create task with escrow
6. Submit work
7. Complete task (settlement)
8. View audit trail
9. Revoke session
10. Verify revocation

## SDK Usage

```typescript
import { AgentClient } from "@agentix/sdk";

const client = new AgentClient("http://localhost:3000");
await client.init();

// 1. Register agent
const { agentId, orgId } = await client.registerAgent({
  orgName: "My Org",
  agentName: "My Agent",
  permissions: 0b01100101,  // read + write + sign_tx + create_task
  expiry: Math.floor(Date.now() / 1000) + 86400
});

// 2. Create session
const { session } = await client.createSession({ agentId, orgId });

// 3. Create Covenant task (via integration)
const res = await fetch("http://localhost:3000/covenant/task", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-covenant-session-id": session.sessionId,
    "x-covenant-agent-id": String(agentId),
    "x-covenant-org-id": String(orgId),
  },
  body: JSON.stringify({
    worker: "0x...",
    payment: "0.01",
    deadline: Math.floor(Date.now() / 1000) + 3600,
    metaHash: "0x0000...0000"
  })
});

// 4. Revoke when done
await client.revokeAgent(agentId);
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/covenant/authorize` | POST | Check if session can perform action |
| `/covenant/task` | POST | Create task with escrow |
| `/covenant/task/:id/submit` | POST | Submit work deliverable |
| `/covenant/task/:id/complete` | POST | Complete task (settlement) |
| `/covenant/task/:id/dispute` | POST | Dispute task |
| `/covenant/audit` | GET | View audit trail |
| `/credentials` | POST | Issue credential |
| `/credentials/revoke` | POST | Revoke credential |
| `/sessions` | POST | Create session |

## Headers for Covenant Routes

```
x-covenant-session-id: <session_id>
x-covenant-agent-id: <agent_id>
x-covenant-org-id: <org_id>
```

## Permission Bits

| Bit | Permission | Covenant Action |
|-----|-----------|-----------------|
| 1 | read_file | — |
| 2 | write_file | — |
| 4 | execute_command | — |
| 8 | query | — |
| 16 | api_call / create_task | create_task |
| 32 | sign_transaction / fund_task | fund_task, complete_task, dispute_task |
| 64 | deploy_contract / register_agent | register_agent, deactivate_agent, grant/revoke_capability |

## What's On-Chain vs Off-Chain

**On-chain (Base Sepolia):**
- Credential commitments (Merkle tree)
- Revocation commitments (Sparse Merkle tree)
- Session validation (SessionManager contract)
- Escrow (CovenantEscrow)
- Settlement (CovenantSettlement)
- Disputes (CovenantArbitration)

**Off-chain:**
- Session validation + authorization checks
- Budget tracking (Redis or PostgreSQL)
- Audit logging
- Rate limiting
- Analytics

## Environment Variables

See `backend/.env.example` for full list. Minimum required:

```
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=your-wallet-private-key
ENCRYPTION_KEY=64-hex-chars
DATABASE_URL=postgresql://agentix:agentix-secret@localhost:5432/agentix
```

## Next Steps

- Read [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) before deploying
- Read [SECURITY_REPORT.md](./SECURITY_REPORT.md) for threat model
- Check [FUTURE_ROADMAP.md](./FUTURE_ROADMAP.md) for planned features
