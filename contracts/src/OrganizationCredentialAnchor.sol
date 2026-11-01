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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(bytes32 organizationId_, address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        if (organizationId_ == bytes32(0)) revert InvalidOrganizationId();
        organizationId = organizationId_;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function proposeRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
        if (newRoot == currentRoot) revert RootAlreadyCurrent();
        if (pendingRoot != bytes32(0) || rootActivationTime != 0) revert PendingRootActive();
        pendingRoot = newRoot;
        rootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit RootProposed(organizationId, newRoot, rootActivationTime);
    }

    /// @notice Activates the pending root after the 2-day timelock.
    function acceptRoot() external onlyOwner whenNotPaused {
        if (rootActivationTime == 0) revert NoPendingRoot();
        if (block.timestamp < rootActivationTime) revert TimelockNotReady();
        bytes32 old = currentRoot;
        currentRoot = pendingRoot;
        pendingRoot = bytes32(0);
        rootActivationTime = 0;
        emit RootUpdated(organizationId, old, currentRoot);
    }

    /// @notice Cancels a pending root proposal. No pause guard (defensive action).
    function cancelRoot() external onlyOwner {
        if (rootActivationTime == 0) revert NoPendingRoot();
        bytes32 cancelled = pendingRoot;
        pendingRoot = bytes32(0);
        rootActivationTime = 0;
        emit RootUpdateCancelled(organizationId, cancelled);
    }

    function proposeRevokedRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
        if (newRoot == bytes32(0)) revert RevokedRootCannotBeZero();
        if (pendingRevokedRoot != bytes32(0) || revokedRootActivationTime != 0) revert PendingRootActive();
        pendingRevokedRoot = newRoot;
        revokedRootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit RevokedRootProposed(organizationId, newRoot, revokedRootActivationTime);
    }

    /// @notice Activates the pending revoked root after the 2-day timelock.
    function acceptRevokedRoot() external onlyOwner whenNotPaused {
        if (revokedRootActivationTime == 0) revert NoPendingRoot();
        if (block.timestamp < revokedRootActivationTime) revert TimelockNotReady();
        bytes32 old = revokedRoot;
        revokedRoot = pendingRevokedRoot;
        pendingRevokedRoot = bytes32(0);
        revokedRootActivationTime = 0;
        emit RevokedRootUpdated(organizationId, old, revokedRoot);
    }

    /// @notice Cancels a pending revoked-root proposal. No pause guard (defensive action).
    function cancelRevokedRoot() external onlyOwner {
        if (revokedRootActivationTime == 0) revert NoPendingRoot();
        bytes32 cancelled = pendingRevokedRoot;
        pendingRevokedRoot = bytes32(0);
        revokedRootActivationTime = 0;
        emit RevokedRootUpdateCancelled(organizationId, cancelled);
    }

    function incrementEpoch() external onlyOwner whenNotPaused {
        currentEpoch++;
        emit EpochIncremented(organizationId, currentEpoch);
    }

    function setVisibility(Visibility visibility_) external onlyOwner {
        visibility = visibility_;
        emit VisibilityChanged(organizationId, visibility_);
    }

    function setMetadataHash(bytes32 metadataHash_) external onlyOwner {
        metadataHash = metadataHash_;
        emit MetadataHashUpdated(organizationId, metadataHash_);
    }

    function getRoots() external view returns (bytes32, bytes32) {
        return (currentRoot, revokedRoot);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[46] private __gap;
}
