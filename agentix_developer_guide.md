# AgentIX Developer Guide

## What is AgentIX?

AgentIX is the Runtime Authority Layer for Autonomous AI Systems. It answers:

- **WHO** can act? → Credentials and identity
- **WHAT** can they do? → Capabilities and permissions
- **WHEN** can they do it? → Sessions and expiry
- **HOW MUCH** can they spend? → Budgets and limits
- **FOR HOW LONG** can they operate? → Time bounds
- **UNDER WHAT CONSTRAINTS** can they execute? → Policies and scope

## Quick Start (5 minutes)

### 1. Install Dependencies

```bash
# Clone the repo
git clone https://github.com/your-org/agentix.git
cd agentix

# Install all dependencies
npm run install:all

# Set up environment
cp .env.example backend/.env
# Edit backend/.env with your config
```

### 2. Start Local Development

```bash
# Start backend + frontend
npm run dev

# Backend: http://localhost:3001
# Frontend: http://localhost:3000
```

### 3. Create Your First Agent

```typescript
import { AgentClient } from "@agentix/sdk";

const client = new AgentClient("http://localhost:3001");
await client.init();

// Register an agent
const result = await client.registerAgent({
  agentName: "My First Agent",
  orgId: 1,
  permissions: 255, // All permissions
  expiry: Math.floor(Date.now() / 1000) + 86400, // 24 hours
});

console.log("Agent registered:", result.agentId);
```

## Architecture Overview

```
Organization → Users → Agents → Sessions → Execution
     │            │         │          │          │
     ▼            ▼         ▼          ▼          ▼
   (DB)        (JWT)    (On-chain)  (On-chain)  (On-chain)
```

### Key Concepts

1. **Credentials** — ZK-provable ownership of agent identity
2. **Sessions** — Bounded execution windows with spend limits
3. **Capabilities** — Named permissions (e.g., "transfer", "vote")
4. **Delegation** — Hierarchical authority transfer via Merkle trees
5. **Wallets** — ERC-4337 smart contract wallets for agents

## SDK Reference

### AgentClient

```typescript
import { AgentClient } from "@agentix/sdk";

const client = new AgentClient(apiUrl);
await client.init();

// Register agent with credential
const { agentId, commitment } = await client.registerAgent({
  agentName: "Trading Bot",
  orgId: 1,
  permissions: 255,
  expiry: Math.floor(Date.now() / 1000) + 86400,
});

// Create session
const session = await client.createSession({
  agentId,
  orgId: 1,
  permissions: 255,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  maxValue: "1000000000000000000", // 1 ETH in wei
});

// Generate ZK proof
const proof = await client.generateProof({
  agentId,
  orgId: 1,
  permissions: 255,
  expiry: session.expiry,
  sessionKey: session.sessionKey,
  maxValue: session.maxValue,
});

// Verify proof locally
const valid = await client.verifyProof(proof);
console.log("Proof valid:", valid);
```

### SessionManager

```typescript
import { SessionManager } from "@agentix/sdk";

const manager = new SessionManager(apiUrl, secret);

// Generate ZK proof client-side
const proof = await manager.generateProof({
  agentId: 1,
  orgId: 1,
  permissions: 255,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  maxValue: "1000000000000000000",
});

// Submit session to backend
const session = await manager.submitSession(proof);
```

## API Reference

### Authentication

All API requests require one of:

1. **JWT Token** — `Authorization: Bearer <token>`
2. **API Key** — `X-API-Key: <key>`
3. **Wallet Signature** — Custom headers for external agents

### Endpoints

#### Organizations

```
POST   /api/orgs              — Create organization
GET    /api/orgs              — List organizations (requires auth)
GET    /api/orgs/:id          — Get organization
```

#### Agents

```
POST   /api/agents            — Create agent
GET    /api/agents            — List agents
GET    /api/agents/:id        — Get agent
DELETE /api/agents/:id        — Delete agent
```

#### Sessions

