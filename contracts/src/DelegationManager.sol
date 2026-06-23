// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

error EmptyChain();
error ChainTooLong();
error ArrayLengthMismatch();
error DelegatorHasBeenRevoked();
error AlreadyRevokedDelegation();
error ScopeAlreadyRegistered();
error ScopeLimitExceeded();

/// @title DelegationManager
/// @notice Manages hierarchical delegation via Merkle trees. Delegators publish roots; delegates
///         prove inclusion on-chain. Supports single-hop, multi-hop chains, scope-restricted
///         delegations, and time-bounded roots.
/// @dev Upgradeable (UUPS). Uses OZ MerkleProof, AccessControl, and EnumerableSet.
contract DelegationManager is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    bytes32 public constant ROOT_UPDATER_ROLE = keccak256("ROOT_UPDATER");
    uint8 public constant MAX_DELEGATION_DEPTH = 10; // Protocol limit — do not increase without migration

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct DelegationRoot {
        bytes32 root;
        uint64 expiresAt;
        uint64 createdAt;
    }

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DelegationRootUpdated(address indexed delegator, bytes32 indexed scopeHash, bytes32 newRoot, uint64 expiresAt);
    event DelegationRevoked(bytes32 indexed delegationLeafHash, address indexed delegator);
    event DelegatorRevoked(address indexed delegator);
    event DelegatorReAuthorized(address indexed delegator);
    event ScopeRegistered(string action, bytes32 indexed scopeHash);

    // ──────────────────────────────────────────────
    //  Storage
    // ──────────────────────────────────────────────

    mapping(address => mapping(bytes32 => DelegationRoot)) public delegationRoots;
    mapping(bytes32 => bool) public revokedDelegations;
    mapping(address => bool) public revokedDelegators;
    mapping(bytes32 => string) public scopeActions;

    /// @notice Tracks active scopes per delegator for MAX_SCOPES_PER_DELEGATOR enforcement.
    mapping(address => EnumerableSet.Bytes32Set) private _delegatorScopes;

    // ──────────────────────────────────────────────
    //  Constructor / Initializer
    // ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) public initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(ROOT_UPDATER_ROLE, owner_);
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Grants or revokes the ROOT_UPDATER role for an address.
    function setRootUpdater(address updater, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed) {
            _grantRole(ROOT_UPDATER_ROLE, updater);
        } else {
            _revokeRole(ROOT_UPDATER_ROLE, updater);
        }
    }

    /// @notice Registers a human-readable action string to its scope hash.
    function registerScope(string calldata action) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 scopeHash = keccak256(abi.encodePacked(action));
        if (bytes(scopeActions[scopeHash]).length > 0) revert ScopeAlreadyRegistered();
        scopeActions[scopeHash] = action;
        emit ScopeRegistered(action, scopeHash);
    }

    /// @notice Emergency: revokes ALL delegation leaves for a delegator.
    function emergencyRevokeAll(address delegator) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        revokedDelegators[delegator] = true;
        emit DelegatorRevoked(delegator);
    }

    /// @notice Re-authorizes a previously revoked delegator. Clears all delegation roots
    ///         to prevent stale roots from becoming active again. The delegator must publish
    ///         fresh roots after re-authorization.
    function reAuthorizeDelegator(address delegator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokedDelegators[delegator] = false;
        uint256 len = EnumerableSet.length(_delegatorScopes[delegator]);
        bytes32[] memory scopes = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            scopes[i] = EnumerableSet.at(_delegatorScopes[delegator], i);
        }
        for (uint256 i = 0; i < len; i++) {
            delete delegationRoots[delegator][scopes[i]];
            EnumerableSet.remove(_delegatorScopes[delegator], scopes[i]);
        }
        emit DelegatorReAuthorized(delegator);
    }

    // ──────────────────────────────────────────────
    //  Delegation Root Management
    // ──────────────────────────────────────────────

    /// @notice Updates the Merkle root for a delegator under a specific scope.
    function updateDelegationRoot(
        address delegator,
        bytes32 scopeHash,
        bytes32 newRoot,
        uint64 expiresAt
    ) external whenNotPaused {
        if (revokedDelegators[delegator]) revert DelegatorHasBeenRevoked();
        if (msg.sender != delegator && !hasRole(ROOT_UPDATER_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ROOT_UPDATER_ROLE);
        }

        bool isNewScope = delegationRoots[delegator][scopeHash].root == bytes32(0) && newRoot != bytes32(0);
        if (isNewScope) {
            if (EnumerableSet.length(_delegatorScopes[delegator]) >= 32) revert ScopeLimitExceeded();
            EnumerableSet.add(_delegatorScopes[delegator], scopeHash);
        }

        delegationRoots[delegator][scopeHash] = DelegationRoot({
            root: newRoot,
            expiresAt: expiresAt,
            createdAt: uint64(block.timestamp)
        });

        emit DelegationRootUpdated(delegator, scopeHash, newRoot, expiresAt);
    }

    /// @notice Revokes a single delegation leaf.
    function revokeDelegation(bytes32 delegationLeafHash, address delegator) external whenNotPaused {
        if (msg.sender != delegator && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, DEFAULT_ADMIN_ROLE);
        }
        if (revokedDelegations[delegationLeafHash]) revert AlreadyRevokedDelegation();
        revokedDelegations[delegationLeafHash] = true;
        emit DelegationRevoked(delegationLeafHash, delegator);
    }

    // ──────────────────────────────────────────────
    //  Single-Hop Verification
    // ──────────────────────────────────────────────

    function verifyDelegation(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        bytes32 scopeHash,
        uint64 expiresAt,
        uint8 maxDepth
    ) external view returns (bool) {
        return _verifySingleHop(delegationLeaf, merkleProof, delegator, msg.sender, scopeHash, expiresAt, maxDepth, 1);
    }

    function verifyDelegationForAction(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        string calldata action,
        uint64 expiresAt,
        uint8 maxDepth
    ) external view returns (bool) {
        return _verifySingleHop(delegationLeaf, merkleProof, delegator, msg.sender, keccak256(abi.encodePacked(action)), expiresAt, maxDepth, 1);
    }

    // ──────────────────────────────────────────────
    //  Multi-Hop Chain Verification
    // ──────────────────────────────────────────────

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
        if (len > MAX_DELEGATION_DEPTH) revert ChainTooLong();
        if (len != merkleProofs.length || len != delegators.length || len != delegates.length ||
            len != scopeHashes.length || len != expiries.length || len != maxDepths.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < len; i++) {
            if (!_verifySingleHop(
                delegationLeaves[i], merkleProofs[i], delegators[i],
                i == len - 1 ? msg.sender : delegates[i],
                scopeHashes[i], expiries[i], maxDepths[i], uint8(i + 1)
            )) {
                return false;
            }
            if (i > 0 && delegators[i] != delegates[i - 1]) return false;
        }
        return true;
    }

    // ──────────────────────────────────────────────
    //  View Helpers
    // ──────────────────────────────────────────────

    function getDelegationRoot(address delegator, bytes32 scopeHash) external view returns (bytes32 root, uint64 expiresAt, uint64 createdAt) {
        DelegationRoot storage r = delegationRoots[delegator][scopeHash];
        return (r.root, r.expiresAt, r.createdAt);
    }

    function isRevoked(bytes32 leafHash) external view returns (bool) {
        return revokedDelegations[leafHash];
    }

    function getScopeAction(bytes32 scopeHash) external view returns (string memory) {
        return scopeActions[scopeHash];
    }

    function getDelegatorScopeCount(address delegator) external view returns (uint256) {
        return EnumerableSet.length(_delegatorScopes[delegator]);
    }

    // ──────────────────────────────────────────────
    //  Internal Verification
    // ──────────────────────────────────────────────

    function _verifySingleHop(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        address delegate,
        bytes32 scopeHash,
        uint64 expiresAt,
        uint8 maxDepth,
        uint8 currentDepth
    ) internal view returns (bool) {
        if (revokedDelegators[delegator]) return false;

        DelegationRoot storage rootInfo = delegationRoots[delegator][scopeHash];
        if (rootInfo.root == bytes32(0)) return false;
        if (rootInfo.expiresAt != 0 && rootInfo.expiresAt < block.timestamp) return false;
        if (revokedDelegations[delegationLeaf]) return false;
        if (expiresAt != 0 && expiresAt < block.timestamp) return false;
        if (currentDepth > maxDepth) return false;

        bytes32 expectedLeaf = keccak256(abi.encode(delegator, delegate, scopeHash, expiresAt));
        if (expectedLeaf != delegationLeaf) return false;

        return MerkleProof.verify(merkleProof, rootInfo.root, delegationLeaf);
    }

    // ──────────────────────────────────────────────
    //  Upgrade Authorization
    // ──────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    uint256[50] private __gap;
}
