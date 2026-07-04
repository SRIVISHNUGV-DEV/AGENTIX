# AgentIX V1 — User Model Document

**Date:** 2026-06-29
**Scope:** contracts/src/ (10 contracts)

---

## CredentialRegistry

**Intended for:** Organizations (via issuers), protocol governance (owner)

**Standalone users:** Cannot interact directly. No credential root can be set by an individual without issuer authorization.

**Organizations:** The owner adds issuer addresses. Issuers update active/revoked roots. SessionManagers (authorized by owner) mark nullifiers. This is a shared infrastructure contract — one registry serves many organizations.

**UX assessment:** Production-ready. Minimal interface (4 write functions). View functions for nullifier checking. No user-facing complexity.

**Differences standalone vs org:** None — this contract is purely infrastructure.

---

## Groth16Verifier

**Intended for:** Neither — infrastructure contract called only by SessionManager.

**Standalone users:** No direct interaction.
**Organizations:** No direct interaction.

**UX assessment:** N/A — pure verification contract.

---

## SessionManager

**Intended for:** Both standalone users AND organizations.

**Standalone users:**
- Create lightweight sessions via wallet signature (ECDSA)
- Create standard sessions via ZK proof (requires credential in CredentialRegistry)
- Revoke own sessions as wallet owner
- Session keys can self-revoke

**Organizations:**
- Issue credentials → users prove ownership via ZK proof → create standard sessions
- Same flow as standalone for lightweight sessions
- Timelock wallet factory change (24h)

**Additional setup required:** Wallet must be created by AgentWalletFactory. Wallet must have ETH for gas. For ZK sessions: credential must be in tree, user must generate Groth16 proof off-chain.

**UX assessment:** Complex for ZK sessions (off-chain proof generation required). Lightweight sessions have good UX (simple signature). Pruning requires wallet call — could be automated.

**Differences standalone vs org:** None protocol-level. Org just has easier credential issuance path.

---

## AgentWallet

**Intended for:** Both standalone users AND organizations.

**Standalone users:**
- Deploy via factory (auto-generated salt or custom salt)
- Execute transactions as owner
- Create sessions via SessionManager
- Transfer ownership (2FA)
- Manage EntryPoint deposits
- Timelocked SM/EP upgrades (24h)

**Organizations:**
- Same as standalone — org affiliation is via credential, not wallet structure
- Identity registration (via factory + AgentIdentity)

**Additional setup required:** Factory must exist; SessionManager must be deployed; EntryPoint must be available.

**UX assessment:** Production-ready for owner execution. Session-based execution requires understanding of session creation flow. 2FA ownership transfer is standard. Timelocks add security at cost of speed.

**Differences standalone vs org:** None. Wallet structure is identical.

---

## AgentWalletFactory

**Intended for:** Both standalone users AND organizations (infrastructure).

**Standalone users:** Call `createWallet(owner)` to get deterministic wallet.

**Organizations:** Same — factory is shared infrastructure.

**Additional setup:** Factory must be initialized with AgentWallet impl, SessionManager, EntryPoint.

**UX assessment:** Clean. Single function call creates wallet. Idempotent (safe to re-call). Deterministic address prediction available.

**Differences standalone vs org:** None.

---

## AgentIdentity

**Intended for:** Both standalone users AND organizations.

**Standalone users:** Identity auto-registered at wallet creation. User can link credentials, update metadata, deactivate/reactivate.

**Organizations:** Can query identities by wallet. Identity provides canonical reference for agents.

**Additional setup:** Identity auto-created by factory. No manual registration needed.

**UX assessment:** Good. Auto-registration eliminates setup friction. Manual operations (link credential, metadata) are rare. Deactivation is clear.

**Differences standalone vs org:** None. Identity is universal agent descriptor.

---

## OrganizationRegistry

**Intended for:** Organizations only.

**Standalone users:** Cannot register organizations (owner-only). Can query org data.

**Organizations:** Owner registers org with name and owner address. Gets deterministic credential anchor. Can deactivate/reactivate. Timelocked anchor upgrades.

**Additional setup:** Owner must deploy OrganizationCredentialAnchor implementation first.

**UX assessment:** Good. Single register call. Predictable anchor addresses. Timelock adds security for anchor upgrades.

---

## OrganizationCredentialAnchor

**Intended for:** Organizations only.

**Standalone users:** No direct interaction.

**Organizations:** Owner sets credential roots, epoch, visibility, metadata.

**Additional setup:** Auto-deployed by OrganizationRegistry.

**UX assessment:** Minimal. Four write functions. Clear state separation per org.

---

## CapabilityRegistry

**Intended for:** Organizations only.

**Standalone users:** Cannot register capabilities (owner-only). Can verify capability proofs.

**Organizations:** Owner registers capabilities. Grantors publish Merkle roots. Grantees verify proofs.

**Additional setup:** Requires off-chain Merkle tree management for grantors.

**UX assessment:** Complex for grantors (off-chain tree management). Simple for grantees (submit proof).

---

## DelegationManager

**Intended for:** Both standalone users AND organizations.

**Standalone users:** Can be delegates (verify delegation proofs). Cannot register scopes or emergency-revoke.

**Organizations:** Admins register scopes, grant root updater roles. Delegators publish roots. Delegates verify chains.

**Additional setup:** Requires off-chain Merkle tree management. Scopes must be pre-registered.

**UX assessment:** Complex for multi-hop chains. Single-hop is straightforward. Emergency revoke is powerful — one call blocks all delegations from a delegator.

---
