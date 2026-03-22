# Agentix Architecture

## Overview

Agentix is a four-part system:

- frontend: organization operator platform
- backend: API, state, proof orchestration, and chain integration
- circuits: zero-knowledge proof logic
- contracts: on-chain enforcement

## Components

### Frontend

The frontend is a Next.js application that:

- lets organizations connect a wallet
- creates and selects workspaces
- creates agents
- triggers signed platform actions
- shows sessions, wallets, and indexed events

### Backend

The backend is an Express + SQLite service that:

- persists organizations, agents, credentials, wallets, sessions, and events
- maintains the active Poseidon Merkle tree
- maintains the revocation sparse tree
- deploys contracts
- submits root updates and session transactions
- indexes contract events back into the database

### Circuits

The circuit proves:

- credential membership in the active root
- non-revocation against the revocation root
- expiry and permission constraints
- nullifier derivation for replay protection

### Contracts

Each organization has its own:

- `CredentialRegistry`
- `SessionManager`
- `AgentWalletFactory`

Shared infrastructure:

- `Verifier`
- wallet implementation used by the factory

## Per-Organization Isolation

The system deploys a separate contract stack per organization so:

- roots are organization-scoped
- wallet creation is organization-scoped
- event indexing can attribute state changes to the right organization
- one organization's operational load does not share the same registry or session contracts as another

## Data Flow

1. Organization creates a workspace.
2. Organization adds an agent.
3. Backend deploys org-specific contracts if they do not exist.
4. Backend inserts the credential commitment into the active tree.
5. Backend updates the on-chain active root.
6. Proof input is prepared from:
   - agent credential data
   - active tree proof
   - revocation sparse-tree proof
7. Session proof is generated.
8. `SessionManager` verifies the proof and emits `SessionCreated`.
9. Event indexer stores the event in SQLite and the frontend displays it.

## Security Model

Current protections:

- wallet signatures required for platform-triggered on-chain actions
- on-chain session verification using Groth16
- root updates and session creation scoped to organization contracts
- event indexing for auditability

Current MVP limitations:

- wallet-based operator control is present, but not full user or session auth
- this is still an MVP and should be hardened further before production use
