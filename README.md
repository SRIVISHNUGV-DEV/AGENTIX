# Agent Credentials

Agent Credentials is a platform for issuing private credentials to AI agents, proving those credentials with zero knowledge, and creating on-chain sessions and wallets under policy control.

The project is split into four layers:

- `frontend/`: operator platform for organizations
- `backend/`: API, state management, proofs, event indexing, and blockchain orchestration
- `contracts/`: Solidity contracts for credential roots, sessions, and agent wallets
- `circuits/`: Circom circuit and proving artifacts for credential proofs

## What It Does

An organization can:

- connect a wallet
- create an organization workspace
- add agent identities
- deploy an organization-specific contract stack
- issue credentials to agents
- create agent wallets
- fund wallets
- create sessions
- revoke credentials
- inspect indexed on-chain events

The system is built so that:

- credential commitments are stored, not raw secrets
- session creation is gated by a zero-knowledge proof
- every platform-triggered on-chain action is approved by a wallet signature
- each organization gets its own `CredentialRegistry`, `SessionManager`, and `AgentWalletFactory`

## Main Flow

1. The organization connects a Sepolia wallet in the frontend.
2. The organization creates a workspace and adds agents.
3. The backend deploys an org-specific contract stack.
4. A credential commitment is inserted into the active Poseidon Merkle tree.
5. The agent or managed backend flow generates a proof against:
   - the active credential root
   - the revocation root
6. `SessionManager.sol` verifies the proof and opens an on-chain session.
7. Wallet and session events are indexed back into the backend and shown in the frontend.

## Repository Layout

```text
agent-credentials-mvp/
├─ backend/
├─ circuits/
├─ contracts/
├─ docs/
├─ frontend/
├─ scripts/
├─ sdk/
├─ quickstart.md
└─ README.md
```

## Quick Start

From the repo root:

```powershell
npm install --workspaces
npm run dev
```

Then open:

- frontend: `http://127.0.0.1:3001`
- backend: `http://127.0.0.1:3000`

Full setup and redeploy instructions are in [quickstart.md](/d:/BLOCKCHAIN%20AND%20ZK%20PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/quickstart.md).

## Documentation

- [quickstart.md](/d:/BLOCKCHAIN%20AND%20ZK%20PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/quickstart.md): start, run, and redeploy
- [docs/ARCHITECTURE.md](/d:/BLOCKCHAIN%20AND%20ZK%20PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/docs/ARCHITECTURE.md): system design
- [docs/API.md](/d:/BLOCKCHAIN%20AND%20ZK%20PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/docs/API.md): important backend routes
- [docs/SETUP.md](/d:/BLOCKCHAIN%20AND%20ZK%20PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/docs/SETUP.md): environment and deployment setup
- [sdk/README.md](/d:/BLOCKCHAIN%20AND%20ZK%20PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/sdk/README.md): SDK and self-hosted flow

## Current Network

The current MVP is configured for:

- network: `Sepolia`
- chain id: `11155111`

## Notes Before GitHub

Do not commit:

- `backend/.env`
- local SQLite database files
- proving artifacts from `circuits/build/`
- `.next/`, `dist/`, or `node_modules/`

The root `.gitignore` is already prepared for GitHub upload.
