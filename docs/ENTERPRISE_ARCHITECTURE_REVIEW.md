# AGENTIX Enterprise Architecture Review

## Positioning

AGENTIX should be treated as:

- identity issuance for agents
- capability policy and session governance
- runtime authorization boundary
- audit and anomaly control plane

AGENTIX should not be treated as:

- the place where all business workflow logic lives
- a full agent framework
- a wallet product

## Current Assessment

### Production Ready

- PostgreSQL-backed backend bootstrap and migrations
- external runtime model using backend-mediated protocol tools
- session-key based execution limits for repeated runtime actions
- basic audit trail and execution logging

### Needs Refactor

- capability management: now separated into `agent_capability_policies`, but frontend still needs first-class policy management UX
- audit model: schema now supports governance-grade fields, but route consumers still mostly read the older flat view
- anomaly detection: baseline server-side alerts now exist, but thresholds and notification workflows are still minimal

### Needs Redesign

- proof-backed legacy session flow in `PlatformService`: still couples credential fields to runtime authorization
- credential circuit: still contains capability ceiling logic and session issuance details that should shrink further
- on-chain contracts: `CredentialRegistry` and the proof-based `SessionManager.createSession` still reflect the older coupled trust model
- server-side managed agent secret handling: identity secrets should not remain a backend-owned primitive for production

### Remove Entirely

- per-feature architectural duplication where both `routes/sessions.ts` and `routes/externalAgents.ts` represent competing session models
- any frontend flow that asks operators to think in proof internals or nullifier mechanics during normal operations

## Target Architecture

### Identity Layer

Credential proves:

- agent membership
- org membership
- validity window
- non-revocation

Credential does not carry day-to-day capability policy.

### Capability Layer

Capability policy is now stored separately in `agent_capability_policies`.

Policy controls:

- allowed runtime actions
- allowed protocol tools
- daily spend limit
- daily tx limit
- max single-transaction value
- default and max session duration

Policy changes do not require credential reissuance.

### Session Layer

Target runtime flow:

1. Stable credential exists.
2. Proof is used only to establish trusted session issuance when that model is required.
3. Runtime receives bounded session credentials.
4. Runtime executes many actions through backend protocol tools.
5. Session expires or is revoked.
6. New session is minted.

The external-agent lightweight session path is closest to this target today.

## ZK Review

### What Should Stay In-Circuit

- commitment membership
- non-revocation
- credential ownership
- bounded session issuance

### What Should Move Out

- mutable capability policy
- workflow metadata
- runtime tool authorization
- spend history
- audit history

### Constraint Review

The current circuit still proves:

- active membership
- revocation exclusion
- session value <= credential ceiling
- session expiry <= credential expiry

That is acceptable for an interim model, but the capability ceiling should become a coarse credential ceiling, not the operational policy surface.

## Security Review

### Fixed in this pass

- capability policy is now enforced separately from credential issuance
- protocol tool catalog is filtered by policy before runtime exposure
- protocol tool execution is denied if the capability policy does not allow the action
- lightweight session issuance is clamped by capability policy
- audit schema now supports category, actor, target, outcome, severity, trace, and session correlation
- baseline anomaly alerts now detect execution-failure spikes, session spend surges, and frequent session creation

### Remaining High-Risk Areas

- legacy `PlatformService` still uses backend-managed agent secrets and proof-backed session issuance with capability coupling
- session private keys are backend-encrypted, which is acceptable for managed hosting but not ideal for strongest self-custody posture
- contract-side session revocation and owner checks need another review before paid production rollout
- runtime-side AI provider access still depends on external model credentials and must be isolated per environment

## Developer Experience

### Free Tier

- self-hosted backend
- local runtime
- local proving
- local session creation
- local wallet and protocol testing

### Paid Tier

- hosted governance control plane
- anomaly detection
- long-term audit retention
- policy management UI
- enterprise reporting and alerting

## Demo Flow

1. Create org and agent.
2. Issue stable credential.
3. Open capability policy and show allowed tools plus spend bounds.
4. Create session for a local runtime.
5. Ask runtime to inspect wallet state, whitelist an address, and submit a bounded action.
6. Show correlated audit events and anomaly view.
7. Revoke session or tighten policy without reissuing credential.

## Remaining Gaps Before Paid Production

- redesign or deprecate legacy proof session route in favor of one production session model
- replace backend-owned managed secret assumptions
- contract refresh so identity and operational policy are separated on-chain as well as off-chain
- add notifications, suppressions, and triage workflow for anomalies
- add enterprise RBAC and admin approval workflows for policy changes
- add benchmarked proving metrics and documented circuit performance numbers
