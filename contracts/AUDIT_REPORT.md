# Professional Smart Contract Audit Report — AgentIX Core Contracts

**Audit Date:** 2026-06-29
**Auditor:** MiMoCode Security Audit
**Audit Scope:** All 11 Solidity contracts in `contracts/src/`
**Solidity Version:** 0.8.24 (viaIR, optimizer 200 runs)
**OpenZeppelin Version:** 5.3.0 (contracts + contracts-upgradeable)
**Network:** Base Sepolia (chainId 84532)

---

## Executive Summary

This audit covers the AgentIX smart contract ecosystem — an on-chain infrastructure for AI agent identity, credentials, sessions, delegation, and capability management. The system consists of 10 production contracts and 1 mock verifier (auto-generated Groth16Verifier).

**Overall Risk Assessment: MEDIUM**

The codebase demonstrates solid engineering: consistent UUPS upgrade patterns, reentrancy guards, pausability, timelock mechanisms, and proper use of OpenZeppelin 5.3.0 libraries. However, several access control gaps and missing input validations create exploitable paths ranging from low to medium severity.

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | — |
| HIGH | 2 | 0 Fixed, 2 Open |
| MEDIUM | 5 | 0 Fixed, 5 Open |
| LOW | 7 | 0 Fixed, 7 Open |
| INFORMATIONAL | 6 | — |
| **TOTAL** | **20** | |

---

## Contracts Audited

| # | Contract | Lines | Upgradeable | Key Role |
|---|----------|-------|-------------|----------|
| 1 | `AgentWallet.sol` | 438 | No (clone) | ERC-4337 smart wallet |
| 2 | `AgentWalletFactory.sol` | 221 | Yes (UUPS) | Deterministic wallet factory |
| 3 | `SessionManager.sol` | 481 | Yes (UUPS) | Session auth + spend limits |
| 4 | `CredentialRegistry.sol` | 73 | Yes (UUPS) | Merkle root + nullifier tracking |
| 5 | `DelegationManager.sol` | 286 | Yes (UUPS) | Hierarchical delegation |
| 6 | `CapabilityRegistry.sol` | 148 | Yes (UUPS) | Capability grant verification |
| 7 | `OrganizationRegistry.sol` | 155 | Yes (UUPS) | Organization onboarding |
| 8 | `OrganizationCredentialAnchor.sol` | 84 | Yes (UUPS) | Per-org trust domain |
| 9 | `AgentIdentity.sol` | 207 | Yes (UUPS) | On-chain agent identity |
| 10 | `CredentialVerifierV1.sol` | 210 | No | Groth16 ZK verifier |
| 11 | `MockVerifier.sol` | 29 | No | Test mock |

---

## Detailed Findings

### HIGH-01: AgentWallet.execute Allows ETH Transfer to Zero Address

**File:** `AgentWallet.sol:190-198`
**Severity:** HIGH
**Type:** Loss of Funds

```solidity
function execute(
    address target,
    uint256 value,
    bytes calldata data
) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
    (bool success,) = target.call{value: value}(data);
    if (!success) revert ExecutionFailedError();
    emit ExecutionPerformed(msg.sender, target, value, keccak256(data));
}
```

**Description:** The `execute` function does not validate that `target` is a non-zero address. If the owner or EntryPoint calls `execute` with `target = address(0)` and `value > 0`, the ETH is permanently burned (sent to `address(0)` with no code). There is no `target != address(0)` check, and no code-length check for the target.

**Impact:** Permanent loss of ETH from the wallet.

**Recommendation:**
```solidity
function execute(
    address target,
    uint256 value,
    bytes calldata data
) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
    if (target == address(0)) revert InvalidRecipientError();
    (bool success,) = target.call{value: value}(data);
    if (!success) revert ExecutionFailedError();
    emit ExecutionPerformed(msg.sender, target, value, keccak256(data));
}
```

---

### HIGH-02: CredentialRegistry Issuer Can Set activeRoot to Zero Hash

**File:** `CredentialRegistry.sol:50-53`
**Severity:** HIGH
**Type:** Broken Credential System

```solidity
function updateActiveRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
    activeRoot = newRoot;
    emit ActiveRootUpdated(newRoot);
}
```

