# PROTOCOL_ASSUMPTIONS.md — AgentIX V1

## 1. Organization Onboarding is Centralized in V1

The `OrganizationRegistry` contract is owned by a single administrator. Only this administrator may:
- Register new organizations
- Deactivate or reactivate organizations
- Propose and accept credential anchor updates

There is no decentralized governance, multisig requirement, or DAO voting for organization management in V1. The administrator key is the single point of trust for onboarding.

**Implication:** Compromise of the administrator key compromises all organization lifecycle management. The 24-hour timelock on credential anchor updates provides a detection window.

---

## 2. Organizations are Isolated Trust Domains

Each organization operates as an independent trust domain. An organization's:
- Credential anchors are isolated
- Active and revoked Merkle trees are isolated
- Organization IDs are unique and non-overlapping

One organization cannot issue credentials, revoke credentials, or influence the session lifecycle of another organization's agents.

**Implication:** Cross-organization credential sharing or delegation is not supported in V1. Each organization must independently onboard and manage its own agents.

---

## 3. SessionManager Owns Replay Protection

The `SessionManager` contract is the sole authority for:
- Nullifier tracking (via `CredentialRegistry.markNullifierUsed`)
- Session replay prevention
- Session lifecycle management

The `AgentWallet` does NOT implement replay protection. It delegates all session validation to the `SessionManager`.

**Implication:** If the `SessionManager` is compromised, replay protection fails for all wallets. The `SessionManager` is a critical security component.

---

## 4. Wallets Trust SessionManager

`AgentWallet` contracts trust the `SessionManager` for:
- Session validation (`validateSession`, `validateLightweightSession`)
- Session type resolution (`getSessionType`)

The wallet does not independently verify session validity. It assumes the `SessionManager` returns correct results.

**Implication:** A compromised `SessionManager` can authorize arbitrary transactions through any wallet. The SessionManager timelock (24 hours) provides a window for intervention.

---

## 5. Selector Whitelists Govern Fund Movement

`AgentWallet` enforces that only whitelisted target+selector pairs may be called. The wallet owner controls the whitelist via:
- `setWhiteListedSelector`
- `setWhiteListedSelectorBatch`

No external party can call unwhitelisted functions on arbitrary targets.

**Implication:** If the wallet owner's key is compromised, the attacker gains full control over all whitelisted operations. The whitelist is the only spending boundary for owner-controlled execution.

---

## 6. Budget Changes Require Credential Re-Issuance

Session budget limits (`maxValue`) are embedded in the ZK proof and verified against the credential's `budgetLimit` in the circuit. To change a session's budget:
1. The organization must issue a new credential with the updated `budgetLimit`
2. The agent must generate a new ZK proof referencing the new credential
3. A new session must be created with the new proof

There is no on-chain function to modify a session's budget after creation.

**Implication:** Budget changes are not instant. They require organization cooperation and a new proof generation cycle. This is a deliberate security design — no party can unilaterally increase spending limits.

---

## 7. Expiry Changes Require Credential Re-Issuance

Session expiry is embedded in the ZK proof and verified against the credential's `expiry` in the circuit. The circuit enforces `sessionExpiry <= credentialExpiry`. To extend a session's expiry:
1. The organization must issue a new credential with a later `expiry`
2. The agent must generate a new ZK proof referencing the new credential
3. A new session must be created with the new proof

There is no on-chain function to modify a session's expiry after creation.

**Implication:** Expiry changes are not instant. They require organization cooperation and a new proof generation cycle. Expired sessions cannot be revived — they must be replaced with new sessions.

---

## 8. AgentWallets are Organization-Agnostic

`AgentWallet` contracts have no knowledge of which organization issued their owner's credentials. They only know:
- Their owner address
- Their SessionManager reference
- Their EntryPoint reference
- Their selector whitelist

The credential issuance, organization membership, and trust domain boundaries are all managed at the `SessionManager` and `OrganizationRegistry` layers.

**Implication:** A single wallet can hold sessions from multiple organizations (if the owner has credentials from multiple orgs). The wallet itself cannot enforce organization-level isolation — that is the SessionManager's responsibility.

---

## 9. ZK Proofs are Non-Transferable Per Nullifier

Each ZK proof generates a unique nullifier based on `(orgId, secret, sessionNonce)`. Once a nullifier is marked as used in the `CredentialRegistry`, the same proof cannot be used again. The nullifier ensures:
- One proof = one session
- No proof sharing between agents
- No proof replay across sessions

**Implication:** If an agent loses its secret, it cannot generate new proofs for the same credential. The organization must issue a new credential with a new secret.

---

## 10. V1 Does Not Support Credential Revocation Propagation

When a credential is revoked (added to the revoked Merkle tree), existing sessions created with that credential remain valid until they expire. The ZK proof only checks that the credential was NOT revoked at the time of session creation.

**Implication:** Revoking a credential does not immediately terminate active sessions. The organization must wait for session expiry or rely on off-chain mechanisms to enforce revocation. This is a known V1 limitation — V2 may add real-time revocation checks.
