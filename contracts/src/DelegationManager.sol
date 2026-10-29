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
///      ROOT CHANGES ARE TIMELOCKED (2 days): a delegator (or root updater) proposes, may
///      cancel while pending, and only after the delay may accept. There is NO instant root
///      update anymore — updateDelegationRoot was replaced by propose/accept/cancel
///      (breaking change). Revocation stays instant (kill-switch, never timelocked).
contract DelegationManager is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    error NoPendingRoot();
    error PendingRootActive();
    error TimelockNotReady();
    bytes32 public constant ROOT_UPDATER_ROLE = keccak256("ROOT_UPDATER");
    uint8 public constant MAX_DELEGATION_DEPTH = 10; // Protocol limit — do not increase without migration
    uint256 public constant TIMELOCK_DELAY = 2 days;

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct DelegationRoot {
        bytes32 root;
        uint64 expiresAt;
        uint64 createdAt;
    }

    struct PendingDelegationRoot {
        bytes32 root;
        uint64 expiresAt;
        uint256 activationTime;
        bool exists;
    }

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DelegationRootUpdated(address indexed delegator, bytes32 indexed scopeHash, bytes32 newRoot, uint64 expiresAt);
    event DelegationRootProposed(address indexed delegator, bytes32 indexed scopeHash, bytes32 newRoot, uint64 expiresAt, uint256 activationTime);
    event DelegationRootUpdateCancelled(address indexed delegator, bytes32 indexed scopeHash);
    event DelegationRevoked(bytes32 indexed delegationLeafHash, address indexed delegator);
    event DelegatorRevoked(address indexed delegator);
    event DelegatorReAuthorized(address indexed delegator);
    event ScopeRegistered(string action, bytes32 indexed scopeHash);

    // ──────────────────────────────────────────────
    //  Storage
    // ──────────────────────────────────────────────

    mapping(address => mapping(bytes32 => DelegationRoot)) public delegationRoots;
    /// @notice Pending root proposals awaiting the timelock, per delegator and scope.
    mapping(address => mapping(bytes32 => PendingDelegationRoot)) public pendingDelegationRoots;
    /// @notice Revoked leaves, namespaced per delegator. A revocation recorded under
    ///         attacker A's namespace never affects delegator B's verification.
    mapping(address => mapping(bytes32 => bool)) public revokedDelegations;
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
    /// @dev No pause guard: revocation is a kill-switch and must work while paused.
    function emergencyRevokeAll(address delegator) external onlyRole(DEFAULT_ADMIN_ROLE) {
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

    /// @notice Proposes a new Merkle root for a delegator under a specific scope.
    ///         The proposal activates only after the 2-day timelock (see acceptDelegationRoot).
    ///         A pending proposal must be accepted or cancelled before a new one is proposed.
    function proposeDelegationRoot(
        address delegator,
        bytes32 scopeHash,
        bytes32 newRoot,
        uint64 expiresAt
    ) external whenNotPaused {
        if (revokedDelegators[delegator]) revert DelegatorHasBeenRevoked();
        if (msg.sender != delegator && !hasRole(ROOT_UPDATER_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ROOT_UPDATER_ROLE);
        }
        if (pendingDelegationRoots[delegator][scopeHash].exists) revert PendingRootActive();

        // Scope-limit check at propose time (rechecked at accept: two pending new scopes
        // proposed while under the limit could jointly exceed it by accept time).
        bool isNewScope = delegationRoots[delegator][scopeHash].root == bytes32(0) && newRoot != bytes32(0);
        if (isNewScope) {
            if (EnumerableSet.length(_delegatorScopes[delegator]) >= 32) revert ScopeLimitExceeded();
        }

        pendingDelegationRoots[delegator][scopeHash] = PendingDelegationRoot({
            root: newRoot,
            expiresAt: expiresAt,
            activationTime: block.timestamp + TIMELOCK_DELAY,
            exists: true
        });

        emit DelegationRootProposed(delegator, scopeHash, newRoot, expiresAt, block.timestamp + TIMELOCK_DELAY);
    }

    /// @notice Activates a pending delegation root after the 2-day timelock.
    function acceptDelegationRoot(address delegator, bytes32 scopeHash) external whenNotPaused {
        if (msg.sender != delegator && !hasRole(ROOT_UPDATER_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ROOT_UPDATER_ROLE);
        }
        PendingDelegationRoot memory p = pendingDelegationRoots[delegator][scopeHash];
        if (!p.exists) revert NoPendingRoot();
        if (block.timestamp < p.activationTime) revert TimelockNotReady();
        if (revokedDelegators[delegator]) revert DelegatorHasBeenRevoked();

        bool isNewScope = delegationRoots[delegator][scopeHash].root == bytes32(0) && p.root != bytes32(0);
        if (isNewScope) {
            if (EnumerableSet.length(_delegatorScopes[delegator]) >= 32) revert ScopeLimitExceeded();
            EnumerableSet.add(_delegatorScopes[delegator], scopeHash);
        }

        delegationRoots[delegator][scopeHash] = DelegationRoot({
            root: p.root,
            expiresAt: p.expiresAt,
            createdAt: uint64(block.timestamp)
        });
        delete pendingDelegationRoots[delegator][scopeHash];

        emit DelegationRootUpdated(delegator, scopeHash, p.root, p.expiresAt);
    }

    /// @notice Cancels a pending delegation root proposal. Delegator, root updater, or
    ///         admin; no pause guard (cancellation is a defensive action).
    function cancelDelegationRoot(address delegator, bytes32 scopeHash) external {
        if (msg.sender != delegator &&
            !hasRole(ROOT_UPDATER_ROLE, msg.sender) &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, DEFAULT_ADMIN_ROLE);
        }
        if (!pendingDelegationRoots[delegator][scopeHash].exists) revert NoPendingRoot();
        delete pendingDelegationRoots[delegator][scopeHash];
        emit DelegationRootUpdateCancelled(delegator, scopeHash);
    }

    /// @notice Revokes a single delegation leaf within the delegator's own namespace.
    /// @dev Revocations are keyed PER DELEGATOR (revokedDelegations[delegator][leaf]) and
    ///      only the delegator, a ROOT_UPDATER_ROLE holder (who manages that delegator's
    ///      tree), or the admin may write to that delegator's namespace. A self-registered
    ///      attacker can therefore only poison their OWN namespace — cross-delegator
    ///      griefing is impossible by construction, without requiring the caller to present
    ///      the leaf preimage or a Merkle proof (which would break emergency revocation).
    ///      No pause guard: revocation is a kill-switch and must work while paused.
    ///      There is deliberately no un-revoke path: a revoked leaf stays revoked; the
    ///      delegator publishes fresh roots instead.
    function revokeDelegation(bytes32 delegationLeafHash, address delegator) external {
        if (msg.sender != delegator &&
            !hasRole(ROOT_UPDATER_ROLE, msg.sender) &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, DEFAULT_ADMIN_ROLE);
        }
        if (revokedDelegations[delegator][delegationLeafHash]) revert AlreadyRevokedDelegation();
        revokedDelegations[delegator][delegationLeafHash] = true;
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

    /// @notice Verifies a multi-hop delegation chain.
    /// @dev Scope rule (fail closed): ALL hops must carry the SAME scopeHash. Scopes are
    ///      opaque hashes, so "subset" is not computable on-chain — equality is the only
    ///      enforceable non-widening rule. A chain like A→B for `read`, B→C for
    ///      `transfer_assets` is NOT a valid chain: no consumer may read the last hop's
    ///      scope as inherited root authority. Depth rule: each hop's currentDepth (its
    ///      1-based position) must be ≤ that hop's caller-supplied maxDepth, and the chain
    ///      length is capped at MAX_DELEGATION_DEPTH (10). maxDepth is NOT bound in any
    ///      leaf or root — a caller-supplied maxDepth larger than the chain is merely
    ///      permissive, never widening, because hop continuity + per-hop proofs still hold.
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
            // Scope transitivity: every hop must carry the root hop's scope. A chain
            // that widens scope mid-chain proves nothing about root authority.
            if (i > 0 && scopeHashes[i] != scopeHashes[0]) return false;
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

    function isRevoked(address delegator, bytes32 leafHash) external view returns (bool) {
        return revokedDelegations[delegator][leafHash];
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
        if (revokedDelegations[delegator][delegationLeaf]) return false;
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

    uint256[49] private __gap;
}