**Description:** An issuer can set `activeRoot` to `bytes32(0)`. Since `SessionManager.createSession` checks `publicSignals[0] == registry.activeRoot()`, setting the root to zero means the only valid credential tree is an empty one. This would either:
1. Allow session creation with no actual credentials (if the ZK circuit accepts an empty tree), OR
2. Brick all session creation until the root is restored.

A compromised or malicious issuer can freeze the entire session system or allow unauthorized session creation.

**Impact:** System-wide credential invalidation or unauthorized session creation.

**Recommendation:**
```solidity
function updateActiveRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
    if (newRoot == bytes32(0)) revert InvalidRoot();
    activeRoot = newRoot;
    emit ActiveRootUpdated(newRoot);
}
```

Apply the same fix to `updateRevokedSecretRoot`.

---

### MED-01: CapabilityRegistry Allows Arbitrary Grant Root Assignment

**File:** `CapabilityRegistry.sol:92-98`
**Severity:** MEDIUM
**Type:** Unauthorized Capability Grant

```solidity
function updateGrantRoot(address grantee, bytes32 capabilityId, bytes32 newRoot) external whenNotPaused {
    if (grantee == address(0)) revert InvalidRecipient();
    if (capabilities[capabilityId].createdAt == 0) revert CapabilityNotFound();
    if (newRoot == bytes32(0)) revert InvalidRoot();
    grantRoots[msg.sender][grantee][capabilityId] = newRoot;
    emit GrantRootUpdated(msg.sender, grantee, capabilityId, newRoot);
}
```

**Description:** Any address can call `updateGrantRoot` to set a Merkle root for any grantee under any capability. The `grantRoots` mapping is keyed by `msg.sender` (the grantor), so the grantor must be the same address whose root is verified in `verifyCapability`. However:

1. An attacker can set `grantRoots[attacker][victim][capId]` to a malicious root that includes the victim's address.
2. If `verifyCapability` is called with `grantor = attacker`, it will verify against the attacker's root — which the attacker controls.
3. The `cap.registrar != grantor` check at line 120 prevents this if the attacker is not the capability registrar. But the **registrar itself** can set arbitrary roots for any agent.

**Impact:** A capability registrar can grant capabilities to arbitrary agents without proper authorization flow.

**Recommendation:** Require the grantor to be the capability registrar, or add an off-chain authorization step:
```solidity
function updateGrantRoot(address grantee, bytes32 capabilityId, bytes32 newRoot) external whenNotPaused {
    if (grantee == address(0)) revert InvalidRecipient();
    CapabilityDef storage cap = capabilities[capabilityId];
    if (cap.createdAt == 0) revert CapabilityNotFound();
    if (cap.registrar != msg.sender) revert NotAuthorizedForCapability();
    if (newRoot == bytes32(0)) revert InvalidRoot();
    grantRoots[msg.sender][grantee][capabilityId] = newRoot;
    emit GrantRootUpdated(msg.sender, grantee, capabilityId, newRoot);
}
```

---

### MED-02: AgentWallet Session Validation Only Checks First Target in Batch

**File:** `AgentWallet.sol:422-437`
**Severity:** MEDIUM
**Type:** Authorization Bypass

```solidity
function _extractTarget(bytes calldata callData) internal pure returns (address) {
    bytes4 selector = bytes4(callData[:4]);
    if (selector == EXECUTE_SELECTOR) {
        (address target,,) = abi.decode(callData[4:], (address, uint256, bytes));
        return target;
    }
    if (selector == EXECUTE_BATCH_SELECTOR) {
        (address[] memory targets,,) = abi.decode(callData[4:], (address[], uint256[], bytes[]));
        if (targets.length > 0) return targets[0];
        return address(0);
    }
    revert UnsupportedCallDataError();
}
```

**Description:** When a session-based UserOp uses `executeBatch`, only the first target is extracted for session validation. While batch operations are blocked for sessions (`BatchNotAllowedForSessionError` at line 339), if this check were ever removed or bypassed during a future upgrade, subsequent targets would not be validated against the session's allowed targets.

**Impact:** Currently mitigated by the batch blocking. Becomes exploitable if batch is enabled for sessions in a future upgrade.

