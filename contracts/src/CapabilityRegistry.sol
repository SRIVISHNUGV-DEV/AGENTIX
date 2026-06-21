// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error OnlyOwnerMsg();
error CapabilityExists();
error ActionRequired();
error CapabilityNotFound();
error NotAuthorizedForCapability();
error AlreadyRevokedCapability();

/// @title CapabilityRegistry
/// @notice Registry for agent capabilities (named actions). Each capability is an on-chain record
///         linking a capability ID to a hashed action string. Grantors delegate specific capabilities
///         to agents via Merkle trees, and agents prove capability possession on-chain.
/// @dev Upgradeable (UUPS). Supports capability registration, revocation, and Merkle-proof-based grant verification.
contract CapabilityRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    event CapabilityRegistered(bytes32 indexed capabilityId, bytes32 indexed actionHash, address indexed registrar);
    event CapabilityRevoked(bytes32 indexed capabilityId);
    event GrantRootUpdated(address indexed grantor, address indexed grantee, bytes32 newRoot);
    event GrantRevoked(bytes32 indexed grantLeafHash);

    /// @notice On-chain definition of a capability.
    struct CapabilityDef {
        bytes32 actionHash;   // keccak256 of the action string
        address registrar;    // address that registered this capability
        uint64 createdAt;     // registration timestamp
        uint64 expiresAt;     // 0 = no expiry
        bool revoked;         // whether the capability has been revoked
    }

    /// @notice Mapping from capability ID to its definition.
    mapping(bytes32 => CapabilityDef) public capabilities;
    /// @notice Ordered list of active capability IDs for enumeration.
    bytes32[] private capabilityList;
    /// @notice Maps capability ID to its index in capabilityList (for O(1) removal).
    mapping(bytes32 => uint256) private capabilityIndex;

    /// @notice Maps grantor → grantee → Merkle root of the grant tree.
    mapping(address => mapping(address => bytes32)) public grantRoots;
    /// @notice Tracks revoked grant leaves to prevent reuse.
    mapping(bytes32 => bool) public revokedGrants;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the registry with the given owner.
    /// @param owner_ The contract owner.
    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        __UUPSUpgradeable_init();
    }

    /// @notice Pauses capability registration.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses capability registration.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Registers a new capability with an associated action string.
    /// @param capabilityId Unique identifier for the capability.
    /// @param action The human-readable action string (hashed on-chain).
    /// @param expiresAt Unix timestamp when the capability expires (0 = no expiry).
    function registerCapability(
        bytes32 capabilityId,
        string calldata action,
        uint64 expiresAt
    ) external whenNotPaused onlyOwner {
        if (capabilities[capabilityId].createdAt != 0) revert CapabilityExists();
        if (bytes(action).length == 0) revert ActionRequired();

        bytes32 actionHash = keccak256(abi.encodePacked(action));

        capabilities[capabilityId] = CapabilityDef({
            actionHash: actionHash,
            registrar: msg.sender,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false
        });
        capabilityList.push(capabilityId);
        capabilityIndex[capabilityId] = capabilityList.length - 1;

        emit CapabilityRegistered(capabilityId, actionHash, msg.sender);
    }

    /// @notice Revokes a capability and removes it from the active list.
    /// @param capabilityId The capability to revoke.
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

    /// @notice Updates the Merkle root of the grant tree from msg.sender to a grantee.
    /// @param grantee The agent receiving capability grants.
    /// @param newRoot The new Merkle root of the grant tree.
    function updateGrantRoot(address grantee, bytes32 newRoot) external {
        grantRoots[msg.sender][grantee] = newRoot;
        emit GrantRootUpdated(msg.sender, grantee, newRoot);
    }

    /// @notice Revokes a specific grant leaf within a capability's grant tree.
    /// @param grantLeafHash The hash of the grant leaf to revoke.
    /// @param capabilityId The capability whose grant is being revoked.
    function revokeGrant(bytes32 grantLeafHash, bytes32 capabilityId) external {
        if (capabilities[capabilityId].registrar != msg.sender && msg.sender != owner()) revert NotAuthorizedForCapability();
        if (revokedGrants[grantLeafHash]) revert AlreadyRevokedCapability();
        revokedGrants[grantLeafHash] = true;
        emit GrantRevoked(grantLeafHash);
    }

    /// @notice Verifies that an agent holds a valid, non-revoked grant for a given capability.
    /// @param agent The agent address to verify.
    /// @param capabilityId The capability being claimed.
    /// @param grantLeaf The grant leaf hash to verify against the Merkle root.
    /// @param merkleProof Merkle proof path from the leaf to the grant root.
    /// @param grantor The address that granted the capability (must be the registrar).
    /// @param constraintsHash Hash of any constraints associated with the grant.
    /// @param expiresAt Expiry timestamp of the grant (0 = no expiry).
    /// @return True if the capability grant is valid and verified.
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

        bytes32 expectedLeaf = keccak256(
            abi.encode(capabilityId, grantor, agent, constraintsHash, expiresAt)
        );
        if (expectedLeaf != grantLeaf) return false;

        bytes32 root = grantRoots[grantor][agent];
        if (root == bytes32(0)) return false;
        if (revokedGrants[grantLeaf]) return false;
        if (expiresAt != 0 && expiresAt < block.timestamp) return false;

        return _verifyProof(merkleProof, root, grantLeaf);
    }

    /// @notice Returns the full capability definition.
    /// @param capabilityId The capability ID to query.
    /// @return The CapabilityDef struct.
    function getCapability(bytes32 capabilityId) external view returns (CapabilityDef memory) {
        return capabilities[capabilityId];
    }

    /// @notice Returns the number of active (non-revoked) capabilities.
    function getCapabilityCount() external view returns (uint256) {
        return capabilityList.length;
    }

    /// @notice Returns the capability ID at a given index in the active list.
    /// @param index The index to query.
    function getCapabilityAt(uint256 index) external view returns (bytes32) {
        return capabilityList[index];
    }

    /// @dev Verifies a Merkle proof by recomputing the root from the leaf.
    function _verifyProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
        return computedHash == root;
    }

    /// @dev Hashes a pair of bytes32 values in canonical (sorted) order for Merkle proof computation.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
