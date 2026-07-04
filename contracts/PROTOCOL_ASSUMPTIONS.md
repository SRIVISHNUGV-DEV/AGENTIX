# AgentIX V1 — Protocol Assumptions Document

**Date:** 2026-06-29
**Auditor:** System-wide, contract-by-contract security audit
**Scope:** contracts/src/ (10 contracts)
**Status:** V1 Frozen Protocol

---

## 1. CredentialRegistry

**Purpose:** Manages Merkle roots for active credential trees and revoked-credential trees, plus nullifier tracking to prevent double-use.

**Responsibilities:**
- Stores a single `activeRoot` (credential inclusion tree)
- Stores a single `revokedSecretRoot` (revocation tree) 
- Tracks all used nullifiers (`usedNullifiers` mapping)
- Authorizes issuers to update roots
- Authorizes SessionManagers to mark nullifiers

**What it owns:** Immutable state: roots, nullifier set, issuer list, sessionManager list
**What it must NEVER own:** ETH, tokens, upgradeable logic not behind proxy
**Who calls it:** Issuers (root updates), SessionManagers (nullifier marking), Owner (admin)
**Who it calls:** No external contracts — self-contained
**Trust assumptions:** Issuers are trusted to update correct roots; SessionManagers are trusted to mark nullifiers atomically
**Security assumptions:** Nullifier marking is unpausable (correctly designed — DOS prevention)
**Critical invariants:**
- A nullifier, once marked, can NEVER be unmarked
- Only authorized SessionManagers may mark nullifiers
- Only authorized issuers may update roots
- Roots may never be zero
**Failure modes:**
- Malicious issuer sets wrong root → all credential proofs fail
- Malicious SessionManager burns unused nullifiers → credential DOS
- Pause state does NOT block nullifiers → secure by design
**Mainnet considerations:** Single-issuer model works fine; multi-issuer requires governance coordination
**Known limitations:** No per-organization root support (uses OrganizationCredentialAnchor for that); no expiration on roots
**V2 recommendation:** Add root versioning with migration window; add per-organization root lookups

---

## 2. CredentialVerifierV1 (Groth16Verifier)

**Purpose:** SnarkJS-generated Groth16 proof verifier for ZK credential proofs.

**Responsibilities:** Verify Groth16 proofs against embedded verification key.
**What it owns:** Hardcoded verification key constants
**What it must NEVER own:** Mutable state, ETH, upgradability
**Who calls it:** SessionManager (for validating credential-based session creation)
**Who it calls:** BN254 pairing precompile (address 6, 7, 8)
**Trust assumptions:** The verification key matches the proving key used off-chain
**Security assumptions:** BN254 pairing precompile is correct; Groth16 security assumptions hold
**Critical invariants:**
- `verifyProof` is pure computation; no side effects
- Public signals (7 values) are correctly bound to proof
**Failure modes:** Wrong verification key → all proofs fail/invalid proofs pass
**Mainnet considerations:** Deployed as standalone (non-upgradeable) — if circuit changes, new verifier must be deployed
**Known limitations:** Fixed 7 public signals; cannot change without re-deployment; GPL-3.0 license
**V2 recommendation:** Consider PLONK or Nova for more efficient verification; add circuit upgrade path

---

## 3. SessionManager

**Purpose:** Manages two session types for AgentWallets — standard (ZK-proof-based with cumulative limits) and lightweight (ECDSA-owner-signed with daily limits).

**Responsibilities:**
- Create/validate/revoke standard sessions (ZK proof of credential ownership)
- Create/validate/revoke lightweight sessions (owner ECDSA signature)
- Enforce spend limits, transaction limits, target restrictions, expiry
- Maintain wallet-to-sessions enumeration for pruning
- Manage AgentWalletFactory reference with timelock

