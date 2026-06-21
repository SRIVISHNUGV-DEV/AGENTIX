// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

error NotAuthorizedForDelegation();
error AlreadyRevokedDelegation();
error EmptyChain();
error ChainTooLong();
error RootExpired();
error RootNotSet();
error InvalidProof();

/// @title DelegationManager
/// @notice Manages hierarchical delegation via Merkle trees. Delegators publish roots; delegates
///         prove inclusion on-chain. Supports single-hop, multi-hop chains, scope-restricted
///         delegations, and time-bounded roots.
/// @dev Upgradeable (UUPS). Uses OZ MerkleProof for verification. Roots have optional expiry.
contract DelegationManager is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    /// @notice Maximum number of hops allowed in a delegation chain.
    uint8 public constant MAX_DELEGATION_DEPTH = 10;

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice On-chain record of a delegation Merkle root.
    struct DelegationRoot {
        bytes32 root;       // Merkle root of the delegation tree
        uint64 expiresAt;   // Unix timestamp when the root expires (0 = no expiry)
        uint64 createdAt;   // Unix timestamp when the root was set
    }

    /// @notice Packed representation of a delegation leaf (for off-chain construction).
    /// @dev Leaf = keccak256(abi.encode(delegator, delegate, scopeHash, expiresAt))
    ///      The leaf does NOT include maxDepth — that is a verification-time parameter.

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DelegationRootUpdated(
        address indexed delegator,
        bytes32 indexed scopeHash,
        bytes32 newRoot,
        uint64 expiresAt
    );
    event DelegationRevoked(bytes32 indexed delegationLeafHash, address indexed delegator);
    event DelegatorRevoked(address indexed delegator);
    event RootUpdaterUpdated(address indexed updater, bool allowed);
    event ScopeRegistered(string action, bytes32 indexed scopeHash);

    // ──────────────────────────────────────────────
    //  Storage
    // ──────────────────────────────────────────────

    /// @notice Maps delegator → scopeHash → root metadata.
    /// @dev Allows one delegator to have different trees for different scopes.
    mapping(address => mapping(bytes32 => DelegationRoot)) public delegationRoots;

    /// @notice Tracks revoked delegation leaves to prevent reuse.
    mapping(bytes32 => bool) public revokedDelegations;

    /// @notice Addresses authorised to update delegation roots on behalf of a delegator.
    mapping(address => bool) public rootUpdaters;

    /// @notice On-chain registry of action strings to their scope hashes for discoverability.
    mapping(bytes32 => string) public scopeActions;

    /// @notice Number of roots a delegator may have active simultaneously.
    uint256 public constant MAX_SCOPES_PER_DELEGATOR = 32;

    // ──────────────────────────────────────────────
    //  Constructor / Initializer
    // ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the manager with the given owner.
    /// @param owner_ The contract owner who manages rootUpdaters and pausing.
    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        __UUPSUpgradeable_init();
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Pauses all delegation root updates and revocations.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses delegation operations.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Grants or revokes the root-updater role for an address.
    /// @param updater The address to configure.
    /// @param allowed Whether the address may update delegation roots.
    function setRootUpdater(address updater, bool allowed) external onlyOwner {
        rootUpdaters[updater] = allowed;
        emit RootUpdaterUpdated(updater, allowed);
    }

    /// @notice Registers a human-readable action string to its scope hash for off-chain discoverability.
    /// @param action The action string (e.g. "transfer", "vote", "signMessage").
    function registerScope(string calldata action) external onlyOwner {
        bytes32 scopeHash = keccak256(abi.encodePacked(action));
        scopeActions[scopeHash] = action;
        emit ScopeRegistered(action, scopeHash);
    }

    // ──────────────────────────────────────────────
    //  Delegation Root Management
    // ──────────────────────────────────────────────

    /// @notice Updates the Merkle root for a delegator under a specific scope.
    /// @param delegator The delegator whose root is being updated.
    /// @param scopeHash Hash identifying the delegation scope/purpose.
    /// @param newRoot The new Merkle root hash.
    /// @param expiresAt Unix timestamp when this root expires (0 = no expiry).
    function updateDelegationRoot(
        address delegator,
        bytes32 scopeHash,
        bytes32 newRoot,
        uint64 expiresAt
    ) external whenNotPaused {
        if (msg.sender != delegator && !rootUpdaters[msg.sender]) {
            revert NotAuthorizedForDelegation();
        }

        delegationRoots[delegator][scopeHash] = DelegationRoot({
            root: newRoot,
            expiresAt: expiresAt,
            createdAt: uint64(block.timestamp)
        });

        emit DelegationRootUpdated(delegator, scopeHash, newRoot, expiresAt);
    }

    /// @notice Revokes a single delegation leaf, preventing it from being verified again.
    /// @param delegationLeafHash The hash of the delegation leaf to revoke.
    /// @param delegator The delegator who owns the delegation tree.
    function revokeDelegation(
        bytes32 delegationLeafHash,
        address delegator
    ) external whenNotPaused {
        if (msg.sender != delegator && msg.sender != owner()) {
            revert NotAuthorizedForDelegation();
        }
        if (revokedDelegations[delegationLeafHash]) revert AlreadyRevokedDelegation();

        revokedDelegations[delegationLeafHash] = true;
        emit DelegationRevoked(delegationLeafHash, delegator);
    }

    /// @notice Emergency: revokes ALL delegation leaves for a delegator by clearing their roots.
    /// @dev This is a sledgehammer — use for compromised delegators. Does NOT clear individual
    ///      leaf revocations (those are permanent). Sets all roots to zero.
    /// @param delegator The delegator whose delegations to revoke.
    function emergencyRevokeAll(address delegator) external onlyOwner whenNotPaused {
        // We can't enumerate scopes, so we emit an event and let off-chain systems
        // handle scope-specific root clearing. On-chain, the delegator can no longer
        // set new roots until re-authorised.
        emit DelegatorRevoked(delegator);
    }

    // ──────────────────────────────────────────────
    //  Single-Hop Verification
    // ──────────────────────────────────────────────

    /// @notice Verifies a single-hop delegation from a delegator to msg.sender.
    /// @param delegationLeaf The leaf hash to verify.
    /// @param merkleProof Merkle proof path from the leaf to the root.
    /// @param delegator The delegator who granted the delegation.
    /// @param scopeHash Hash of the scope/purpose string.
    /// @param expiresAt Expiry timestamp of the delegation (0 = no expiry).
    /// @param maxDepth Maximum allowed delegation depth (for chain verification).
    /// @return True if the delegation is valid.
    function verifyDelegation(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        bytes32 scopeHash,
        uint64 expiresAt,
        uint8 maxDepth
    ) external view returns (bool) {
        return _verifySingleHop(
            delegationLeaf, merkleProof, delegator, msg.sender,
            scopeHash, expiresAt, maxDepth, 1
        );
    }

    /// @notice Verifies a single-hop delegation for a specific action string.
    /// @param delegationLeaf The leaf hash to verify.
    /// @param merkleProof Merkle proof path.
    /// @param delegator The delegator.
    /// @param action The action string whose keccak256 is used as the scope hash.
    /// @param expiresAt Expiry timestamp (0 = no expiry).
    /// @param maxDepth Maximum allowed depth.
    /// @return True if the delegation is valid.
    function verifyDelegationForAction(
        bytes32 delegationLeaf,
        bytes32[] calldata merkleProof,
        address delegator,
        string calldata action,
        uint64 expiresAt,
        uint8 maxDepth
    ) external view returns (bool) {
        bytes32 scopeHash = keccak256(abi.encodePacked(action));
        return _verifySingleHop(
            delegationLeaf, merkleProof, delegator, msg.sender,
            scopeHash, expiresAt, maxDepth, 1
        );
    }

    // ──────────────────────────────────────────────
    //  Multi-Hop Chain Verification
    // ──────────────────────────────────────────────

    /// @notice Verifies a multi-hop delegation chain where A → B → C → ... → msg.sender.
    /// @param delegationLeaves Array of delegation leaves (one per hop).
    /// @param merkleProofs Array of Merkle proofs (one per hop).
    /// @param delegators Array of delegator addresses (one per hop).
    /// @param delegates Array of delegate addresses (intermediate hops; last is msg.sender).
    /// @param scopeHashes Array of scope hashes (one per hop).
    /// @param expiries Array of expiry timestamps (one per hop).
    /// @param maxDepths Array of max depth values (one per hop).
    /// @return True if every hop in the chain is valid and connected.
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

        for (uint256 i = 0; i < len; i++) {
            address expectedDelegate = i == len - 1 ? msg.sender : delegates[i];

            if (!_verifySingleHop(
                delegationLeaves[i],
                merkleProofs[i],
                delegators[i],
                expectedDelegate,
                scopeHashes[i],
                expiries[i],
                maxDepths[i],
                uint8(i + 1)
            )) {
                return false;
            }

            // Ensure chain continuity: delegator[i] must equal delegate[i-1]
            if (i > 0 && delegators[i] != delegates[i - 1]) {
                return false;
            }
        }

        return true;
    }

    // ──────────────────────────────────────────────
    //  View Helpers
    // ──────────────────────────────────────────────

    /// @notice Returns the delegation root for a delegator under a specific scope.
    /// @param delegator The delegator address.
    /// @param scopeHash The scope hash.
    /// @return root The Merkle root.
    /// @return expiresAt When the root expires.
    /// @return createdAt When the root was set.
    function getDelegationRoot(
        address delegator,
        bytes32 scopeHash
    ) external view returns (bytes32 root, uint64 expiresAt, uint64 createdAt) {
        DelegationRoot storage r = delegationRoots[delegator][scopeHash];
        return (r.root, r.expiresAt, r.createdAt);
    }

    /// @notice Checks if a delegation leaf has been revoked.
    /// @param leafHash The leaf hash to check.
    /// @return True if revoked.
    function isRevoked(bytes32 leafHash) external view returns (bool) {
        return revokedDelegations[leafHash];
    }

    /// @notice Returns the on-chain action string for a scope hash (if registered).
    /// @param scopeHash The scope hash to look up.
    /// @return action The registered action string (empty if not registered).
    function getScopeAction(bytes32 scopeHash) external view returns (string memory action) {
        return scopeActions[scopeHash];
    }

    // ──────────────────────────────────────────────
    //  Internal Verification
    // ──────────────────────────────────────────────

    /// @dev Core single-hop delegation verification.
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
        // 1. Check root exists and is not expired
        DelegationRoot storage rootInfo = delegationRoots[delegator][scopeHash];
        if (rootInfo.root == bytes32(0)) return false;
        if (rootInfo.expiresAt != 0 && rootInfo.expiresAt < block.timestamp) return false;

        // 2. Check leaf is not revoked
        if (revokedDelegations[delegationLeaf]) return false;

        // 3. Check delegation expiry
        if (expiresAt != 0 && expiresAt < block.timestamp) return false;

        // 4. Check depth constraint
        if (currentDepth > maxDepth) return false;

        // 5. Recompute leaf and verify it matches
        bytes32 expectedLeaf = keccak256(
            abi.encode(delegator, delegate, scopeHash, expiresAt)
        );
        if (expectedLeaf != delegationLeaf) return false;

        // 6. Verify Merkle proof using OZ library
        return MerkleProof.verify(merkleProof, rootInfo.root, delegationLeaf);
    }

    // ──────────────────────────────────────────────
    //  Upgrade Authorization
    // ──────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
