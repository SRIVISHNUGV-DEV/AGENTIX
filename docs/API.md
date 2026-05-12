# Agentix API Overview

## Core Routes

### Organizations

- `GET /orgs`
  List organizations.

- `POST /orgs`
  Create an organization.

- `GET /orgs/:orgId/state`
  Return the workspace state for one organization:
  - organization
  - contracts
  - agents
  - wallets
  - sessions
  - events

- `POST /orgs/:orgId/deploy-contracts`
  Deploy the organization contract stack.
  Requires signed action payload.

- `POST /orgs/:orgId/fund`
  Fund all known wallets in the organization.
  Requires signed action payload.

- `DELETE /orgs/:orgId`
  Remove an organization from the platform database.
  Requires signed action payload.

### Agents

- `GET /agents`
  List agents.

- `POST /agents`
  Create an agent for an organization.

- `POST /agents/:agentId/credentials/issue`
  Issue a credential.
  Requires signed action payload.

- `POST /agents/:agentId/wallets/create`
  Deploy an agent wallet.
  Requires signed action payload.

- `POST /agents/:agentId/fund`
  Fund a single agent wallet.
  Requires signed action payload.

- `POST /agents/:agentId/sessions/create`
  Create a session from the current credential.
  Requires signed action payload.

- `POST /agents/:agentId/revoke`
  Revoke the agent credential.
  Requires signed action payload.

### Proof / Session Plumbing

- `GET /proofs/:agentId`
  Return the proof bundle inputs required for proof generation.

- `POST /sessions`
  Low-level session submission endpoint.

- `GET /events`
  List indexed contract events.

## Signed Action Payload

Protected platform actions require:

```json
{
  "walletAddress": "0x...",
  "signature": "0x...",
  "nonce": "unique-string",
  "requestedAt": 1774190000
}
```

The signed message includes:

- action
- organization id
- target
- wallet address
- nonce
- requested timestamp
- Sepolia chain id

## Frontend Proxy Layer

The Next.js frontend exposes proxy routes under:

- `/api/platform/...`

These forward requests to the backend and keep the browser-facing app simpler.