**What it owns:** Session state, walletSessions mapping, sessionTargets, timelock state
**What it must NEVER own:** User ETH, tokens, wallet ownership
**Who calls it:** AgentWallets (validate), wallet owners (create/revoke), session keys (revoke), owner (admin)
**Who it calls:** CredentialRegistry (read roots, mark nullifiers), Verifier (verify ZK proofs), AgentWalletFactory (isAgentWallet)
**Trust assumptions:** WalletFactory is trusted to correctly identify wallets; CredentialRegistry roots are correct
**Security assumptions:** ZK proof verification is sound; ECDSA signatures are not forgeable; chainId binding prevents replay
**Critical invariants:**
- Session wallet binding is immutable after creation
- Expired sessions NEVER validate
- Revoked sessions NEVER validate
- MAX_SESSIONS_PER_WALLET (100) is enforced
- Daily limits reset at day boundary
- Wallet ownership is verified before session creation (via IAgentWallet.owner())
- Session ID collision across types (standard/lightweight) is prevented
- Standard session nullifier can only be consumed once (via CredentialRegistry)
- `msg.sender == wallet` enforced for session creation
- Wallet must have code AND be in factory registry

**Failure modes:**
- WalletFactory replacement during active sessions → old sessions still validate (by design, sessions are bound to wallet, not factory)
- Pause blocks ALL validation → DOS against active sessions
- `proposeWalletFactory` with zero pending check prevents double-proposal
- `proposeWalletFactory` event not emitted → V2 Recommendation
- `acceptWalletFactory` event not emitted → V2 Recommendation
- `pruneExpiredSessions` only callable by wallet itself (onlyWallet modifier) — important: the `onlyWallet` modifier checks `msg.sender` IS an AgentWallet, AND `wallet != msg.sender` in pruneExpiredSessions reverts with NotBoundWallet. This means ONLY the wallet's own contract can call prune on itself.

**Mainnet considerations:** MAX_SESSIONS_PER_WALLET = 100 may be tight for high-frequency agents; SUPPORTED_CREDENTIAL_VERSION = 1 is hardcoded

**Issues found during audit:**

### HIGH — Missing Events on WalletFactory Update
`proposeWalletFactory()` and `acceptWalletFactory()` do NOT emit events. This is an observability gap — monitoring systems cannot detect changes to this critical dependency. **Recommendation:** Add `WalletFactoryProposed` and `WalletFactoryUpdated` events.

### MEDIUM — Zero-Nullifier Allowed
`createSession` allows `nullifier == bytes32(0)` to pass validation if `isNullifierUsed` returns false and it's not checked as zero. **However**: the check `if (nullifier == bytes32(0)) revert InvalidNullifier()` exists. Confirmed: auditor was wrong — this check IS present. Closed.

### LOW — `proposeWalletFactory` Zero-Address Not Checked  
`proposeWalletFactory` accepts parameter `walletFactory_` without checking it's not zero. However `acceptWalletFactory` would revert since it checks zero on pending. The `InvalidSessionManager` error name is misleading here — it should be `InvalidWalletFactory` or a more descriptive error.

### INFORMATIONAL — `pruneExpiredSessions` Double-Checks Sender
Both `onlyWallet` modifier AND explicit `wallet != msg.sender` check. Redundant but not harmful.

---

## 4. AgentWallet

**Purpose:** ERC-4337 compatible smart contract wallet for AI agents. Supports owner-controlled and session-based execution.

**Responsibilities:**
- Execute single and batch calls
- Validate ERC-4337 UserOperations (owner direct + session-based)
- Manage EntryPoint deposits
- 2FA ownership transfer
- Timelocked SessionManager and EntryPoint upgrades
- ERC-777 compatibility

