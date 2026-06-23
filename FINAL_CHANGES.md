# FINAL_CHANGES.md — AgentIX V1 Hardening Pass

## SessionManager.sol

---

### Fix 1: Restrict createSession() caller

**Issue:** `createSession()` was callable by any external address. A third party could front-run session creation, submitting a valid proof to bind a session to a wallet they don't control.

**Risk:** Session hijacking via front-running. An attacker could create sessions on behalf of any wallet using a valid ZK proof they intercepted or generated.

**Fix:** Added `if (msg.sender != wallet) revert NotBoundWallet()` as the first check. Only the wallet itself may create standard sessions.

**Reason:** The wallet is the trust anchor. Only the wallet (or its owner via the wallet contract) should decide which sessions are bound to it.

---

### Fix 2: Reject invalid session keys

**Issue:** `sessionKey == wallet` was not rejected. A session key identical to the wallet address would bypass the session-based spending controls, effectively granting unlimited access through the session mechanism.

**Risk:** A misconfigured or malicious proof could set `sessionKey == wallet`, allowing the wallet owner to spend without session limits.

**Fix:** Added `if (sessionKey == wallet) revert InvalidSessionKey()` in both `createSession()` and `createLightweightSession()`.

**Reason:** Session keys must be distinct from the wallet to maintain the separation between owner-controlled and session-controlled execution paths.

---

### Fix 3: Timelock walletFactory updates

**Issue:** `setWalletFactory()` applied instantaneously. A compromised owner key could swap the factory reference to a malicious contract, immediately invalidating all future wallet validation.

**Risk:** Instant swap of `walletFactory` could redirect session creation to a malicious factory, bypassing all wallet-level security.

**Fix:** Replaced `setWalletFactory(address)` with `proposeWalletFactory(address)` + `acceptWalletFactory()`. Added `pendingWalletFactory`, `walletFactoryActivationTime`, and `TIMELOCK_DELAY` (24 hours). New errors: `WalletFactoryTimelockNotReady`, `WalletFactoryTimelockActive`.

**Reason:** The 24-hour delay provides a window for detection and intervention if the owner key is compromised. Matches the timelock pattern already used in AgentWallet and AgentWalletFactory.

---

### Fix 4: Fix pruneExpiredSessions() ACL

**Issue:** `pruneExpiredSessions()` used the `onlyWallet` modifier (ensuring `msg.sender` is an AgentWallet) but accepted an arbitrary `wallet` parameter. Any AgentWallet could prune another wallet's sessions.

**Risk:** A malicious wallet could prune sessions belonging to other wallets, disrupting their operations.

**Fix:** Added `if (wallet != msg.sender) revert NotBoundWallet()` inside the function body.

**Reason:** Each wallet should only manage its own session list. The `onlyWallet` modifier confirms the caller is a wallet; the new check confirms it's pruning its own sessions.

---

### Fix 5: Move TooManySessions check earlier

**Issue:** The `TooManySessions` check occurred after proof verification (`verifier.verifyProof`). If a wallet already had 100 sessions, an attacker could still trigger expensive proof verification before the revert.

**Risk:** Gas griefing — forcing expensive ZK proof verification for operations that would revert anyway.

**Fix:** Moved `if (walletSessions[wallet].length >= MAX_SESSIONS_PER_WALLET) revert TooManySessions()` to immediately after the initial validation checks, before any public signals verification or proof verification.

**Reason:** Fail-fast on cheap checks before expensive operations. This is a standard gas optimization pattern.

---

### Fix 6: Move markNullifierUsed()

**Issue:** `registry.markNullifierUsed()` was called before storage writes to the session struct. While reverts roll back state, the ordering could cause confusion during audit and future maintenance.

**Risk:** Readability and auditability concern. No direct security impact since Solidity reverts are atomic.

**Fix:** Moved `registry.markNullifierUsed(nullifier)` to after all session storage writes (`sessions[sessionId]` and `walletSessions[wallet].push`).

**Reason:** Logical ordering: compute → verify → write state → mark nullifier → emit event. This makes the function's data flow clearer and reduces the chance of future bugs if the function is extended.

---

### Fix 7: Credential version validation

**Issue:** `publicSignals[5]` (credentialVersion) was accepted without validation against `SUPPORTED_CREDENTIAL_VERSION`. Proofs from unsupported credential versions would be accepted.

**Risk:** If the credential circuit is upgraded (e.g., V2 with different constraints), old proofs could still be accepted if the contract doesn't validate the version.

**Fix:** Added `uint256 public constant SUPPORTED_CREDENTIAL_VERSION = 1` and `if (publicSignals[5] != SUPPORTED_CREDENTIAL_VERSION) revert UnsupportedCredentialVersion()`. New error: `UnsupportedCredentialVersion`.

**Reason:** Explicit version gating ensures only proofs from the currently supported circuit version are accepted. Future upgrades require updating this constant.

---

### Fix 7b: Reject zero nullifiers

