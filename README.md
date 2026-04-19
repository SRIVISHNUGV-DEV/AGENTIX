# Agentix

A protocol and operator platform for issuing private credentials to AI agents, proving authorization with zero knowledge, and creating on-chain sessions under explicit policy control.

---

## What it does

Organizations connect a wallet, deploy an isolated contract stack, register agents, and issue credentials. Agents prove authorization via a Groth16 ZK proof without ever exposing raw credential data. Sessions are opened on-chain only when the proof verifies.

Every platform action requires a wallet signature. Credentials are stored as commitments. Sessions are gated by ZK proof. Access is revocable at any time.

---

## Why this matters

Most AI agent authorization systems rely on public allowlists, shared registries, or static API keys. Agentix gives each organization its own isolated contract stack, replaces public identity with private credential commitments, and enforces access policy in a circuit rather than in application code. The result is an agent that can prove it is authorized without revealing which agent it is.

---

## Architecture

```
agentix/
├── frontend/    Next.js operator platform
├── backend/     Express API, SQLite, proof orchestration, event sync
├── circuits/    Circom credential circuit and proving artifacts
├── contracts/   Solidity protocol contracts
├── sdk/         Self-hosted SDK
└── docs/        Setup, API, and architecture documentation
```

**Frontend** — Next.js application. Organizations connect a wallet, manage workspaces, create agents, issue credentials, and inspect indexed on-chain events.

**Backend** — Express + SQLite service. Persists organizations, agents, credentials, wallets, sessions, and events. Maintains the active Poseidon Merkle tree and the revocation sparse tree. Deploys contracts, submits root updates, indexes contract events.

**Circuits** — Circom 2.1.0 circuit. Proves credential membership in the active root, non-revocation against the revocation root, expiry and permission constraints, and nullifier derivation for replay protection.

**Contracts** — Per-organization: `CredentialRegistry`, `SessionManager`, `AgentWalletFactory`. Shared: `Verifier` (Groth16), `AgentWallet` (ERC-4337 implementation).

---

## System flow

```
Org wallet → Frontend ⇄ Backend → Circuits + contracts → Events
                                         ↑                   |
                                         └───────────────────┘
```

The backend maintains the Merkle tree, builds proof inputs, and submits transactions. Events emitted by the contracts are indexed back into SQLite and surfaced in the frontend.

---

## Session creation flow

```
Organization          Frontend           Backend            Circuit/Prover      SessionManager
     │                    │                  │                     │                   │
     │  connect wallet     │                 │                     │                   │
     │────────────────────▶│                 │                     │                  │
     │                     │  issue credential│                     │                  │
     │                     │─────────────────▶│                     │                  │
     │                     │                  │  update Merkle root │                   │
     │                     │                  │◀───────────────────▶│                  │
     │                     │                  │  build proof inputs │                   │
     │                     │                  │────────────────────▶│                   │
     │                     │                  │  Groth16 proof      │                    │
     │                     │                  │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─│                     │
     │                     │                  │  createSession(proof, signals)           │
     │                     │                  │──────────────────────────────────────────▶
     │                     │                  │  SessionCreated event                    │
     │                     │                  │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
     │                     │  indexed state   │                     │                   │
     │◀────────────────────│◀─────────────────│                     │                   │
```

---

## ZK credential circuit

The circuit (`circuits/credential.circom`) enforces four constraints simultaneously:

**Membership** — The agent's credential commitment is a valid leaf in the active Poseidon Merkle tree, proving the credential was legitimately issued.

**Non-revocation** — A sparse Merkle tree verifier confirms the credential is absent from the revocation set. A revoked agent cannot generate a valid proof.

**Policy** — `LessEqThan` comparators verify the credential has not expired and that requested permissions fall within the granted bitmask.

**Nullifier** — `Poseidon([secret, sessionId])` is derived inside the circuit. The `SessionManager` stores used nullifiers, making proof replay impossible.

Private inputs (never revealed): secret, credential fields, path elements, revocation siblings.  
Public inputs (verified on-chain): active root, revoked root, nullifier, session ID, max value, expiry.

---

## Per-organization isolation

Each organization gets its own `CredentialRegistry`, `SessionManager`, and `AgentWalletFactory`. Roots are organization-scoped. An agent from one organization cannot prove membership in another organization's credential tree. The shared `Verifier` contract and wallet implementation are the only shared infrastructure.

---

## ERC-4337 wallet flow

Agentix supports full ERC-4337 `UserOperation` execution for agent wallets:

1. Backend constructs the `UserOperation` calldata
2. `userOpHash` is computed via the `EntryPoint`
3. Organization owner signs the hash in the frontend
4. Backend submits to the configured bundler
5. Receipt is fetched and the event is indexed