**What it owns:** Owner, pendingOwner, sessionManager, entryPoint, pending addresses, timelock state
**What it must NEVER own:** Other users' assets without auth; the session validation logic (delegated to SessionManager)
**Who calls it:** Owner (direct execution, admin), EntryPoint (ERC-4337), Factory (initialize)
**Who it calls:** EntryPoint (depositTo, withdrawTo, balanceOf), SessionManager (validateSession, validateLightweightSession, getSessionType), ERC1820Registry (setInterfaceImplementer)
**Trust assumptions:** EntryPoint is correct ERC-4337 impl; SessionManager correctly validates; Factory clones only once
**Security assumptions:** Constructor locks implementation; EIP-1167 clones call initialize(); ReentrancyGuard prevents reentrancy
**Critical invariants:**
- Owner can always execute directly
- EntryPoint can always call validateUserOp/execute
- Session-based execution requires valid session via SessionManager
- Batch execution NOT allowed via sessions (only owner/EntryPoint direct)
- MAX_BATCH_SIZE = 20
- 24-hour timelock on SessionManager and EntryPoint changes
- Ownership transfer is 2FA (propose/accept)
- Implementation contract CANNOT be initialized (constructor sets initialized=true)

**Issues found during audit:**

### HIGH — ERC1820 Registration Failure is Silently Ignored
In `initialize()`, ERC1820 registration failure is assigned to variable but never checked:
```solidity
(bool erc1820Ok, ) = ERC1820_REGISTRY.call(...);
erc1820Ok; // success is optional — ERC1820 registry may not exist
```
If the ERC1820 registry call fails on a chain where it exists (e.g., all standard EVM chains), ERC-777 tokens would NOT be able to send to this wallet. This is a silent failure mode. **Recommendation:** At minimum emit an event; preferably revert if on a chain where ERC1820 is expected.

### MEDIUM — `_extractSpendValue` Decodes Arrays Twice
`_extractSpendValue` and `_extractTarget` both decode `callData[4:]` independently. The `_extractSpendValue` for executeBatch decodes targets and values arrays into memory twice (once for length check, once for value summation). Not a security issue but gas-inefficient.

### MEDIUM — `receive()` Accepts ETH from Anyone
By design (standard wallet behavior), but noted: this means anyone can grief the wallet with dust. Consider adding a minimum deposit or event emission.

### LOW — `tokensReceived()` Implementation is Empty
ERC-777 tokens sent to the wallet will trigger `tokensReceived` which does nothing. Tokens will be accepted but no event is emitted. This is fine for ERC-777 compliance but lacks observability.

### LOW — `_fundEntryPoint` Funds the EntryPoint Directly
When `missingAccountFunds > 0`, the wallet forwards ETH to `msg.sender` (the EntryPoint). This is correct ERC-4337 behavior. However, if the wallet has insufficient ETH (race condition), the call silently fails and reverts with `FundingFailedError`. Consider pre-checking balance.

### INFORMATIONAL — `checkBalance()` Redundant
`checkBalance()` returns `address(this).balance` which can be obtained via standard ETH RPC. Minor gas waste but acceptable for convenience.

---

## 5. AgentWalletFactory

**Purpose:** Deterministic factory creating EIP-1167 clones of AgentWallet implementation.

**Responsibilities:**
- Create AgentWallet clones with deterministic addresses (CREATE2)
- Initialize wallets with owner, SessionManager, EntryPoint
- Register wallets in agentWallets registry
- Register identities via AgentIdentity
- Timelocked implementation/SM/EP upgrades

**What it owns:** implementation address, sessionManager, entryPoint, agentIdentity, agentWallets registry, walletCount
**What it must NEVER own:** Wallet keys, user ETH
**Who calls it:** Anyone (createWallet), Owner (admin)
**Who it calls:** AgentWallet implementation (cloneDeterministic, initialize), AgentIdentity (registerIdentity)
**Trust assumptions:** Implementation address is correct AgentWallet; AgentIdentity is correctly configured
**Security assumptions:** CREATE2 determinism is correct; clones are initialized atomically
**Critical invariants:**
- Each (owner, salt) pair produces exactly ONE wallet
- Wallet owner cannot be changed post-creation via factory
- Existing wallets with different owners revert on collision
- agentWallets registry tracks ALL factory-created wallets
- 24-hour timelock on all state-changing admin operations
- agentIdentity is optional (can be zero)