**Issue:** `bytes32(publicSignals[6])` was not checked for `bytes32(0)`. An integration bug producing a zero nullifier would enter the replay protection system, potentially allowing the "used nullifier" check to be bypassed or creating a permanent dead entry.

**Risk:** If a zero nullifier were marked as used, it would permanently block any future proof that happened to produce the same hash. More importantly, it signals a broken proof pipeline that should fail fast.

**Fix:** Added `if (nullifier == bytes32(0)) revert InvalidNullifier()` immediately after nullifier extraction. New error: `InvalidNullifier`.

**Reason:** Defensive programming. The nullifier is the core of replay protection — garbage in, garbage out. Rejecting zero prevents silent corruption of the nullifier set.

---

### Fix 7c: Early EOA rejection for wallet parameter

**Issue:** The `wallet` parameter passed to `createSession()` was only validated against `walletFactory.isAgentWallet()`. An EOA (code.length == 0) would fail this check, but the error message was the less specific `NotAgentWallet` from the factory call, and the check came later in the function.

**Risk:** Minor — no security impact since `isAgentWallet` catches it. But failing earlier on a cheaper check (EXTCODESIZE) before the external call to `walletFactory.isAgentWallet()` is better gas hygiene and produces a clearer failure path.

**Fix:** Added `if (wallet.code.length == 0) revert NotAgentWallet()` immediately after the `msg.sender != wallet` check.

**Reason:** Fail-fast on the cheapest check. EXTCODESIZE costs less gas than an external call to the factory. This is defensive programming that makes the function's validation pipeline clearer.

---

## OrganizationRegistry.sol

---

### Fix 8: Timelock credential anchor updates

**Issue:** `setCredentialAnchor()` applied instantaneously. A compromised owner key could swap an organization's credential anchor to a malicious contract, immediately invalidating all credential verification for that organization.

**Risk:** Instant anchor swap could redirect credential verification to a malicious contract, bypassing the entire ZK credential system.

**Fix:** Replaced `setCredentialAnchor(bytes32, address)` with `proposeCredentialAnchor(bytes32, address)` + `acceptCredentialAnchor(bytes32)`. Added per-organization `pendingAnchor` and `anchorActivationTime` mappings. Added `TIMELOCK_DELAY` constant (24 hours). New errors: `AnchorTimelockNotReady`, `AnchorTimelockActive`. New event: `CredentialAnchorProposed`.

**Reason:** The 24-hour delay provides a window for detection and intervention. Matches the timelock pattern used throughout the protocol.

---

### Fix 9: Validate newAnchor

**Issue:** `setCredentialAnchor()` did not validate that `newAnchor` was a contract. EOAs could be set as credential anchors, which would silently fail all credential verification.

**Risk:** Setting an EOA as anchor breaks the credential verification chain for an organization with no compile-time or deployment-time warning.

**Fix:** Added `if (newAnchor.code.length == 0) revert InvalidAnchor()` in `proposeCredentialAnchor()`. New error: `InvalidAnchor`.

**Reason:** ERC165 introspection is not required for V1. A simple code-length check is sufficient to reject EOAs while remaining gas-efficient.

---

### Fix 10: Fix organization activation errors

**Issue:** `deactivateOrganization()` and `reactivateOrganization()` both used `OrganizationNotFound()` for state-specific errors. This produced misleading error messages when the organization exists but is already in the target state.

**Risk:** Debugging difficulty. The same error for "not found" and "already in state" makes it harder to diagnose issues in production.

**Fix:** Added `error OrganizationAlreadyInactive()` and `error OrganizationAlreadyActive()`. Used `OrganizationAlreadyInactive` in `deactivateOrganization()` and `OrganizationAlreadyActive` in `reactivateOrganization()`.

**Reason:** Semantic error messages improve debugging, monitoring, and incident response. Each error should describe the actual failure condition.

---

## DelegationManager.sol

---

### Fix D1: Restrict updateDelegationRoot() caller

**Status:** Already implemented — no change needed.

**Existing code (lines 127-128):**
```solidity
if (msg.sender != delegator && !hasRole(ROOT_UPDATER_ROLE, msg.sender)) {
    revert AccessControlUnauthorizedAccount(msg.sender, ROOT_UPDATER_ROLE);
}
```

**Assessment:** The access control is already correct. Only the delegator themselves or an address with `ROOT_UPDATER_ROLE` may update delegation roots.

---

### Fix D2: Clear roots on reAuthorizeDelegator()

**Issue:** `reAuthorizeDelegator()` set `revokedDelegators[delegator] = false` without clearing old delegation roots. After emergency revoke → re-authorize, stale roots became active again, potentially allowing old delegations to resurrect.

**Risk:** Delegation hijack via stale roots. An attacker who triggered emergency revoke could wait for re-authorization, then exploit old roots that were never cleaned up.