```
POST   /api/sessions          — Create session
GET    /api/sessions/:id      — Get session
POST   /api/sessions/:id/revoke — Revoke session
```

#### External Agents

```
POST   /api/external/agents           — Create external agent
GET    /api/external/agents           — List external agents
GET    /api/external/agents/:id       — Get external agent
POST   /api/external/agents/:id/sessions — Create session
POST   /api/external/agents/:id/proof    — Generate proof
```

#### Credentials

```
POST   /api/credentials/issue    — Issue credential
POST   /api/credentials/revoke   — Revoke credential
GET    /api/credentials/:agentId — Get agent credentials
```

## Smart Contract Interaction

### Deployed Contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| Groth16Verifier | `0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424` |
| CredentialRegistry | `0xC3F474e08Fe68bBa39daCCE52FC4F11262364701` |
| SessionManager | `0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2` |
| AgentWalletFactory | `0x36ECC27acd245dbac23Ca1bC72798E75BfbA4a84` |
| CapabilityRegistry | `0xa3166c63920305B7fBE11f97683B99F239bC7975` |
| DelegationManager | `0x355b30477125c6a2F1323095baf99D3781bABd3B` |

### Creating a Session (On-chain)

```typescript
import { ethers } from "ethers";

const SessionManager = new ethers.Contract(
  SESSION_MANAGER_ADDRESS,
  SessionManagerABI,
  signer
);

// Create lightweight session (owner-signed)
const tx = await SessionManager.createLightweightSession(
  sessionId,
  sessionKey,
  dailySpendLimit,
  dailyTxLimit,
  expiry,
  ownerSignature
);
await tx.wait();
```

### Validating a Session (On-chain)

```typescript
// Called by AgentWallet during execution
const valid = await SessionManager.validateSession(
  sessionId,
  signer,
  value
);
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `RPC_URL` | Ethereum RPC URL (Alchemy/Infura) |
| `PRIVATE_KEY` | Operator wallet private key |
| `SESSION_MANAGER_ADDRESS` | Deployed SessionManager address |
| `CREDENTIAL_REGISTRY_ADDRESS` | Deployed CredentialRegistry address |
| `AGENT_WALLET_FACTORY_ADDRESS` | Deployed AgentWalletFactory address |
| `VERIFIER_ADDRESS` | Deployed Groth16Verifier address |
| `SESSION_ENCRYPTION_KEY` | AES-256-GCM key (64 char hex) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend port | 3001 |
| `REDIS_URL` | Redis connection | redis://localhost:6379 |
| `ENABLE_PROOF_QUEUE` | Enable Bull queue | true |
| `ENABLE_EVENT_SYNC` | Enable event sync | true |
| `CORS_ORIGIN` | Allowed origins | http://localhost:3000 |
| `MCP_API_KEY` | MCP SSE auth key | (required in prod) |
| `ENCRYPTION_KEY` | API key encryption | (required in prod) |

## Deployment

### Local Development

```bash
docker-compose up -d
npm run dev
```

### Production

```bash
# Build
npm run build

# Deploy contracts (if needed)
cd contracts && npx hardhat run scripts/deploy-all.ts --network baseSepolia

# Start services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Docker

```bash
# Build images
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
```

## Troubleshooting

### "No prover backend available"
- Ensure circuit files exist in `circuits/build/`
- Run `cd circuits && npm run build` to compile circuits

### "SESSION_ENCRYPTION_KEY must be set"
- Set the env var: `SESSION_ENCRYPTION_KEY=$(openssl rand -hex 32)`

### "SQL injection" errors
- Ensure using PostgreSQL, not SQLite
- Check `DATABASE_URL` points to PostgreSQL

### Session validation fails
- Check session hasn't expired
- Check session hasn't been revoked
- Check signer matches session key
- Check spend limit not exceeded

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Run tests: `npm test`
5. Submit pull request

## Support

- Documentation: `/docs`
- Issues: GitHub Issues
- Discord: [AgentIX Community]