**Issues found during audit:**

### MEDIUM — Identity Registration Failure is Silently Ignored
```solidity
if (agentIdentity != address(0)) {
    IAgentIdentity(agentIdentity).registerIdentity(wallet);
}
```
If `registerIdentity` reverts, the entire `_createWallet` reverts. However, if `agentIdentity` is set to a malicious address that always reverts, wallet creation becomes impossible. This is a DOS vector if the factory owner is compromised. **Recommendation:** Consider try-catch pattern or separate identity registration from wallet creation.

### LOW — `createWallet(address)` Uses Auto-Incrementing Wallet Count for Salt
The auto-salt version uses `walletCount` in the salt. After a factory upgrade or migration, `walletCount` resets, potentially causing salt collisions (though chainId in salt mitigates cross-chain). For same-chain re-deployments, this could be problematic.

### LOW — `isAgentWallet` Not Checked for Implementation Lock
No validation that `implementation_` is actually an AgentWallet with constructor lock. If a non-ER1167-compatible contract is set as implementation, clones will be broken.

### INFORMATIONAL — `walletCount` Incremented Even for Idempotent Creates
When a wallet already exists (code.length > 0) and owner matches, `walletCount` is NOT incremented (correct). When a NEW wallet is created, `walletCount++` happens. This means `walletCount` equals number of unique wallets created, not number of `createWallet` calls.

---

## 6. AgentIdentity

**Purpose:** Canonical on-chain registry for agent identities. Stores identityId, wallet reference, credential reference, metadata root, and registration state.

**Responsibilities:**
- Register new identities (called by factory)
- Link credentials to identities
- Update metadata roots
- Deactivate/reactivate identities
- Query identity by wallet, wallet by identity

**What it owns:** Identity mapping, wallet-to-identity mapping, identityCount, walletFactory
**What it must NEVER own:** ETH, tokens, actual credentials
**Who calls it:** Factory (register), wallet owners (link, update, deactivate, reactivate), public (views)
**Who it calls:** AgentWallet (owner() for authorization)
**Trust assumptions:** Factory is the ONLY authorized registrar; AgentWallet.owner() returns correct owner
**Security assumptions:** One wallet = one identity; identityId auto-increments from 1
**Critical invariants:**
- `_walletToIdentity[wallet]` maps exactly ONE wallet to ONE identity
- Identity 0 does NOT exist (starts from 1)
- Only wallet owner can mutate identity state
- Deactivated identity blocks credential linking and metadata updates
- Reactivation of already-active identity reverts

**Issues found during audit:**

### MEDIUM — Credential Linking Has No Versioning
`linkCredential` simply stores the credential ID without any versioning or epoch. If credentials are re-issued, there's no way to detect staleness. The off-chain system must manage this.

### LOW — `ownerOfIdentity` Makes External Call on EVERY Query
Every call to `ownerOfIdentity` calls `IAgentWallet(wallet).owner()`. This is gas-expensive and could be cached. For batch queries, consider returning owner inline.

### INFORMATIONAL — `updatedAt` Set on Every State Change
Good practice. Timestamps provide an audit trail.

---

## 7. OrganizationRegistry

**Purpose:** Source of truth for organizations onboarded to AgentIX. Creates and tracks OrganizationCredentialAnchor clones.

**Responsibilities:**
- Register organizations with deterministic anchor clones
- Deactivate/reactivate organizations
- Propose/accept credential anchor upgrades with timelock
- Query organizations by ID or owner

