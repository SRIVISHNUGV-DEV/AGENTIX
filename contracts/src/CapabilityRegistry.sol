// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

error CapabilityExists();
error ActionRequired();
error CapabilityNotFound();
error NotAuthorizedForCapability();
error AlreadyRevokedCapability();
error AlreadyRevokedGrant();
error GrantNotRevocable();
error InvalidRecipient();
error InvalidRoot();

/// @title CapabilityRegistry
/// @notice Registry for agent capabilities (named actions). Grantors delegate specific capabilities
///         to agents via Merkle trees, and agents prove capability possession on-chain.
/// @dev Upgradeable (UUPS). Uses OZ MerkleProof for verification.
contract CapabilityRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    event CapabilityRegistered(bytes32 indexed capabilityId, bytes32 indexed actionHash, address indexed registrar);
    event CapabilityRevoked(bytes32 indexed capabilityId);
    event GrantRootUpdated(address indexed grantor, address indexed grantee, bytes32 indexed capabilityId, bytes32 newRoot);
    event GrantRevoked(bytes32 indexed grantLeafHash);

    struct CapabilityDef {
        bytes32 actionHash;
        address registrar;
        uint64 createdAt;
        uint64 expiresAt;
        bool revoked;
    }

    mapping(bytes32 => CapabilityDef) public capabilities;
    bytes32[] private capabilityList;
    mapping(bytes32 => uint256) private capabilityIndex;
    mapping(address => mapping(address => mapping(bytes32 => bytes32))) public grantRoots;
    mapping(bytes32 => bool) public revokedGrants;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function registerCapability(bytes32 capabilityId, string calldata action, uint64 expiresAt) external whenNotPaused onlyOwner {
        if (capabilities[capabilityId].createdAt != 0) revert CapabilityExists();
        if (bytes(action).length == 0) revert ActionRequired();

        capabilities[capabilityId] = CapabilityDef({
            actionHash: keccak256(abi.encodePacked(action)),
            registrar: msg.sender,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false
        });
        capabilityList.push(capabilityId);
        capabilityIndex[capabilityId] = capabilityList.length - 1;

        emit CapabilityRegistered(capabilityId, keccak256(abi.encodePacked(action)), msg.sender);
    }

    function revokeCapability(bytes32 capabilityId) external {
        CapabilityDef storage cap = capabilities[capabilityId];
        if (cap.createdAt == 0) revert CapabilityNotFound();
        if (cap.registrar != msg.sender && msg.sender != owner()) revert NotAuthorizedForCapability();
        if (cap.revoked) revert AlreadyRevokedCapability();
        cap.revoked = true;

        uint256 index = capabilityIndex[capabilityId];
        bytes32 lastId = capabilityList[capabilityList.length - 1];
        capabilityList[index] = lastId;
        capabilityIndex[lastId] = index;
        capabilityList.pop();
        delete capabilityIndex[capabilityId];

        emit CapabilityRevoked(capabilityId);
    }

    function updateGrantRoot(address grantee, bytes32 capabilityId, bytes32 newRoot) external whenNotPaused {
        if (grantee == address(0)) revert InvalidRecipient();
        CapabilityDef storage cap = capabilities[capabilityId];
        if (cap.createdAt == 0) revert CapabilityNotFound();
        if (cap.registrar != msg.sender && msg.sender != owner()) revert NotAuthorizedForCapability();
        if (newRoot == bytes32(0)) revert InvalidRoot();
        grantRoots[msg.sender][grantee][capabilityId] = newRoot;
        emit GrantRootUpdated(msg.sender, grantee, capabilityId, newRoot);
    }

    function revokeGrant(bytes32 grantLeafHash, bytes32 capabilityId, address grantor, address grantee) external {
        if (capabilities[capabilityId].registrar != msg.sender && msg.sender != owner() && msg.sender != grantor) revert GrantNotRevocable();
        if (grantRoots[grantor][grantee][capabilityId] == bytes32(0)) revert GrantNotRevocable();
        if (revokedGrants[grantLeafHash]) revert AlreadyRevokedGrant();
        revokedGrants[grantLeafHash] = true;
        emit GrantRevoked(grantLeafHash);
    }

    function verifyCapability(
        address agent,
        bytes32 capabilityId,
        bytes32 grantLeaf,
        bytes32[] calldata merkleProof,
        address grantor,
        bytes32 constraintsHash,
        uint64 expiresAt
    ) external view returns (bool) {
        CapabilityDef storage cap = capabilities[capabilityId];
        if (cap.revoked) return false;
        if (cap.expiresAt != 0 && cap.expiresAt < block.timestamp) return false;
        if (cap.registrar != grantor) return false;

        bytes32 expectedLeaf = keccak256(abi.encode(capabilityId, grantor, agent, constraintsHash, expiresAt));
        if (expectedLeaf != grantLeaf) return false;

        bytes32 root = grantRoots[grantor][agent][capabilityId];
        if (root == bytes32(0)) return false;
        if (revokedGrants[grantLeaf]) return false;
        if (expiresAt != 0 && expiresAt < block.timestamp) return false;

        return MerkleProof.verify(merkleProof, root, grantLeaf);
    }

    function getCapability(bytes32 capabilityId) external view returns (CapabilityDef memory) {
        return capabilities[capabilityId];
    }

    function getCapabilityCount() external view returns (uint256) {
        return capabilityList.length;
    }

    function getCapabilityAt(uint256 index) external view returns (bytes32) {
        return capabilityList[index];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