Required backend environment variables: `ENTRY_POINT_ADDRESS`, `BUNDLER_URL`.

---

## Getting started

**Prerequisites:** Node.js 18+, a funded Sepolia wallet.

```bash
git clone https://github.com/your-org/agentix.git
cd agentix
npm install --workspaces
```

Copy and fill in environment files:

```bash
# backend/.env
PRIVATE_KEY=0x...
RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
DATABASE_PATH=./db/agentix.sqlite
ENTRY_POINT_ADDRESS=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
BUNDLER_URL=https://...
```

```bash
# frontend/.env.local
AGENT_CREDENTIALS_API_URL=http://localhost:3000
NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=http://localhost:3000
```

Start both services:

```bash
npm run dev
```

| Service  | URL                   |
|----------|-----------------------|
| Frontend | http://127.0.0.1:3001 |
| Backend  | http://127.0.0.1:3000 |

---

## API reference

All state-mutating endpoints require a signed action payload:

```json
{
  "walletAddress": "0x...",
  "signature": "0x...",
  "nonce": "unique-string",
  "requestedAt": 1774190000
}
```

The signed message commits to: action, org ID, target, wallet address, nonce, timestamp, and chain ID.

**Organizations**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/orgs` | — | List organizations |
| POST | `/orgs` | — | Create organization |
| GET | `/orgs/:orgId/state` | — | Full workspace state |
| POST | `/orgs/:orgId/deploy-contracts` | signed | Deploy contract stack |
| POST | `/orgs/:orgId/fund` | signed | Fund all wallets |
| DELETE | `/orgs/:orgId` | signed | Remove organization |

**Agents**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/agents` | — | List agents |
| POST | `/agents` | — | Create agent |
| POST | `/agents/:id/credentials/issue` | signed | Issue credential |
| POST | `/agents/:id/wallets/create` | signed | Deploy ERC-4337 wallet |
| POST | `/agents/:id/fund` | signed | Fund agent wallet |
| POST | `/agents/:id/sessions/create` | signed | Create ZK session |
| POST | `/agents/:id/revoke` | signed | Revoke credential |

**Proofs and events**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/proofs/:agentId` | Proof bundle inputs |
| POST | `/sessions` | Low-level session submission |
| GET | `/events` | Indexed contract events |

---

## Deployment

**Frontend → Vercel**

Set the project root to `frontend`, framework to Next.js, and add:

```
AGENT_CREDENTIALS_API_URL=https://your-backend-host
NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=https://your-backend-host
```

**Backend → Railway / Render / Fly.io**

The backend is a standard Node.js service. Deploy to any Node host and ensure it is publicly reachable from Vercel.

---

## SDK

```typescript
import { AgentClient } from '@agentix/sdk';

const client = new AgentClient({ apiUrl: 'https://...', orgId: 1 });

const { agentId } = await client.registerAgent({
  agentName: 'trading-bot-v1',
  permissions: 0b111,
  expiry: Math.floor(Date.now() / 1000) + 86400 * 30,
});

const wallet = await client.createWallet(agentId);

const session = await client.createSession({
  agentId,
  sessionId: crypto.randomUUID(),
  sessionKey: '0x...',
  maxValue: BigInt('100000000000000000'),
  expiry: Math.floor(Date.now() / 1000) + 3600,
});
```

---

## Security model

| Property | Mechanism |
|----------|-----------|
| Credential privacy | Commitments on-chain; raw data never leaves the backend |
| Session authorization | Groth16 proof verified on-chain |
| Platform actions | EIP-191 signature required; nonce + timestamp prevent replay |
| Revocation | Sparse Merkle tree; proof generation fails for revoked credentials |
| Replay prevention | Nullifiers stored in `SessionManager`; duplicates revert |
| Org isolation | Separate registry, session manager, and wallet factory per org |

**MVP limitations.** Before production use: replace SQLite with PostgreSQL, conduct a multi-party Groth16 trusted setup ceremony, add a user authentication layer beyond wallet ownership, and verify bundler responses against on-chain receipts.

---

## Network

Sepolia testnet · chain ID `11155111` · EntryPoint `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`

---

## Documentation

- [`quickstart.md`](./quickstart.md) — start, run, redeploy, troubleshoot
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design
- [`docs/API.md`](./docs/API.md) — backend routes and signed action format
- [`docs/SETUP.md`](./docs/SETUP.md) — environment and deployment
- [`sdk/README.md`](./sdk/README.md) — SDK integration guide

---

## License

Apache 2.0 — see [`LICENSE.md`](./LICENSE.md).
