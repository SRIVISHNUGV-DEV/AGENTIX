// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error InvalidOrganizationId();
error RootAlreadyCurrent();
error UnauthorizedUpdate();
error RevokedRootCannotBeZero();

/// @title OrganizationCredentialAnchor
/// @notice Lightweight EIP1167 clone per organization. Stores credential roots, epochs,
///         and visibility settings. One anchor = one organization's trust domain.
/// @dev UUPS upgradeable. Cloned by OrganizationRegistry. Never used directly.
///      ROOT CHANGES ARE TIMELOCKED (2 days): the owner proposes, may cancel while pending,
///      and only after the delay may accept. There is NO instant root update anymore —
///      updateRoot/updateRevokedRoot were replaced by propose/accept/cancel (breaking change).
contract OrganizationCredentialAnchor is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    error NoPendingRoot();
    error PendingRootActive();
    error TimelockNotReady();

    enum Visibility { PRIVATE, PUBLIC }

    event RootUpdated(bytes32 indexed organizationId, bytes32 oldRoot, bytes32 newRoot);
    event RevokedRootUpdated(bytes32 indexed organizationId, bytes32 oldRoot, bytes32 newRoot);
    event RootProposed(bytes32 indexed organizationId, bytes32 newRoot, uint256 activationTime);
    event RootUpdateCancelled(bytes32 indexed organizationId, bytes32 cancelledRoot);
    event RevokedRootProposed(bytes32 indexed organizationId, bytes32 newRoot, uint256 activationTime);
    event RevokedRootUpdateCancelled(bytes32 indexed organizationId, bytes32 cancelledRoot);
    event EpochIncremented(bytes32 indexed organizationId, uint64 newEpoch);
    event VisibilityChanged(bytes32 indexed organizationId, Visibility newVisibility);
    event MetadataHashUpdated(bytes32 indexed organizationId, bytes32 newMetadataHash);

    bytes32 public organizationId;
    bytes32 public currentRoot;
    bytes32 public revokedRoot;
    uint64 public currentEpoch;
    bytes32 public metadataHash;
    Visibility public visibility;

    /// @notice Pending root proposal awaiting the timelock.
    bytes32 public pendingRoot;
    /// @notice Timestamp after which the pending root may be accepted.
    uint256 public rootActivationTime;
    /// @notice Pending revoked-root proposal awaiting the timelock.
    bytes32 public pendingRevokedRoot;
    /// @notice Timestamp after which the pending revoked root may be accepted.
    uint256 public revokedRootActivationTime;

    uint256 public constant TIMELOCK_DELAY = 2 days;

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @return Nothing. Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: binds the organization id and the owner who manages this anchor's roots.
    /// @dev Runs once (initializer), called by OrganizationRegistry right after cloning. Roots, epoch, and metadata all start zeroed; visibility defaults to PRIVATE (enum value 0).
    /// @param organizationId_ Non-zero id of the organization this anchor belongs to. @param owner_ Address allowed to manage roots/epoch/visibility (normally the organization owner).
    /// @return Nothing.
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero organization id (`InvalidOrganizationId`); a zero owner reverts via OZ `OwnableInvalidOwner`.
    /// Maps to: contract OrganizationRegistry.registerOrganization (clones + initializes); deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner, `organizationId`. Security: the registry passes the organization owner as `owner_`.
    function initialize(bytes32 organizationId_, address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        if (organizationId_ == bytes32(0)) revert InvalidOrganizationId();
        organizationId = organizationId_;
    }

    /// @notice Pauses root proposals/acceptance and epoch bumps (cancellation and visibility/metadata writes stay available while paused).
    /// @dev Emergency brake for the anchor owner; `cancelRoot`/`cancelRevokedRoot` deliberately have no pause guard so a bad pending root can still be killed mid-pause. Views keep working.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `EnforcedPause` if already paused.
    /// Maps to: TS SDK organization.ts pause (anchor owner)
    /// @dev Side effects: sets paused flag. Security: owner-only.
    function pause() external onlyOwner { _pause(); }
    /// @notice Resumes root proposals/acceptance and epoch bumps after a pause.
    /// @dev Only the owner may unpause; call after the incident that caused the pause is resolved.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `ExpectedPause` if not paused.
    /// Maps to: TS SDK organization.ts unpause (anchor owner)
    /// @dev Side effects: clears paused flag. Security: owner-only.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Proposes a new credential root for the organization, effective only after the 2-day timelock and `acceptRoot`.
    /// @dev Owner-only. The timelock is the anti-DoS control: a compromised owner key cannot instantly publish a garbage root that breaks verification for the whole organization. Only one proposal may be pending at a time. Note the asymmetry with `proposeRevokedRoot`: a zero root is NOT rejected here — proposing bytes32(0) clears the root at accept (see report).
    /// @param newRoot Proposed Merkle root (zero allowed — clears the root on accept); must differ from the current root.
    /// @return Nothing; emits `RootProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `RootAlreadyCurrent` (same as current root), `PendingRootActive` (a proposal is already pending), `EnforcedPause`.
    /// Maps to: TS SDK organization.ts proposeRoot; event RootProposed
    /// @dev Side effects: sets `pendingRoot` and `rootActivationTime`, emits `RootProposed`. Security: owner-only + 2-day timelock.
    function proposeRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
        if (newRoot == currentRoot) revert RootAlreadyCurrent();
        if (pendingRoot != bytes32(0) || rootActivationTime != 0) revert PendingRootActive();
        pendingRoot = newRoot;
        rootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit RootProposed(organizationId, newRoot, rootActivationTime);
    }

    /// @notice Activates the pending credential root after the 2-day timelock.
    /// @dev Owner-only. Calling early reverts. The old root is included in the event for auditability; verifiers reading `currentRoot` switch to the new root immediately, so coordinate the off-chain tree publication with activation.
    /// @return Nothing; emits `RootUpdated` with old and new roots.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `NoPendingRoot` (nothing proposed — checked via `rootActivationTime == 0`), `TimelockNotReady` (delay not yet elapsed), `EnforcedPause`.
    /// Maps to: TS SDK organization.ts acceptRoot; event RootUpdated
    /// @dev Side effects: sets `currentRoot`, clears the pending proposal and activation time, emits `RootUpdated`. Security: owner-only + timelock.
    function acceptRoot() external onlyOwner whenNotPaused {
        if (rootActivationTime == 0) revert NoPendingRoot();
        if (block.timestamp < rootActivationTime) revert TimelockNotReady();
        bytes32 old = currentRoot;
        currentRoot = pendingRoot;
        pendingRoot = bytes32(0);
        rootActivationTime = 0;
        emit RootUpdated(organizationId, old, currentRoot);
    }

    /// @notice Cancels a pending credential-root proposal, so the current root stays in force.
    /// @dev Owner-only, and deliberately NOT pause-guarded: cancellation is a defensive action that must work during an incident.
    /// @return Nothing; emits `RootUpdateCancelled` with the cancelled root.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner) or `NoPendingRoot` (nothing proposed). Never reverts for pause.
    /// Maps to: TS SDK organization.ts cancelRoot; event RootUpdateCancelled
    /// @dev Side effects: clears `pendingRoot` and `rootActivationTime`, emits `RootUpdateCancelled`. Security: owner-only; no pause guard by design.
    function cancelRoot() external onlyOwner {
        if (rootActivationTime == 0) revert NoPendingRoot();
        bytes32 cancelled = pendingRoot;
        pendingRoot = bytes32(0);
        rootActivationTime = 0;
        emit RootUpdateCancelled(organizationId, cancelled);
    }

    /// @notice Proposes a new revoked-credential root, effective only after the 2-day timelock and `acceptRevokedRoot`.
    /// @dev Owner-only. Same timelock rationale as the active root: a compromised owner cannot instantly un-revoke credentials or mass-revoke them. Unlike `proposeRoot`, a zero root IS rejected here — the revoked tree must always have a real root.
    /// @param newRoot Non-zero Merkle root of the revoked-credential tree.
    /// @return Nothing; emits `RevokedRootProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `RevokedRootCannotBeZero` (zero root), `PendingRootActive` (a proposal is already pending), `EnforcedPause`.
    /// Maps to: TS SDK organization.ts proposeRevokedRoot; event RevokedRootProposed
    /// @dev Side effects: sets `pendingRevokedRoot` and `revokedRootActivationTime`, emits `RevokedRootProposed`. Security: owner-only + 2-day timelock.
    function proposeRevokedRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
        if (newRoot == bytes32(0)) revert RevokedRootCannotBeZero();
        if (pendingRevokedRoot != bytes32(0) || revokedRootActivationTime != 0) revert PendingRootActive();
        pendingRevokedRoot = newRoot;
        revokedRootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit RevokedRootProposed(organizationId, newRoot, revokedRootActivationTime);
    }

    /// @notice Activates the pending revoked root after the 2-day timelock.
    /// @dev Owner-only. Calling early reverts. The old revoked root is included in the event for auditability.
    /// @return Nothing; emits `RevokedRootUpdated` with old and new roots.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `NoPendingRoot` (nothing proposed), `TimelockNotReady` (delay not yet elapsed), `EnforcedPause`.
    /// Maps to: TS SDK organization.ts acceptRevokedRoot; event RevokedRootUpdated
    /// @dev Side effects: sets `revokedRoot`, clears the pending proposal and activation time, emits `RevokedRootUpdated`. Security: owner-only + timelock.
    function acceptRevokedRoot() external onlyOwner whenNotPaused {
        if (revokedRootActivationTime == 0) revert NoPendingRoot();
        if (block.timestamp < revokedRootActivationTime) revert TimelockNotReady();
        bytes32 old = revokedRoot;
        revokedRoot = pendingRevokedRoot;
        pendingRevokedRoot = bytes32(0);
        revokedRootActivationTime = 0;
        emit RevokedRootUpdated(organizationId, old, revokedRoot);
    }

    /// @notice Cancels a pending revoked-root proposal, so the current revoked root stays in force.
    /// @dev Owner-only, and deliberately NOT pause-guarded (defensive action, must work during an incident).
    /// @return Nothing; emits `RevokedRootUpdateCancelled` with the cancelled root.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner) or `NoPendingRoot` (nothing proposed). Never reverts for pause.
    /// Maps to: TS SDK organization.ts cancelRevokedRoot; event RevokedRootUpdateCancelled
    /// @dev Side effects: clears `pendingRevokedRoot` and `revokedRootActivationTime`, emits `RevokedRootUpdateCancelled`. Security: owner-only; no pause guard by design.
    function cancelRevokedRoot() external onlyOwner {
        if (revokedRootActivationTime == 0) revert NoPendingRoot();
        bytes32 cancelled = pendingRevokedRoot;
        pendingRevokedRoot = bytes32(0);
        revokedRootActivationTime = 0;
        emit RevokedRootUpdateCancelled(organizationId, cancelled);
    }

    /// @notice Bumps the organization's epoch by one, invalidating anything bound to the old epoch.
    /// @dev Owner-only. Epochs are a coarse invalidation signal (e.g. a key rotation or trust-domain reset): consumers that pin an epoch must re-sync after a bump. Monotonic — there is no decrement or reset, and the epoch is never checked by this contract itself.
    /// @return Nothing; emits `EpochIncremented` with the new epoch.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner) or `EnforcedPause` (paused). Never overflows in practice (uint64).
    /// Maps to: TS SDK organization.ts incrementEpoch; event EpochIncremented
    /// @dev Side effects: increments `currentEpoch`, emits `EpochIncremented`. Security: owner-only.
    function incrementEpoch() external onlyOwner whenNotPaused {
        currentEpoch++;
        emit EpochIncremented(organizationId, currentEpoch);
    }

    /// @notice Sets whether this organization's credentials are publicly visible or private.
    /// @dev Owner-only, and deliberately NOT pause-guarded (visibility is a metadata setting, not a root change). The contract does not enforce visibility — it is a signal for off-chain indexers/UIs; do not treat PRIVATE as access control on-chain.
    /// @param visibility_ `PRIVATE` (0) or `PUBLIC` (1).
    /// @return Nothing; emits `VisibilityChanged` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Setting the current value again succeeds and re-emits.
    /// Maps to: TS SDK organization.ts setVisibility; event VisibilityChanged
    /// @dev Side effects: sets `visibility`, emits `VisibilityChanged`. Security: owner-only; advisory only, not enforced.
    function setVisibility(Visibility visibility_) external onlyOwner {
        visibility = visibility_;
        emit VisibilityChanged(organizationId, visibility_);
    }

    /// @notice Points the anchor at a new off-chain metadata hash (organization profile, policies, or documents).
    /// @dev Owner-only, and deliberately NOT pause-guarded. The hash is opaque — this contract never reads the metadata, so callers must pin/verify it off-chain. Zero is allowed (clears the pointer).
    /// @param metadataHash_ New metadata hash, or bytes32(0) to clear it.
    /// @return Nothing; emits `MetadataHashUpdated` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Setting the current value again succeeds and re-emits.
    /// Maps to: TS SDK organization.ts setMetadataHash; event MetadataHashUpdated
    /// @dev Side effects: sets `metadataHash`, emits `MetadataHashUpdated`. Security: owner-only.
    function setMetadataHash(bytes32 metadataHash_) external onlyOwner {
        metadataHash = metadataHash_;
        emit MetadataHashUpdated(organizationId, metadataHash_);
    }

    /// @notice Returns both credential roots for this organization in one call.
    /// @dev Read-only. Prefer this over two separate reads when a verifier needs the pair atomically.
    /// @return First value: `currentRoot`; second value: `revokedRoot` (either may be bytes32(0) when unset).
    /// Maps to: TS SDK organization.ts getRoots
    function getRoots() external view returns (bytes32, bytes32) {
        return (currentRoot, revokedRoot);
    }

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade of this anchor.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrading changes how the organization's roots are managed — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[46] private __gap;
}
