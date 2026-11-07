// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error OnlyIssuer();
error NullifierUsed();
error OnlySessionManager();
error RootCannotBeZero();
error NotIssuerOrOwner();

/// @title CredentialRegistry
/// @notice Manages Merkle roots for credential trees and nullifier tracking to prevent double-use.
/// @dev Upgradeable (UUPS). Issuers update roots; SessionManagers consume nullifiers.
///      ROOT CHANGES ARE TIMELOCKED (2 days, matching the codebase convention): issuers
///      propose, anyone (issuer or owner) may cancel while pending, and only after the
///      delay may an issuer accept. There is NO instant root update anymore — a single
///      compromised issuer key can no longer instantly DoS all new sessions (garbage root)
///      or un-revoke credentials. This is a BREAKING change from the previous instant
///      updateActiveRoot/updateRevokedSecretRoot API (removed in this change).
contract CredentialRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    error NoPendingRoot();
    error PendingRootActive();
    error TimelockNotReady();

    event ActiveRootUpdated(bytes32 indexed newRoot);
    event RevokedSecretRootUpdated(bytes32 indexed newRoot);
    event ActiveRootProposed(bytes32 indexed newRoot, uint256 activationTime);
    event ActiveRootUpdateCancelled(bytes32 indexed cancelledRoot);
    event RevokedSecretRootProposed(bytes32 indexed newRoot, uint256 activationTime);
    event RevokedSecretRootUpdateCancelled(bytes32 indexed cancelledRoot);

    mapping(address => bool) public issuers;
    mapping(address => bool) public sessionManagers;
    bytes32 public activeRoot;
    bytes32 public revokedSecretRoot;
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Pending active-root proposal awaiting the timelock.
    bytes32 public pendingActiveRoot;
    /// @notice Timestamp after which the pending active root may be accepted.
    uint256 public activeRootActivationTime;
    /// @notice Pending revoked-secret-root proposal awaiting the timelock.
    bytes32 public pendingRevokedSecretRoot;
    /// @notice Timestamp after which the pending revoked-secret root may be accepted.
    uint256 public revokedSecretRootActivationTime;

    uint256 public constant TIMELOCK_DELAY = 2 days;

    /// @notice Gates issuer-only calls (root proposals and acceptance).
    /// @dev Reverts with `OnlyIssuer` for non-issuers; the deployer is the first issuer (see `initialize`).
    /// Maps to: internal — CredentialRegistry root management
    modifier onlyIssuer() {
        if (!issuers[msg.sender]) revert OnlyIssuer();
        _;
    }

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @dev Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: wires the owner, the pause guard, and makes the owner the first issuer.
    /// @dev Runs once (initializer) from the proxy deployment. Roots start at bytes32(0) — sessions cannot be created until an issuer proposes and accepts a real active root through the timelock.
    /// @param owner_ Admin/owner (pause + upgrade + issuer-admin rights) and initial issuer.
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero owner (OZ `OwnableInvalidOwner`).
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner, sets `issuers[owner_] = true`. Security: deployer-chosen owner becomes first issuer.
    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        issuers[owner_] = true;
    }

    /// @notice Pauses root proposals/acceptance (cancellation and nullifier marking stay available while paused).
    /// @dev Emergency brake for the owner; `cancelActiveRoot`/`cancelRevokedSecretRoot` deliberately have no pause guard so a bad pending root can still be killed mid-pause. Views keep working.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `EnforcedPause` if already paused.
    /// Maps to: TS SDK credential.ts pause (owner admin)
    /// @dev Side effects: sets paused flag. Security: owner-only.
    function pause() external onlyOwner { _pause(); }
    /// @notice Resumes root proposals/acceptance after a pause.
    /// @dev Only the owner may unpause; call after the incident that caused the pause is resolved.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `ExpectedPause` if not paused.
    /// Maps to: TS SDK credential.ts unpause (owner admin)
    /// @dev Side effects: clears paused flag. Security: owner-only.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Grants issuer rights to an address (it may then propose/accept roots).
    /// @dev Owner-only. Idempotent — adding an existing issuer is a no-op, not a revert. Issuers are trusted to propose roots, so grant sparingly; the 2-day timelock is the only check on a compromised issuer.
    /// @param issuer Non-zero address to trust as an issuer (no validation beyond the owner gate — a zero address grant is a harmless no-op entry).
    /// @dev No event is emitted.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners.
    /// Maps to: TS SDK credential.ts addIssuer
    /// @dev Side effects: sets `issuers[issuer] = true`. Security: owner-only; grants root-proposal authority.
    function addIssuer(address issuer) external onlyOwner { issuers[issuer] = true; }
    /// @notice Revokes issuer rights from an address (it can no longer propose/accept roots; pending proposals it made stay pending and may still be cancelled).
    /// @dev Owner-only. Idempotent — removing a non-issuer is a no-op. Removing an issuer does not cancel its pending root proposals; cancel those separately.
    /// @param issuer Address to distrust as an issuer.
    /// @dev No event is emitted.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners.
    /// Maps to: TS SDK credential.ts removeIssuer
    /// @dev Side effects: sets `issuers[issuer] = false`. Security: owner-only.
    function removeIssuer(address issuer) external onlyOwner { issuers[issuer] = false; }
    /// @notice Allows or disallows a SessionManager to consume nullifiers (mark them used at session creation).
    /// @dev Owner-only. Only a registered SessionManager may call `markNullifierUsed`; an unregistered caller reverts there. Set this when deploying or replacing a SessionManager, and unset the old one.
    /// @param sessionManager SessionManager address to allow/disallow. @param allowed True to allow, false to disallow.
    /// @dev No event is emitted.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners.
    /// Maps to: contract SessionManager.createSession (nullifier consumption); TS SDK credential.ts setSessionManager
    /// @dev Side effects: sets `sessionManagers[sessionManager]`. Security: owner-only; gates who may burn nullifiers.
    function setSessionManager(address sessionManager, bool allowed) external onlyOwner { sessionManagers[sessionManager] = allowed; }

    /// @notice Proposes a new active credential root, effective only after the 2-day timelock and `acceptActiveRoot`.
    /// @dev Issuer-only. The timelock is the anti-DoS control: a compromised issuer key can no longer instantly publish a garbage root that blocks all new sessions. Only one proposal may be pending at a time.
    /// @param newRoot Non-zero Merkle root of the active credential tree.
    /// @dev Emits `ActiveRootProposed` with the activation timestamp.
    /// @dev Reverts with `OnlyIssuer` (non-issuer), `RootCannotBeZero` (zero root), `PendingRootActive` (a proposal is already pending), `EnforcedPause` (paused).
    /// Maps to: TS SDK credential.ts proposeActiveRoot; event ActiveRootProposed
    /// @dev Side effects: sets `pendingActiveRoot` and `activeRootActivationTime`, emits `ActiveRootProposed`. Security: issuer-only + 2-day timelock.
    function proposeActiveRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
        if (newRoot == bytes32(0)) revert RootCannotBeZero();
        if (pendingActiveRoot != bytes32(0)) revert PendingRootActive();
        pendingActiveRoot = newRoot;
        activeRootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit ActiveRootProposed(newRoot, activeRootActivationTime);
    }

    /// @notice Activates the pending active root after the 2-day timelock, so new sessions prove against it.
    /// @dev Issuer-only. Any issuer may accept, not just the proposer. Calling early reverts. Sessions created before activation keep proving against the old root until they are created anew — activation does not invalidate live sessions.
    /// @dev Emits `ActiveRootUpdated` with the new root.
    /// @dev Reverts with `OnlyIssuer`, `NoPendingRoot` (nothing proposed), `TimelockNotReady` (delay not yet elapsed), `EnforcedPause`.
    /// Maps to: TS SDK credential.ts acceptActiveRoot; contract SessionManager.createSession (reads `activeRoot`); event ActiveRootUpdated
    /// @dev Side effects: sets `activeRoot`, clears the pending proposal and activation time, emits `ActiveRootUpdated`. Security: issuer-only + timelock.
    function acceptActiveRoot() external onlyIssuer whenNotPaused {
        if (pendingActiveRoot == bytes32(0)) revert NoPendingRoot();
        if (block.timestamp < activeRootActivationTime) revert TimelockNotReady();
        activeRoot = pendingActiveRoot;
        pendingActiveRoot = bytes32(0);
        activeRootActivationTime = 0;
        emit ActiveRootUpdated(activeRoot);
    }

    /// @notice Cancels a pending active-root proposal, so the current root stays in force.
    /// @dev Issuer-or-owner, and deliberately NOT pause-guarded: cancellation is a defensive action that must work during an incident (e.g. a compromised issuer's garbage proposal). Any issuer may cancel, not just the proposer.
    /// @dev Emits `ActiveRootUpdateCancelled` with the cancelled root.
    /// @dev Reverts with `NotIssuerOrOwner` (caller is neither issuer nor owner) or `NoPendingRoot` (nothing proposed). Never reverts for pause.
    /// Maps to: TS SDK credential.ts cancelActiveRoot; event ActiveRootUpdateCancelled
    /// @dev Side effects: clears `pendingActiveRoot` and `activeRootActivationTime`, emits `ActiveRootUpdateCancelled`. Security: issuer-or-owner-only; no pause guard by design.
    function cancelActiveRoot() external {
        if (!issuers[msg.sender] && msg.sender != owner()) revert NotIssuerOrOwner();
        if (pendingActiveRoot == bytes32(0)) revert NoPendingRoot();
        bytes32 cancelled = pendingActiveRoot;
        pendingActiveRoot = bytes32(0);
        activeRootActivationTime = 0;
        emit ActiveRootUpdateCancelled(cancelled);
    }

    /// @notice Proposes a new revoked-secret root, effective only after the 2-day timelock and `acceptRevokedSecretRoot`.
    /// @dev Issuer-only. Same timelock rationale as the active root: a compromised issuer cannot instantly un-revoke credentials (by publishing an empty revoked tree) or mass-revoke them. Only one proposal may be pending at a time.
    /// @param newRoot Non-zero Merkle root of the revoked-secret sparse tree.
    /// @dev Emits `RevokedSecretRootProposed` with the activation timestamp.
    /// @dev Reverts with `OnlyIssuer`, `RootCannotBeZero` (zero root), `PendingRootActive` (a proposal is already pending), `EnforcedPause`.
    /// Maps to: TS SDK credential.ts proposeRevokedSecretRoot; event RevokedSecretRootProposed
    /// @dev Side effects: sets `pendingRevokedSecretRoot` and `revokedSecretRootActivationTime`, emits `RevokedSecretRootProposed`. Security: issuer-only + 2-day timelock.
    function proposeRevokedSecretRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
        if (newRoot == bytes32(0)) revert RootCannotBeZero();
        if (pendingRevokedSecretRoot != bytes32(0)) revert PendingRootActive();
        pendingRevokedSecretRoot = newRoot;
        revokedSecretRootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit RevokedSecretRootProposed(newRoot, revokedSecretRootActivationTime);
    }

    /// @notice Activates the pending revoked-secret root after the 2-day timelock, so new sessions prove non-revocation against it.
    /// @dev Issuer-only. Any issuer may accept, not just the proposer. Note the documented residual: revocation does not kill live sessions — only new session creation checks the revoked root (see `SessionManager.validateSession`).
    /// @dev Emits `RevokedSecretRootUpdated` with the new root.
    /// @dev Reverts with `OnlyIssuer`, `NoPendingRoot`, `TimelockNotReady`, `EnforcedPause`.
    /// Maps to: TS SDK credential.ts acceptRevokedSecretRoot; contract SessionManager.createSession (reads `revokedSecretRoot`); event RevokedSecretRootUpdated
    /// @dev Side effects: sets `revokedSecretRoot`, clears the pending proposal and activation time, emits `RevokedSecretRootUpdated`. Security: issuer-only + timelock.
    function acceptRevokedSecretRoot() external onlyIssuer whenNotPaused {
        if (pendingRevokedSecretRoot == bytes32(0)) revert NoPendingRoot();
        if (block.timestamp < revokedSecretRootActivationTime) revert TimelockNotReady();
        revokedSecretRoot = pendingRevokedSecretRoot;
        pendingRevokedSecretRoot = bytes32(0);
        revokedSecretRootActivationTime = 0;
        emit RevokedSecretRootUpdated(revokedSecretRoot);
    }

    /// @notice Cancels a pending revoked-secret-root proposal, so the current revoked root stays in force.
    /// @dev Issuer-or-owner, and deliberately NOT pause-guarded (defensive action, must work during an incident). Any issuer may cancel, not just the proposer.
    /// @dev Emits `RevokedSecretRootUpdateCancelled` with the cancelled root.
    /// @dev Reverts with `NotIssuerOrOwner` or `NoPendingRoot`. Never reverts for pause.
    /// Maps to: TS SDK credential.ts cancelRevokedSecretRoot; event RevokedSecretRootUpdateCancelled
    /// @dev Side effects: clears `pendingRevokedSecretRoot` and `revokedSecretRootActivationTime`, emits `RevokedSecretRootUpdateCancelled`. Security: issuer-or-owner-only; no pause guard by design.
    function cancelRevokedSecretRoot() external {
        if (!issuers[msg.sender] && msg.sender != owner()) revert NotIssuerOrOwner();
        if (pendingRevokedSecretRoot == bytes32(0)) revert NoPendingRoot();
        bytes32 cancelled = pendingRevokedSecretRoot;
        pendingRevokedSecretRoot = bytes32(0);
        revokedSecretRootActivationTime = 0;
        emit RevokedSecretRootUpdateCancelled(cancelled);
    }

    /// @notice Burns a session nullifier so the same credential proof can never create a second session (replay protection).
    /// @dev Only a registered SessionManager may call it — this is the single-use enforcement for ZK sessions. The nullifier comes from the circuit output (`publicSignals[6]`); burning happens inside `createSession` after the proof verifies, so a failed proof never burns anything. There is no un-burn path.
    /// @param nullifier The nullifier hash to mark used; zero nullifiers are rejected upstream in `createSession`, not here.
    /// @dev No event is emitted (the SessionManager emits `SessionCreated` with the nullifier).
    /// @dev Reverts with `OnlySessionManager` (caller not a registered SessionManager) or `NullifierUsed` (nullifier already burned — replay attempt).
    /// Maps to: contract SessionManager.createSession; circuit CredentialCircuit nullifier output
    /// @dev Side effects: sets `usedNullifiers[nullifier] = true`. Security: registered-SessionManager-only; one-way burn.
    function markNullifierUsed(bytes32 nullifier) external {
        if (!sessionManagers[msg.sender]) revert OnlySessionManager();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        usedNullifiers[nullifier] = true;
    }

    /// @notice Reports whether a nullifier has already been burned (i.e. its credential proof was already used to create a session).
    /// @dev Read-only; anyone may call it. Used by `createSession` as a pre-check, but the authoritative check is `markNullifierUsed` reverting on reuse — a nullifier can be burned between this read and the session creation.
    /// @param nullifier The nullifier hash to check.
    /// @return True if already used (replay — must be rejected), false if still fresh.
    /// Maps to: contract SessionManager.createSession (pre-check); TS SDK credential.ts isNullifierUsed
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrading changes root/nullifier enforcement — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[46] private __gap;
}