**Recommendation:** Remove the batch target extraction path since batch is never allowed for sessions, or document this as a security invariant for future upgrades.

---

### MED-03: AgentWallet.initialize Does Not Set `initialized = true` Before External Call

**File:** `AgentWallet.sol:143-165`
**Severity:** MEDIUM
**Type:** Reentrancy / Initialization Race

```solidity
function initialize(
    address _owner,
    address _sessionManager,
    address _entryPoint
) external {
    if (initialized) revert AlreadyInitializedError();
    // ... validation ...
    owner = _owner;
    sessionManager = _sessionManager;
    entryPoint = _entryPoint;

    (bool erc1820Ok, ) = ERC1820_REGISTRY.call(
        abi.encodeWithSignature("setInterfaceImplementer(address,bytes32,address)",
            address(this), ERC777_TOKENS_RECIPIENT_HASH, address(this))
    );
    erc1820Ok;
    initialized = true;
    emit WalletInitialized(_owner, _sessionManager, _entryPoint);
}
```

**Description:** The `initialized` flag is set to `true` AFTER the external call to the ERC1820 registry. If a malicious contract were deployed at the ERC1820_REGISTRY address (possible on non-mainnet chains), it could re-enter `initialize` before `initialized = true` is set, potentially re-initializing the wallet with a different owner.

On mainnet/Base Sepolia, the ERC1820 registry is a fixed address (`0x1820a4b7618BD7140785a44aF1a4f87C3332006C`) and is not contract-callable in a reentrant way. However, this is a defense-in-depth concern.

**Impact:** Theoretical reentrancy on non-standard chains. Low practical impact on Base Sepolia.

**Recommendation:** Set `initialized = true` before the external call:
```solidity
function initialize(...) external {
    if (initialized) revert AlreadyInitializedError();
    // ... validation ...
    initialized = true; // Set before external call
    owner = _owner;
    // ...
}
```

---

### MED-04: SessionManager Missing Validation for publicSignals Length Encoding

**File:** `SessionManager.sol:213-220`
**Severity:** MEDIUM
**Type:** Logic Error

```solidity
bytes32 nullifier = bytes32(publicSignals[6]);
if (nullifier == bytes32(0)) revert InvalidNullifier();
if (uint256(registry.activeRoot()) != publicSignals[0]) revert RootMismatch();
if (uint256(registry.revokedSecretRoot()) != publicSignals[1]) revert RevokedRootMismatch();
```

**Description:** The checks at lines 215-216 cast `registry.activeRoot()` (bytes32) to `uint256` for comparison with `publicSignals[0]` (uint256). This works because `bytes32` and `uint256` are both 32 bytes, but the comparison is comparing a bytes32 value reinterpreted as uint256 against a uint256. If the Merkle root has leading zeros, the uint256 interpretation is correct (leading zeros in bytes32 become leading zeros in uint256). This is technically correct but fragile — a future change to the root representation could break the comparison silently.

**Impact:** No immediate impact. Code correctness depends on implicit bytes32↔uint256 equivalence.

**Recommendation:** Add a comment documenting this invariant, or use explicit casting:
```solidity
if (bytes32(registry.activeRoot()) != bytes32(publicSignals[0])) revert RootMismatch();
```

---

### MED-05: OrganizationCredentialAnchor.updateRevokedRoot Allows Setting to Zero

**File:** `OrganizationCredentialAnchor.sol:56-59`
**Severity:** MEDIUM
**Type:** Data Integrity

```solidity
function updateRevokedRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
    bytes32 old = revokedRoot;
    revokedRoot = newRoot;
    emit RevokedRootUpdated(organizationId, old, newRoot);
}
```

**Description:** Unlike `updateRoot` (which checks `newRoot == currentRoot`), `updateRevokedRoot` allows setting the revoked root to `bytes32(0)`. If an organization uses the revoked root for credential verification, setting it to zero could allow revoked credentials to pass verification (depending on the circuit logic).

**Impact:** Potential bypass of revoked credential checks.

