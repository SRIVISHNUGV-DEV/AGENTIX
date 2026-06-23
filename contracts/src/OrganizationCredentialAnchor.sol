// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error InvalidOrganizationId();
error RootAlreadyCurrent();
error UnauthorizedUpdate();

/// @title OrganizationCredentialAnchor
/// @notice Lightweight EIP1167 clone per organization. Stores credential roots, epochs,
///         and visibility settings. One anchor = one organization's trust domain.
/// @dev UUPS upgradeable. Cloned by OrganizationRegistry. Never used directly.
contract OrganizationCredentialAnchor is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    enum Visibility { PRIVATE, PUBLIC }

    event RootUpdated(bytes32 indexed organizationId, bytes32 oldRoot, bytes32 newRoot);
    event RevokedRootUpdated(bytes32 indexed organizationId, bytes32 oldRoot, bytes32 newRoot);
    event EpochIncremented(bytes32 indexed organizationId, uint64 newEpoch);
    event VisibilityChanged(bytes32 indexed organizationId, Visibility newVisibility);
    event MetadataHashUpdated(bytes32 indexed organizationId, bytes32 newMetadataHash);

    bytes32 public organizationId;
    bytes32 public currentRoot;
    bytes32 public revokedRoot;
    uint64 public currentEpoch;
    bytes32 public metadataHash;
    Visibility public visibility;

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

    function updateRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
        if (newRoot == currentRoot) revert RootAlreadyCurrent();
        bytes32 old = currentRoot;
        currentRoot = newRoot;
        emit RootUpdated(organizationId, old, newRoot);
    }

    function updateRevokedRoot(bytes32 newRoot) external onlyOwner whenNotPaused {
        bytes32 old = revokedRoot;
        revokedRoot = newRoot;
        emit RevokedRootUpdated(organizationId, old, newRoot);
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

    uint256[50] private __gap;
}
