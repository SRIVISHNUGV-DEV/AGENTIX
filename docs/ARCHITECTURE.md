# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Developer                            │
│                    (npm install → demo)                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     AgentIX Backend                         │
│                  (Express.js + PostgreSQL)                   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Sessions │  │Credentials│  │  Agents  │  │   Orgs   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Covenant Integration Layer               │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │   Session   │  │    Budget    │  │   Wallet   │  │  │
│  │  │  Validator  │  │   Tracker    │  │  Manager   │  │  │
│  │  └─────────────┘  └──────────────┘  └────────────┘  │  │
│  │  ┌─────────────┐  ┌──────────────┐                  │  │
│  │  │   Covenant  │  │   Middleware  │                  │  │
│  │  │   Client    │  │  (auth+audit) │                  │  │
│  │  └─────────────┘  └──────────────┘                  │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  AgentIX │ │ Covenant │ │ Base     │
        │  Contracts│ │ Contracts│ │ Sepolia  │
        └──────────┘ └──────────┘ └──────────┘
```

## Data Flow

### 1. Session Creation

```
Developer → AgentIX Backend → PostgreSQL
  1. Create org
  2. Create agent
  3. Issue credential (permission bits + expiry)
  4. Create session (budget + expiry)
  5. Return session ID
```

### 2. Task Execution

```
Developer → AgentIX Backend → Covenant Client → On-Chain
  1. Authorize session (validate permissions, budget, expiry)
  2. Deduct budget (atomic)
  3. Create Covenant task (on-chain)
  4. Log audit entry
  5. Return task ID + tx hash
```

### 3. Settlement

```
Developer → AgentIX Backend → Covenant Client → On-Chain
  1. Authorize session
  2. Submit work (on-chain)
  3. Complete task (on-chain)
  4. Log audit entry
  5. Return settlement tx hash
```

### 4. Revocation

```
Developer → AgentIX Backend → PostgreSQL + On-Chain
  1. Add nullifier to revoked set
  2. Update revocation tree root on-chain
  3. All future session checks fail instantly
```

## Security Model

### Session Validation (per request)

1. **Org binding**: Session must match the requesting org
2. **Expiry check**: Session must not be expired
3. **Revocation check**: Nullifier must not be in revoked set
4. **Credential check**: Agent must have a valid credential
5. **Credential expiry**: Credential must not be expired
6. **Permission check**: Action must be in permission bitfield
7. **Budget check**: Requested value must not exceed remaining budget

### Budget Enforcement

- **Atomic deduction**: DB-level `WHERE (total_budget - spent) >= amount`
- **Redis fallback**: Lua script for atomic decrement
- **Concurrent safe**: Second request gets rejected if budget exhausted

### Audit Trail

Every mutation logs:
- `org_id` — which organization
- `user_id` — which user
- `action` — what was done
- `resource_type` — what kind of resource
- `resource_id` — which resource
- `details` — JSON with session, agent, tx hash, success/failure

## On-Chain vs Off-Chain

| On-Chain | Off-Chain |
|----------|-----------|
| Credential commitments | Session validation |
| Revocation tree roots | Permission checks |
| Task escrow | Budget tracking |
| Task settlement | Rate limiting |
| Dispute resolution | Audit logging |
| Agent identity | Analytics |
| Capability grants | Risk scoring |

## Contract Addresses (Base Sepolia)

### AgentIX

| Contract | Address |
|----------|---------|
| Groth16Verifier | `0x1Baae590586170A8779b31186757DaDbcaE94f57` |
| CredentialRegistry | `0xaC0A72FaAF2596DD55A20049F0ab7584b58b3DEE` |
| SessionManager | `0x27532B3B2d0704715D5e81BDa8B0D272675751d1` |
| AgentWalletFactory | `0x9e6B32F7da3ef2C2dD1337757FbC25Eb72FdFfE3` |
| CapabilityRegistry | `0xa9ff494D1047bC9399858394B95aCf7066740aFC` |
| DelegationManager | `0x73f8591ccCdBfE1595aA4d2160e8F166E0243E38` |

### Covenant

| Contract | Address |
|----------|---------|
| CovenantIdentity | `0xB93eCF2bD8DE0e35ddAD13D9F00E70b938C18FdF` |
| CovenantEscrow | `0xDb9F26155192c685BEC75E86A7c70A3ca0F80Ac3` |
| CovenantSettlement | `0xBB3deBA10b0bDaa79c9384E39cDd899116082939` |
| CovenantArbitration | `0x874d2D6Aa857685D1B7786db2eF9C32C0AcfB614` |
| CovenantGovernance | `0xd505b5CA3dB39d04592D51DB51507550e0d878DF` |
| CovenantAttestation | `0x65804fb982Be86C48E03107963FDAcd285f21540` |

## File Structure

```
AGENT_CREDENTIAL/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Express server entry
│   │   ├── db.ts                       # PostgreSQL wrapper
│   │   ├── migrations.ts               # Schema migrations
│   │   ├── routes/
│   │   │   ├── sessions.ts             # Session CRUD
│   │   │   ├── credentials.ts          # Credential CRUD
│   │   │   ├── covenant.ts             # Covenant integration routes
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── session.ts              # Session ID generation
│   │   │   ├── audit.ts                # Audit logging
│   │   │   ├── blockchain.ts           # On-chain interactions
│   │   │   └── ...
│   │   ├── integrations/
│   │   │   └── covenant/
│   │   │       ├── covenant-client.ts  # Covenant contract client
│   │   │       ├── session-validator.ts# Session validation
│   │   │       ├── budget-tracker.ts   # Budget enforcement
│   │   │       ├── wallet-manager.ts   # Per-agent wallets
│   │   │       ├── middleware.ts       # Express middleware
│   │   │       └── types.ts           # Shared types
│   │   └── middleware/
│   │       ├── auth.ts                 # JWT auth
│   │       └── security.ts            # Rate limit, helmet, CORS
│   └── tests/
│       └── covenant-security.test.ts  # Security test suite
├── sdk/
│   └── src/
│       ├── index.ts                    # SDK exports
│       ├── SessionManager.ts          # ZK proof generation
│       └── AgentClient.ts             # API client
├── contracts/
│   └── src/
│       ├── SessionManager.sol         # On-chain session management
│       ├── CredentialRegistry.sol     # On-chain credential registry
│       └── ...
├── demo.mjs                           # One-command demo
└── docs/
    ├── QUICKSTART.md
    ├── PRODUCTION_CHECKLIST.md
    ├── ARCHITECTURE.md
    └── SECURITY_REPORT.md
```
