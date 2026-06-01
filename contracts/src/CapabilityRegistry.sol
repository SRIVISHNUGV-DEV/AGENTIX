// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract CapabilityRegistry is ReentrancyGuard, Pausable {

    event CapabilityRegistered(
        bytes32 indexed capabilityId,
        string action,
        address indexed registrar
    );
    event CapabilityRevoked(bytes32 indexed capabilityId);
    event GrantRootUpdated(address indexed agent, bytes32 newRoot);
    event GrantRevoked(bytes32 indexed grantLeafHash);

    address public owner;

    struct CapabilityDef {
        string action;
        address registrar;
        uint64 createdAt;
        uint64 expiresAt;
        bool revoked;
    }

    mapping(bytes32 => CapabilityDef) public capabilities;
    bytes32[] public capabilityList;

    mapping(address => bytes32) public grantRoots;
    mapping(bytes32 => bool) public revokedGrants;
    mapping(address => bool) public rootUpdaters;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyRootUpdater() {
        require(rootUpdaters[msg.sender], "Not a root updater");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function registerCapability(
        bytes32 capabilityId,
        string calldata action,
        uint64 expiresAt
    ) external whenNotPaused {
        require(capabilities[capabilityId].createdAt == 0, "Capability exists");
        require(bytes(action).length > 0, "Action required");

        capabilities[capabilityId] = CapabilityDef({
            action: action,
            registrar: msg.sender,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false
        });
        capabilityList.push(capabilityId);

        emit CapabilityRegistered(capabilityId, action, msg.sender);
    }

    function revokeCapability(bytes32 capabilityId) external {
        CapabilityDef storage cap = capabilities[capabilityId];
        require(cap.createdAt != 0, "Capability not found");
        require(
            cap.registrar == msg.sender || msg.sender == owner,
            "Not authorized"
        );
        require(!cap.revoked, "Already revoked");
        cap.revoked = true;
        emit CapabilityRevoked(capabilityId);
    }

    function setRootUpdater(address updater, bool allowed) external onlyOwner {
        rootUpdaters[updater] = allowed;
    }

    function updateGrantRoot(address agent, bytes32 newRoot) external {
        require(
            msg.sender == agent || rootUpdaters[msg.sender],
            "Not authorized"
        );
        grantRoots[agent] = newRoot;
        emit GrantRootUpdated(agent, newRoot);
    }

    function revokeGrant(bytes32 grantLeafHash, bytes32 capabilityId) external {
        require(
            capabilities[capabilityId].registrar == msg.sender ||
                msg.sender == owner,
            "Not authorized"
        );
        require(!revokedGrants[grantLeafHash], "Already revoked");
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

        bytes32 expectedLeaf = keccak256(
            abi.encode(capabilityId, grantor, agent, constraintsHash, expiresAt)
        );
        if (expectedLeaf != grantLeaf) return false;

        bytes32 root = grantRoots[agent];
        if (root == bytes32(0)) return false;
        if (revokedGrants[grantLeaf]) return false;
        if (expiresAt != 0 && expiresAt < block.timestamp) return false;

        return _verifyProof(merkleProof, root, grantLeaf);
    }

    function getCapability(
        bytes32 capabilityId
    ) external view returns (CapabilityDef memory) {
        return capabilities[capabilityId];
    }

    function getCapabilityCount() external view returns (uint256) {
        return capabilityList.length;
    }

    function _verifyProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
        return computedHash == root;
    }

    function _hashPair(
        bytes32 a,
        bytes32 b
    ) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }
}
