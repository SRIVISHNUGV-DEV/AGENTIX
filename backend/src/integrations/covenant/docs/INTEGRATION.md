# AgentIX ↔ Covenant Integration

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENTIX (Control Layer)                   │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Sessions    │  │ Credentials  │  │ Authorization    │  │
│  │  (ZK proofs) │  │ (Merkle)     │  │ (Permission bits)│  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                │                    │             │
│  ┌──────┴────────────────┴────────────────────┴─────────┐  │
│  │              Integration Layer                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ covenant/    │  │ session-     │  │ middleware  │  │  │
│  │  │ client       │  │ validator    │  │            │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │  │
│  └─────────┼─────────────────┼─────────────────┼─────────┘  │
│            │                 │                 │             │
└────────────┼─────────────────┼─────────────────┼────────────┘
             │                 │                 │
             ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   COVENANT (Execution Layer)                 │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Identity     │  │  Escrow      │  │  Settlement      │  │
│  │  (on-chain)   │  │  (on-chain)  │  │  (on-chain)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Arbitration  │  │ Governance   │  │  Attestation     │  │
│  │  (on-chain)   │  │  (on-chain)  │  │  (on-chain)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Integration Flow

### 1. Session Creation (AgentIX)
```
User → AgentIX: Create session with spending limits
AgentIX → ZK Prover: Generate Groth16 proof
AgentIX → SessionManager Contract: Create on-chain session
AgentIX → User: Return session ID + proof
```

### 2. Covenant Task Authorization
```
Agent → AgentIX: Request authorization for Covenant task
AgentIX → SessionValidator: Validate session + permissions
SessionValidator → Check: Session valid, not expired, sufficient budget
SessionValidator → Check: Agent has permission for action
AgentIX → Agent: Return authorization + spending limit
```

### 3. Covenant Task Execution
```
Agent → CovenantClient: Create task (worker, payment, deadline)
CovenantClient → CovenantEscrow Contract: createTask() + fundTask()
CovenantClient → AuditLog: Record action with session context
CovenantClient → Agent: Return task ID + tx hash
```

### 4. Settlement
```
Agent → CovenantClient: Submit work
CovenantClient → CovenantEscrow: submitWork()
Client → CovenantClient: Complete task
CovenantClient → CovenantEscrow: completeTask() → payment released
CovenantClient → AuditLog: Record settlement
```

## Files Modified

### AGENTIX (new files)
- `backend/src/integrations/covenant/types.ts` — Type definitions
- `backend/src/integrations/covenant/covenant-client.ts` — Direct contract calls
- `backend/src/integrations/covenant/session-validator.ts` — Session validation
- `backend/src/integrations/covenant/middleware.ts` — Express middleware
- `backend/src/integrations/covenant/index.ts` — Barrel exports
- `backend/src/routes/covenant.ts` — REST API routes

### AGENTIX (modified files)
- `backend/src/index.ts` — Mount covenant routes (2 lines added)

### COVENANT (new files)
- `mcp/src/rest/adapter.ts` — REST adapter wrapping MCP tools

### COVENANT (NOT modified)
- All core contracts
- All MCP tools
- All SDK classes
- All CLI commands

## Environment Variables

```bash
# AGENTIX backend/.env
COVENANT_API_URL=http://localhost:3001
COVENANT_API_KEY=your-covenant-api-key
COVENANT_CHAIN_ID=84532

# COVENANT mcp/.env (existing)
MCP_API_KEY=your-mcp-api-key
PRIVATE_KEY=your-private-key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

## API Endpoints

### AgentIX Integration Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/covenant/health` | Check Covenant connectivity |
| POST | `/covenant/authorize` | Validate session for Covenant action |
| POST | `/covenant/task` | Create task (authorized) |
| POST | `/covenant/task/:id/submit` | Submit work (authorized) |
| POST | `/covenant/task/:id/complete` | Complete task (authorized) |
| POST | `/covenant/task/:id/dispute` | Dispute task (authorized) |
| GET | `/covenant/task/:id` | Get task details |
| GET | `/covenant/agent/:address` | Get agent profile |
| GET | `/covenant/audit` | Get audit trail |

### Request Headers (for authorized endpoints)
```
x-covenant-session-id: <session-id>
x-covenant-agent-id: <agent-id>
x-covenant-org-id: <org-id>
Authorization: Bearer <agentix-token>
```

## Permission Mapping

| AgentIX Permission | Bit | Covenant Actions |
|-------------------|-----|------------------|
| READ_FILE | 1 | get_task, get_agent |
| WRITE_FILE | 2 | submit_work |
| EXECUTE_COMMAND | 4 | submit_work |
| QUERY | 8 | submit_work |
| API_CALL | 16 | create_task, fund_task |
| SIGN_TRANSACTION | 32 | complete_task, dispute_task |
| DEPLOY_CONTRACT | 64 | register_agent, grant_capability |
| CUSTOM | 128 | (reserved) |

## Spending Limits

Session `maxValue` maps to Covenant payment limits:
- Session maxValue = $100 → Can create tasks up to $100
- Session maxValue = $10,000 → Can create tasks up to $10,000
- Individual task payments checked against session budget

## Audit Trail

Every Covenant action executed through AgentIX is logged:
- Session ID
- Agent ID
- Org ID
- User ID
- Action type
- Covenant result (success/fail)
- Transaction hash
- Timestamp

## Security

1. **Session Validation**: Every Covenant action validates AgentIX session
2. **Permission Checks**: Agent must have correct permission bits
3. **Spending Limits**: Session budget enforced per-action
4. **Nullifier Replay**: ZK nullifiers prevent proof reuse
5. **Signed Actions**: Critical operations require Ethereum signatures
6. **Audit Logging**: All actions immutably logged