**What it owns:** Organization mapping, owner-organizations mapping, anchor implementation, pending anchor timelocks
**What it must NEVER own:** ETH, tokens, credential data (stored in anchors)
**Who calls it:** Owner (register, admin), public (views)
**Who it calls:** OrganizationCredentialAnchor (cloneDeterministic, initialize)
**Trust assumptions:** anchorImplementation is correct; organization owners are correctly assigned
**Security assumptions:** organizationId is unique; anchor is created atomically with org
**Critical invariants:**
- One organizationId = one anchor
- Only owner can register/deactivate/reactivate
- Timelock on anchor upgrades (24 hours)

**Issues found during audit:**

### HIGH — Anchor Clone Uses `abi.encode(organizationId)` as Salt
```solidity
address anchor = anchorImplementation.cloneDeterministic(keccak256(abi.encode(organizationId)));
```
This means: if `anchorImplementation` changes AND the new implementation has the same initcode hash, the new anchor would deploy to the SAME address. On anchor upgrade via `proposeCredentialAnchor`/`acceptCredentialAnchor`, the new anchor goes to a DIFFERENT address. But if a new organization is registered with the same ID AFTER an anchor implementation change, it would try to deploy to the same address. **Actually safe**: because the implementation address differs, the CREATE2 address changes with `Clones.cloneDeterministic` which uses `address(this)` + implementation address. The salt reuse is NOT a vulnerability.

### LOW — Organization Reactivation Doesn't Reset State
Reactivating an organization doesn't check if the credential anchor is still valid. If the anchor was compromised or upgraded while inactive, reactivation restores full functionality without re-validation.

---

## 8. OrganizationCredentialAnchor

**Purpose:** Lightweight per-organization contract storing credential roots, epochs, visibility, and metadata.

**Responsibilities:**
- Store currentRoot and revokedRoot for one organization
- Increment epoch counter
- Set visibility (PRIVATE/PUBLIC)
- Store metadata hash

**What it owns:** Roots, epoch, visibility, metadata, organizationId
**What it must NEVER own:** Other organizations' data, ETH
**Who calls it:** Organization owner only
**Who it calls:** No external contracts
**Trust assumptions:** Organization owner is correctly set; one anchor = one org
**Security invariants:**
- `updateRoot` reverts if newRoot == currentRoot
- `updateRevokedRoot` reverts on zero
- `incrementEpoch` is unbounded (no overflow on uint64 for practical purposes)

**Issues found during audit:** None critical. Contract is minimal and well-scoped.

---

## 9. CapabilityRegistry

**Purpose:** Registry for named agent capabilities with Merkle-tree-based grant delegation.

**Responsibilities:**
- Register named capabilities (owner only)
- Revoke capabilities
- Manage per-grantor grant roots
- Revoke individual grant leaves
- Verify capability proofs via MerkleProof

**What it owns:** Capability definitions, grant roots, revoked grants, capability list
**What it must NEVER own:** ETH, tokens
**Who calls it:** Owner (register capability), grantors (update grants), public (verify)
**Who it calls:** OpenZeppelin MerkleProof library
**Trust assumptions:** Grantors correctly manage their Merkle trees; capability IDs are unique
**Security invariants:**
- Revoked capability blocks ALL grant verification
- Revoked grant leaf blocks that specific grant only
- Capability expiry is checked at verification time
- `verifyCapability` is view-only (no state changes)

**Issues found:**

### MEDIUM — `revokeCapability` Uses Swap-and-Pop Pattern Correctly
The swap-and-pop pattern in `revokeCapability` is correctly implemented with index tracking. No storage gap issues.

### INFORMATIONAL — `verifyCapability` Checks `cap.registrar != grantor`
This check requires the registrar to equal the grantor. This means capabilities registered by the owner can only have grants issued by the owner. If a non-owner registrar is needed, this pattern won't work. By design, only owner can register capabilities, so `registrar == owner` always.

---

## 10. DelegationManager

**Purpose:** Hierarchical delegation via Merkle trees with scope-based, multi-hop chain verification.