**Recommendation:** Either add a zero-check or document that zero is a valid "no revoked credentials" state:
```solidity
function updateRevokedRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
    // newRoot == bytes32(0) is allowed to indicate "no revoked credentials"
    bytes32 old = revokedRoot;
    revokedRoot = newRoot;
    emit RevokedRootUpdated(organizationId, old, newRoot);
}
```

---

### LOW-01: AgentWallet.executeBatch Does Not Check Target Address Validity

**File:** `AgentWallet.sol:205-223`
**Severity:** LOW
**Type:** Loss of Funds

```solidity
function executeBatch(
    address[] calldata targets,
    uint256[] calldata values,
    bytes[] calldata data
) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
    // ...
    for (uint256 i = 0; i < targets.length; i++) {
        totalValue += values[i];
        (bool success,) = targets[i].call{value: values[i]}(data[i]);
        if (!success) revert CallFailedError();
    }
}
```

**Description:** No validation that individual targets are non-zero or have code. ETH sent to `address(0)` in a batch is burned.

**Recommendation:** Add `address(0)` check for each target in the batch loop.

---

### LOW-02: SessionManager.pruneExpiredSessions Has O(n) Gas Complexity

**File:** `SessionManager.sol:455-476`
**Severity:** LOW
**Type:** Gas Limit DoS

```solidity
function pruneExpiredSessions(address wallet, uint256 limit) external onlyWallet {
    bytes32[] storage sessionIds = walletSessions[wallet];
    uint256 pruned;
    for (int256 i = int256(sessionIds.length) - 1; i >= 0 && pruned < limit; i--) {
        // ... check expiry and prune ...
    }
}
```

**Description:** With `MAX_SESSIONS_PER_WALLET = 100`, worst-case iteration is 100 iterations. The `limit` parameter provides some protection, but a wallet with many non-expired sessions interleaved with expired ones could still consume significant gas.

**Impact:** Gas limit reached before all expired sessions are pruned. Not a DoS due to the limit parameter, but could be gas-inefficient.

**Recommendation:** Consider a bitmap or linked-list approach for O(1) pruning, though the current design is acceptable for the 100-session cap.

---

### LOW-03: DelegationManager Scope Limit Uses Hardcoded 32

**File:** `DelegationManager.sol:146`
**Severity:** LOW
**Type:** Inconsistency

```solidity
if (EnumerableSet.length(_delegatorScopes[delegator]) >= 32) revert ScopeLimitExceeded();
```

**Description:** The scope limit of 32 is hardcoded but not declared as a named constant like `MAX_DELEGATION_DEPTH`. This makes the limit harder to discover and document.

**Recommendation:** Extract to a named constant:
```solidity
uint256 public constant MAX_SCOPES_PER_DELEGATOR = 32;
```

---

### LOW-04: AgentWalletFactory Does Not Track walletCount Increment for Idempotent Calls

**File:** `AgentWalletFactory.sol:200-216`
**Severity:** LOW
**Type:** Accounting Error

```solidity
function _createWallet(address owner, bytes32 salt) internal returns (address wallet) {
    // ...
    if (wallet.code.length == 0) {
        wallet = implementation.cloneDeterministic(salt);
        IAgentWallet(wallet).initialize(owner, sessionManager, entryPoint);
        agentWallets[wallet] = true;
        walletCount++;
        // ...
    } else if (IAgentWallet(wallet).owner() != owner) {
        revert WalletAlreadyExistsWithDifferentOwner();
    }
}
```

**Description:** When `createWallet` is called with an existing owner and the same salt, the wallet already exists and `walletCount` is NOT incremented. This is correct behavior for idempotent calls, but the `salt` generation in `createWallet(address)` uses `walletCount` as part of the hash:
```solidity
bytes32 salt = keccak256(abi.encode(owner, block.chainid, walletCount));
```

