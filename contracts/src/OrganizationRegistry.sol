// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./OrganizationCredentialAnchor.sol";

error OrganizationAlreadyExists();
error OrganizationNotFound();
error OrganizationInactive();
error InvalidOwnerAddress();
error InvalidName();
error ZeroAddressNotAllowed();
error InvalidAnchor();
error OrganizationAlreadyInactive();
error OrganizationAlreadyActive();
error AnchorTimelockNotReady();
error AnchorTimelockActive();

/// @title OrganizationRegistry
/// @notice Source of truth for organizations onboarded to AgentIX. Creates and tracks
///         OrganizationCredentialAnchor clones via EIP1167.
/// @dev UUPS upgradeable. One contract manages all organizations.
contract OrganizationRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {
    using Clones for address;

    struct Organization {
        bytes32 organizationId;
        string name;
        address owner;
        address credentialAnchor;
        bool active;
        uint64 createdAt;
    }

    event OrganizationRegistered(bytes32 indexed organizationId, string name, address indexed owner, address credentialAnchor);
    event OrganizationDeactivated(bytes32 indexed organizationId);
    event OrganizationReactivated(bytes32 indexed organizationId);
    event CredentialAnchorUpdated(bytes32 indexed organizationId, address oldAnchor, address newAnchor);
    event CredentialAnchorProposed(bytes32 indexed organizationId, address previousAnchor, address newAnchor, uint256 activationTime);

    mapping(bytes32 => Organization) private _organizations;
    mapping(address => bytes32[]) private _ownerOrganizations;

    address public anchorImplementation;

    uint256 public constant TIMELOCK_DELAY = 24 hours;

    mapping(bytes32 => address) public pendingAnchor;
    mapping(bytes32 => uint256) public anchorActivationTime;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address anchorImplementation_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        if (anchorImplementation_ == address(0)) revert ZeroAddressNotAllowed();
        anchorImplementation = anchorImplementation_;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function registerOrganization(bytes32 organizationId, string calldata name, address owner_) external onlyOwner whenNotPaused {
        if (_organizations[organizationId].createdAt != 0) revert OrganizationAlreadyExists();
        if (owner_ == address(0)) revert InvalidOwnerAddress();
        if (bytes(name).length == 0) revert InvalidName();

        // Deploy EIP1167 clone
        address anchor = anchorImplementation.cloneDeterministic(keccak256(abi.encode(organizationId)));
        OrganizationCredentialAnchor(anchor).initialize(organizationId, owner_);

        _organizations[organizationId] = Organization({
            organizationId: organizationId,
            name: name,
            owner: owner_,
            credentialAnchor: anchor,
            active: true,
            createdAt: uint64(block.timestamp)
        });
        _ownerOrganizations[owner_].push(organizationId);

        emit OrganizationRegistered(organizationId, name, owner_, anchor);
    }

    function deactivateOrganization(bytes32 organizationId) external onlyOwner {
        Organization storage org = _getOrg(organizationId);
        if (!org.active) revert OrganizationAlreadyInactive();
        org.active = false;
        emit OrganizationDeactivated(organizationId);
    }

    function reactivateOrganization(bytes32 organizationId) external onlyOwner {
        Organization storage org = _getOrg(organizationId);
        if (org.active) revert OrganizationAlreadyActive();
        org.active = true;
        emit OrganizationReactivated(organizationId);
    }

    function proposeCredentialAnchor(bytes32 organizationId, address newAnchor) external onlyOwner {
        if (newAnchor == address(0)) revert ZeroAddressNotAllowed();
        if (newAnchor.code.length == 0) revert InvalidAnchor();
        _getOrg(organizationId);
        if (pendingAnchor[organizationId] != address(0)) revert AnchorTimelockActive();
        pendingAnchor[organizationId] = newAnchor;
        anchorActivationTime[organizationId] = block.timestamp + TIMELOCK_DELAY;
        emit CredentialAnchorProposed(organizationId, _organizations[organizationId].credentialAnchor, newAnchor, anchorActivationTime[organizationId]);
    }

    function acceptCredentialAnchor(bytes32 organizationId) external onlyOwner {
        if (pendingAnchor[organizationId] == address(0)) revert InvalidAnchor();
        if (block.timestamp < anchorActivationTime[organizationId]) revert AnchorTimelockNotReady();
        Organization storage org = _getOrg(organizationId);
        address old = org.credentialAnchor;
        org.credentialAnchor = pendingAnchor[organizationId];
        pendingAnchor[organizationId] = address(0);
        anchorActivationTime[organizationId] = 0;
        emit CredentialAnchorUpdated(organizationId, old, org.credentialAnchor);
    }

    function getOrganization(bytes32 organizationId) external view returns (Organization memory) {
        return _getOrg(organizationId);
    }

    function organizationExists(bytes32 organizationId) external view returns (bool) {
        return _organizations[organizationId].createdAt != 0;
    }

    function isActive(bytes32 organizationId) external view returns (bool) {
        return _organizations[organizationId].active;
    }

    function getCredentialAnchor(bytes32 organizationId) external view returns (address) {
        return _organizations[organizationId].credentialAnchor;
    }

    function getOwnerOrganizations(address owner_) external view returns (bytes32[] memory) {
        return _ownerOrganizations[owner_];
    }

    function _getOrg(bytes32 organizationId) internal view returns (Organization storage org) {
        org = _organizations[organizationId];
        if (org.createdAt == 0) revert OrganizationNotFound();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