**Responsibilities:**
- Manage delegation roots per delegator per scope
- Verify single-hop and multi-hop delegation chains
- Register scopes (human-readable action names)
- Revoke individual delegation leaves
- Emergency revoke entire delegator
- Re-authorize delegator (clears all roots)

**What it owns:** Delegation roots, revoked delegations, revoked delegators, scope actions, per-delegator scope tracking
**What it must NEVER own:** ETH, tokens, actual delegated authority
**Who calls it:** Delegators (update roots, revoke leaves), Admin (emergency, scope registration), Public (verify)
**Who it calls:** OpenZeppelin MerkleProof, AccessControl, EnumerableSet
**Trust assumptions:** Delegators correctly manage their Merkle trees; root updaters are trusted
**Security invariants:**
- Revoked delegator blocks ALL delegation verification
- Re-authorization clears ALL stale roots
- MAX_DELEGATION_DEPTH = 10 (protocol constant)
- MAX_SCOPES_PER_DELEGATOR = 32 (enforced via EnumerableSet)
- Chain verification requires hop continuity (delegators[i] == delegates[i-1])
- Expired roots prevent verification
- Revoked leaves prevent verification
- Depth limit enforced per-hop

**Issues found:**

### MEDIUM — `reAuthorizeDelegator` Iterates Over ALL Scopes
If a delegator has 32 scopes, re-authorization loops 32 times. Acceptable but could be optimized with a bulk clear pattern.

### LOW — `verifyDelegationForAction` Hashes Action Every Time
The action string is hashed to scopeHash on every verification call. Callers should pre-compute scope hashes.

### INFORMATIONAL — `registerScope` Cannot Overwrite
Once a scope is registered, the human-readable name is permanent. If a typo occurs, a new scope hash must be registered (old one stays).

---

## Deployment Order

1. **CredentialRegistry** — No dependencies
2. **Groth16Verifier** — No dependencies (standalone)
3. **SessionManager** — Depends on: CredentialRegistry, Groth16Verifier, AgentWalletFactory
4. **AgentWallet** (implementation) — No on-chain dependencies (addresses passed via init)
5. **AgentWalletFactory** — Depends on: AgentWallet impl, SessionManager, EntryPoint
6. **AgentIdentity** — Depends on: AgentWalletFactory
7. **OrganizationRegistry** — Depends on: OrganizationCredentialAnchor impl
8. **OrganizationCredentialAnchor** (implementation) — No dependencies
9. **CapabilityRegistry** — No dependencies
10. **DelegationManager** — No dependencies

### Post-Deployment Wiring:
- SessionManager needs `proposeWalletFactory(factory) + acceptWalletFactory()` (24h timelock)
- CredentialRegistry needs `setSessionManager(sm, true)`
- AgentWalletFactory needs `setAgentIdentity(identity)`

---

## Upgrade Considerations

All upgradeable contracts (via UUPS):
- CredentialRegistry
- SessionManager
- AgentWalletFactory
- AgentIdentity
- OrganizationRegistry
- OrganizationCredentialAnchor
- CapabilityRegistry
- DelegationManager

Non-upgradeable:
- AgentWallet (EIP-1167 clones — new impl via factory timelock)
- Groth16Verifier (standalone — deploy new and point SessionManager)

All upgrades require owner/admin authorization. Storage gaps (`uint256[50] private __gap`) present in all upgradeable contracts.

---

## Known Limitations (V1)

1. Single issuer model in CredentialRegistry — no multi-org credential trees
2. Fixed ZK circuit (Groth16, 7 public signals) — cannot change without new verifier
3. MAX_SESSIONS_PER_WALLET = 100 may be low for enterprise agents
4. No session pause per-wallet (only global pause)
5. No delegation scoping beyond Merkle tree membership
6. OrganizationCredentialAnchor is isolated — cannot cross-reference orgs
7. No credential expiry on-chain (relies on revocation tree)
8. AgentWallet is non-upgradeable (clone pattern)
