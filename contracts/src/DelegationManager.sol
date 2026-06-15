// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error OnlyOwnerMsg();
error NotARootUpdater();
error NotAuthorizedForDelegation();
error AlreadyRevokedDelegation();
error EmptyChain();

contract DelegationManager is Initializable, ReentrancyGuardUpgradeable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    event DelegationRootUpdated(address indexed delegator, bytes32 newRoot);
    event DelegationRevoked(bytes32 indexed delegationLeafHash);

    mapping(address => bytes32) public delegationRoots;
    mapping(bytes32 => bool) public revokedDelegations;
    mapping(address => bool) public rootUpdaters;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        if (owner_ != msg.sender) transferOwnership(owner_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setRootUpdater(address updater, bool allowed) external onlyOwner {
        rootUpdaters[updater] = allowed;
    }

    function updateDelegationRoot(
        address delegator,
        bytes32 newRoot
    ) external {
        if (msg.sender != delegator && !rootUpdaters[msg.sender]) revert NotAuthorizedForDelegation();
        delegationRoots[delegator] = newRoot;
        emit DelegationRootUpdated(delegator, newRoot);
    }

    function revokeDelegation(
        bytes32 delegationLeafHash,
        address delegator
    ) external {
        if (msg.sender != delegator && msg.sender != owner()) revert NotAuthorizedForDelegation();
        if (revokedDelegations[delegationLeafHash]) revert AlreadyRevokedDelegation();
        revokedDelegations[delegationLeafHash] = true;
        emit DelegationRevoked(delegationLeafHash);
    }

    function _verifyDelegation(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        address delegate,
        bytes32 scopeHash,
        uint64 expiresAt,
        uint8 maxDepth,
        uint8 currentDepth
    ) internal view returns (bool) {
        bytes32 root = delegationRoots[delegator];
        if (root == bytes32(0)) return false;
        if (revokedDelegations[delegationLeaf]) return false;
        if (expiresAt != 0 && expiresAt < block.timestamp) return false;
        if (currentDepth > maxDepth) return false;

        bytes32 expectedLeaf = keccak256(
            abi.encode(
                delegator,
                delegate,
                scopeHash,
                expiresAt,
                maxDepth
            )
        );
        if (expectedLeaf != delegationLeaf) return false;

        return _verifyProof(merkleProof, root, delegationLeaf);
    }

    function verifyDelegation(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        bytes32 scopeHash,
        uint64 expiresAt,
        uint8 maxDepth
    ) external view returns (bool) {
        return _verifyDelegation(
            delegationLeaf,
            merkleProof,
            delegator,
            msg.sender,
            scopeHash,
            expiresAt,
            maxDepth,
            1
        );
    }

    function verifyDelegationForAction(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        string calldata action,
        uint64 expiresAt,
        uint8 maxDepth
    ) external view returns (bool) {
        bytes32 scopeHash = keccak256(abi.encodePacked(action));
        return _verifyDelegation(
            delegationLeaf,
            merkleProof,
            delegator,
            msg.sender,
            scopeHash,
            expiresAt,
            maxDepth,
            1
        );
    }

    function verifyDelegationChain(
        bytes32[] calldata delegationLeaves,
        bytes32[][] calldata merkleProofs,
        address[] calldata delegators,
        address[] calldata delegates,
        bytes32[] calldata scopeHashes,
        uint64[] calldata expiries,
        uint8[] calldata maxDepths
    ) external view returns (bool) {
        uint256 len = delegationLeaves.length;
        if (len == 0) revert EmptyChain();

        for (uint256 i = 0; i < len; i++) {
            address expectedDelegate = i == len - 1
                ? msg.sender
                : delegates[i];

            if (!_verifyDelegation(
                delegationLeaves[i],
                merkleProofs[i],
                delegators[i],
                expectedDelegate,
                scopeHashes[i],
                expiries[i],
                maxDepths[i],
                uint8(i + 1)
            )) return false;

            if (i > 0 && delegators[i] != delegates[i - 1]) return false;
        }

        return true;
    }

    function getDelegationRoot(address delegator) external view returns (bytes32) {
        return delegationRoots[delegator];
    }

    function _verifyProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
        return computedHash == root;
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