If two `createWallet(owner)` calls happen in rapid succession before the first completes, both could generate the same salt (since `walletCount` hasn't been incremented yet). This is mitigated by the factory being called sequentially on-chain.

**Impact:** No practical impact on single-chain deployment. Theoretical front-running concern on reorg-prone chains.

**Recommendation:** No change needed; document the sequential execution assumption.

---

### LOW-05: CapabilityRegistry revokeCapability Mutates Array In-Place

**File:** `CapabilityRegistry.sol:75-90`
**Severity:** LOW
**Type:** Gas Optimization / Data Integrity

```solidity
function revokeCapability(bytes32 capabilityId) external {
    // ...
    uint256 index = capabilityIndex[capabilityId];
    bytes32 lastId = capabilityList[capabilityList.length - 1];
    capabilityList[index] = lastId;
    capabilityIndex[lastId] = index;
    capabilityList.pop();
    delete capabilityIndex[capabilityId];
    // ...
}
```

**Description:** The swap-and-pop pattern correctly maintains the array, but `delete capabilityIndex[capabilityId]` is redundant since `capabilityIndex[capabilityId]` was already used as `index`. After the swap, the old index position now contains `lastId`, so the old `capabilityIndex[capabilityId]` value is stale. The `delete` is correct but unnecessary since the mapping entry for a revoked capability is never read again.

**Impact:** Negligible gas overhead.

**Recommendation:** The `delete` is fine as defensive coding. No change needed.

---

### LOW-06: AgentWallet._validateSignature Allows Any 65-byte Signature for Owner

**File:** `AgentWallet.sol:348-363`
**Severity:** LOW
**Type:** Signature Malleability

```solidity
function _validateSignature(
    PackedUserOperation calldata userOp,
    bytes32 userOpHash
) internal view returns (address signer) {
    bytes32 digest = userOpHash.toEthSignedMessageHash();
    if (userOp.signature.length == 65) {
        signer = digest.recover(userOp.signature);
        if (signer != owner) revert InvalidOwnerSignatureError();
        return signer;
    }
    // ... session path ...
}
```

**Description:** ECDSA signatures are malleable — for any valid `(v, r, s)` signature, `(v', r, s')` where `v' = v ^ 1` and `s' = curve_order - s` produces the same signer. This is mitigated by:
1. ERC-4337 EntryPoint checks EIP-1271 and signature uniqueness
2. The `userOpHash` includes the nonce, preventing replay
3. OpenZeppelin 5.3.0 ECDSA.recover does not enforce `s < curve_order / 2`

However, the malleability is not exploitable here because the nonce prevents replay and the signer check prevents unauthorized execution.

**Impact:** No practical impact. ECDSA malleability is a known property that is mitigated by the nonce mechanism.

**Recommendation:** Consider using `ECDSA.recover` with `checkinality: true` (OZ 5.x feature) if available:
```solidity
signer = digest.recover(userOp.signature, true);
```

---

### LOW-07: OrganizationRegistry Allows Creating Organizations for Any Owner

**File:** `OrganizationRegistry.sol:70`
**Severity:** LOW
**Type:** Privilege Escalation

```solidity
function registerOrganization(bytes32 organizationId, string calldata name, address owner_) external onlyOwner {
```

**Description:** Only the registry owner can create organizations, but the `owner_` parameter can be any address. This is by design (the registry is an admin-managed system), but it means a compromised registry owner can create organizations on behalf of arbitrary addresses without their consent.

**Impact:** Admin-only privilege. If the registry owner is compromised, arbitrary organizations can be created.

**Recommendation:** Consider requiring the organization owner to submit a registration request that the registry owner approves, or document this as an accepted admin trust model.

---

### INF-01: Inconsistent Naming Convention for `owner()` Access

**Contracts:** AgentWallet, AgentIdentity, AgentWalletFactory, SessionManager

**Description:** AgentWallet uses `owner` (public state variable), while AgentIdentity uses `Ownable2StepUpgradeable` (which provides `owner()`). Both work correctly, but the inconsistency could confuse developers.

---

### INF-02: Missing Events for Admin State Changes

**Contracts:** CredentialRegistry, CapabilityRegistry

**Description:** `addIssuer`, `removeIssuer`, `setSessionManager` in CredentialRegistry and `setRootUpdater` in DelegationManager do not emit events. This makes it harder to track admin actions off-chain.

---

### INF-03: Mixed Use of `onlyOwner` and `onlyRole(DEFAULT_ADMIN_ROLE)`

**Contracts:** SessionManager vs DelegationManager

**Description:** SessionManager uses `OwnableUpgradeable` with `onlyOwner`, while DelegationManager uses `AccessControlUpgradeable` with `onlyRole(DEFAULT_ADMIN_ROLE)`. Both are correct, but the inconsistency across the protocol could confuse integrators.

---

### INF-04: CredentialVerifierV1 Uses Different Pragma

**File:** `CredentialVerifierV1.sol:21`
**Description:** `pragma solidity >=0.7.0 <0.9.0` differs from all other contracts (`pragma solidity ^0.8.24`). This is acceptable for auto-generated Groth16 verifiers but should be noted for compilation consistency.

---

### INF-05: SessionManager Uses Non-Upgradeable ReentrancyGuard

**File:** `SessionManager.sol:4`
**Description:** `SessionManager` imports `ReentrancyGuard` (non-upgradeable) alongside `PausableUpgradeable`, `UUPSUpgradeable`, and `OwnableUpgradeable`. This is correct — the non-upgradeable `ReentrancyGuard` uses transient storage (EIP-1153) in OZ 5.x and doesn't need a storage slot. However, it's an unusual pattern.

---

### INF-06: No EIP-1271 Support in AgentWallet

**File:** `AgentWallet.sol`

**Description:** AgentWallet does not implement `isValidSignature(bytes32, bytes)` (EIP-1271). This means the wallet cannot be used as a smart contract signer for off-chain message verification. This may be intentional if the wallet is only used for on-chain execution, but limits composability with protocols that require EIP-1271.

---

## Architecture Review

### System Design

The AgentIX protocol implements a layered architecture:

```
┌─────────────────────────────────────┐
│        Organization Layer           │
│  OrganizationRegistry               │
│  OrganizationCredentialAnchor       │
├─────────────────────────────────────┤
│        Identity Layer               │
│  AgentIdentity                      │
├─────────────────────────────────────┤
│        Credential Layer             │
│  CredentialRegistry                 │
│  CredentialVerifierV1 (Groth16)     │
├─────────────────────────────────────┤
│        Authorization Layer          │
│  SessionManager (std + lightweight) │
│  DelegationManager (Merkle)         │
│  CapabilityRegistry (Merkle)        │
├─────────────────────────────────────┤
│        Execution Layer              │
│  AgentWallet (ERC-4337)             │
│  AgentWalletFactory (CREATE2)       │
└─────────────────────────────────────┘
```

### Upgrade Safety

All UUPS contracts use `uint256[50] private __gap` for storage gap. However:

| Contract | Gap Size | Inherited Storage | Total Reserved |
|----------|----------|-------------------|----------------|
| SessionManager | 50 slots | ~5 (ReentrancyGuard, Pausable, UUPS, Ownable) | 55 |
| AgentWalletFactory | 50 slots | ~4 (Pausable, UUPS, Ownable) | 54 |
| CredentialRegistry | 50 slots | ~4 | 54 |
| DelegationManager | 50 slots | ~8 (AccessControl, Pausable, UUPS) | 58 |
| CapabilityRegistry | 50 slots | ~4 | 54 |
| OrganizationRegistry | 50 slots | ~4 | 54 |
| OrganizationCredentialAnchor | 50 slots | ~4 | 54 |
| AgentIdentity | 50 slots | ~7 (Pausable, UUPS, Ownable2Step, ReentrancyGuard) | 57 |

The gap sizes are consistent and sufficient for future upgrades. However, a future V2 upgrade that adds significant storage should verify the gap is not exhausted.

### Access Control Matrix

| Function | AgentWallet | SessionManager | CredentialRegistry | DelegationManager | CapabilityRegistry | OrgRegistry |
|----------|-------------|----------------|--------------------|--------------------|--------------------|-------------|
| createSession | wallet itself | — | — | — | — | — |
| validateSession | — | onlyWallet | — | — | — | — |
| updateRoot | — | — | onlyIssuer | — | — | — |
| updateDelegationRoot | — | — | — | delegator or ROOT_UPDATER | — | — |
| updateGrantRoot | — | — | — | — | anyone | — |
| registerOrganization | — | — | — | — | — | onlyOwner |
| pause/unpause | — | onlyOwner | onlyOwner | DEFAULT_ADMIN | onlyOwner | onlyOwner |

---

## Gas Optimization Opportunities

1. **SessionManager.validateLightweightSession target loop** (line 375): Replace linear scan with a mapping for O(1) lookup:
   ```solidity
   mapping(bytes32 => mapping(address => bool)) public sessionTargetSet;
   ```

2. **CapabilityRegistry.revokeCapability** (line 82): The `capabilityIndex[capabilityId]` lookup after the swap is redundant; use the local `index` variable.

3. **DelegationManager.verifyDelegationChain** (line 216): The loop creates multiple calldata copies. Consider using `assembly` for calldata forwarding if gas optimization is critical.

---

## Positive Observations

1. **Consistent UUPS Pattern**: All upgradeable contracts follow the same initialization pattern with `_disableInitializers()` in the constructor.

2. **Timelock Mechanisms**: SessionManager, AgentWallet, and AgentWalletFactory all implement 24-hour timelocks for critical state changes (factory updates, session manager changes, entry point changes).

3. **Reentrancy Protection**: All state-mutating functions that interact with external contracts use `nonReentrant`.

4. **Pausability**: All production contracts implement `PausableUpgradeable` for emergency stops.

5. **ECDSA Signature Validation**: SessionManager uses OZ's `ECDSA.recover` with proper `\x19Ethereum Signed Message:\n32` prefix for lightweight sessions.

6. **Nullifier Replay Protection**: The `CredentialRegistry` + `SessionManager` combination correctly prevents ZK proof reuse via nullifier tracking.

7. **Session Cap**: `MAX_SESSIONS_PER_WALLET = 100` prevents unbounded growth of the `walletSessions` array.

8. **Custom Errors**: All contracts use custom errors instead of `require` strings, saving deployment gas and providing clearer revert reasons.

9. **Storage Gap**: All UUPS contracts maintain `uint256[50] private __gap` for safe upgrades.

10. **Clone Pattern**: AgentWallet uses EIP-1167 minimal proxies via `Clones.cloneDeterministic`, which is gas-efficient and enables deterministic addresses.

---

## Recommendations Summary

| # | Severity | Finding | Recommendation |
|---|----------|---------|----------------|
| HIGH-01 | HIGH | execute allows zero address target | Add `target != address(0)` check |
| HIGH-02 | HIGH | Issuer can set activeRoot to zero | Add `newRoot != bytes32(0)` check |
| MED-01 | MEDIUM | Arbitrary grant root assignment | Restrict to registrar or add auth |
| MED-02 | MEDIUM | Batch target only checks first | Remove unused batch extraction |
| MED-03 | MEDIUM | initialize sets flag after external call | Move `initialized = true` before call |
| MED-04 | MEDIUM | bytes32↔uint256 implicit cast | Add explicit cast or document |
| MED-05 | MEDIUM | updateRevokedRoot allows zero | Add zero check or document |
| LOW-01 | LOW | executeBatch no target validation | Add address(0) check per target |
| LOW-02 | LOW | pruneExpiredSessions O(n) | Acceptable given 100 cap |
| LOW-03 | LOW | Hardcoded scope limit 32 | Extract to named constant |
| LOW-04 | LOW | walletCount race condition | Acceptable on single-chain |
| LOW-05 | LOW | Redundant delete in revokeCapability | Defensive coding, acceptable |
| LOW-06 | LOW | ECDSA malleability | Mitigated by nonce, use checkinality |
| LOW-07 | LOW | Org owner can be any address | Document admin trust model |

---

## Compilation & Test Environment

```
Solidity: 0.8.24 (viaIR, optimizer 200 runs, EVM target paris)
OpenZeppelin: 5.3.0 (contracts + contracts-upgradeable)
Hardhat: 2.22.19
TypeChain: ethers-v6
Network: Base Sepolia (chainId 84532)
```

---

## Disclaimer

This audit represents a point-in-time assessment of the codebase as of 2026-06-29. It does not guarantee the absence of vulnerabilities. Smart contracts are complex systems, and new attack vectors may emerge over time. The findings and recommendations in this report should be addressed according to the project's risk tolerance and timeline.

---

*Report generated by MiMoCode Security Audit*