**Fix:** `reAuthorizeDelegator()` now iterates all scopes in `_delegatorScopes[delegator]`, deletes every `delegationRoots[delegator][scope]`, and removes the scope from the set. The delegator must publish fresh roots after re-authorization.

**Reason:** Clearing roots forces a clean state after re-authorization. Stale roots are the root cause of the resurrection vulnerability.

---

### Fix D3: Document MAX_DELEGATION_DEPTH

**Issue:** `MAX_DELEGATION_DEPTH = 10` was an undocumented magic number. Future developers might not understand this is a protocol limit with migration implications.

**Risk:** Misunderstanding could lead to unsafe increases or assumptions that the limit is arbitrary.

**Fix:** Added inline comment: `// Protocol limit — do not increase without migration`.

**Reason:** Protocol constants with architectural significance should be documented at the point of definition.

---

## CapabilityRegistry.sol

---

### Fix C1: Per-capability grant roots

**Issue:** `grantRoots[grantor][grantee]` stored a single root per (grantor, grantee) pair. If the same grantor granted multiple capabilities to the same grantee, calling `updateGrantRoot` for one capability overwrote the root for all others.

**Risk:** Grant root overwrite. Grantor A grants capabilities X and Y to agent B. Updating the root for X silently destroys the root for Y, making Y unverifiable until a new root is published.

**Fix:** Changed mapping to `grantRoots[grantor][grantee][capabilityId]`. Updated `updateGrantRoot()` to accept `capabilityId` parameter. Updated `verifyCapability()` to look up the root by capability ID. Updated `GrantRootUpdated` event to include `capabilityId`.

**Reason:** Each capability should have an independent Merkle root. Shared roots create implicit coupling between unrelated capabilities.

---

### Fix C2: Add whenNotPaused to updateGrantRoot()

**Issue:** `updateGrantRoot()` had no pause protection. During a security incident, the owner could pause the contract but grantors could still update roots.

**Risk:** Continued grant root updates during an active incident could expand the attack surface.

**Fix:** Added `whenNotPaused` modifier to `updateGrantRoot()`.

**Reason:** Pause should halt all state-changing operations, not just some. Grant root updates are state changes that should respect the pause.

---

### Fix C3: Grantor revocation in revokeGrant()

**Issue:** `revokeGrant()` only checked `capabilities[capabilityId].registrar` or `owner()`. The grantor who set the root could not revoke their own grants, even though they created them.

**Risk:** A grantor who delegates capabilities cannot revoke them if the registrar is unresponsive. The grantor loses control over their own delegation decisions.

**Fix:** Added `grantor` parameter to `revokeGrant()`. Now checks: `msg.sender == registrar || msg.sender == owner() || msg.sender == grantor`. Added `error GrantNotRevocable()` for clearer error messaging.

**Reason:** The grantor who creates a delegation should retain the ability to revoke it. This follows the principle of least privilege — you can always undo what you created.

---

### Fix C4: Validate updateGrantRoot() inputs

**Issue:** `updateGrantRoot()` accepted any `grantee` and `capabilityId` without validation. A caller could create orphaned grant roots for non-existent capabilities or the zero address.

**Risk:** Orphaned roots waste storage and create confusion. Roots for non-existent capabilities could be exploited if a capability is later registered with the same ID.

**Fix:** Added three checks:
- `if (grantee == address(0)) revert InvalidRecipient()`
- `if (capabilities[capabilityId].createdAt == 0) revert CapabilityNotFound()`
- `if (newRoot == bytes32(0)) revert InvalidRoot()`

New errors: `InvalidRecipient`, `InvalidRoot`.

**Reason:** Input validation at the boundary prevents garbage data from entering the system. Every root update should reference a valid, existing capability.

---

### Fix C5: Semantic error for grant revocation

**Issue:** `revokeGrant()` used `AlreadyRevokedCapability` when the grant was already revoked. This conflated two distinct concepts: capability revocation and grant revocation.

**Risk:** Misleading error messages make debugging harder. An operator seeing "AlreadyRevokedCapability" when revoking a grant may incorrectly think the capability itself was revoked.

**Fix:** Added `error AlreadyRevokedGrant()`. `revokeGrant()` now reverts with `AlreadyRevokedGrant` instead of `AlreadyRevokedCapability`.

**Reason:** Semantic correctness in error messages prevents confusion between distinct protocol operations.

---

## DelegationManager.sol (additional)

---

### Fix D4: Semantic event for re-authorization

**Issue:** `reAuthorizeDelegator()` emitted `DelegatorRevoked` after clearing the revocation. The event name contradicted the operation — revoking ≠ re-authorizing.

**Risk:** Monitoring systems and indexers relying on event names would misclassify re-authorization events as revocation events, causing false alerts.

**Fix:** Added `event DelegatorReAuthorized(address indexed delegator)`. `reAuthorizeDelegator()` now emits `DelegatorReAuthorized` instead of `DelegatorRevoked`.

**Reason:** Event names should describe the operation that occurred, not the opposite operation.
