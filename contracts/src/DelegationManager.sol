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

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @return Nothing. Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: wires AccessControl and pause, granting the deployer both admin and root-updater rights.
    /// @dev Runs once (initializer) from the proxy deployment. `owner_` holds `DEFAULT_ADMIN_ROLE` (pause, role admin, emergency revoke) and `ROOT_UPDATER_ROLE` (root proposals on behalf of delegators).
    /// @param owner_ Admin address receiving both roles.
    /// @return Nothing.
    /// @dev Reverts if called twice (`InvalidInitialization`).
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: grants `DEFAULT_ADMIN_ROLE` and `ROOT_UPDATER_ROLE` to `owner_`. Security: deployer-chosen admin.
    function initialize(address owner_) public initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(ROOT_UPDATER_ROLE, owner_);
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Pauses root proposals/acceptance and verification-gated writes (revocation stays available while paused).
    /// @dev Admin-only. `revokeDelegation`, `emergencyRevokeAll`, and cancellations deliberately have no pause guard — revocation is a kill-switch that must work during an incident. Note `verifyDelegation*` are views and are unaffected by pause.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` for non-admins, `EnforcedPause` if already paused.
    /// Maps to: TS SDK delegation.ts pause (admin)
    /// @dev Side effects: sets paused flag. Security: admin-only.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes root proposals/acceptance after a pause.
    /// @dev Admin-only; call after the incident that caused the pause is resolved.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` for non-admins, `ExpectedPause` if not paused.
    /// Maps to: TS SDK delegation.ts unpause (admin)
    /// @dev Side effects: clears paused flag. Security: admin-only.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Grants or revokes the ROOT_UPDATER role, letting a trusted updater propose/accept/cancel roots on any delegator's behalf.
    /// @dev Admin-only. Root updaters are powerful: they manage other delegators' trees, so grant only to operated infrastructure. Revoking the role does not cancel proposals the updater already made.
    /// @param updater Address to grant/revoke. @param allowed True grants the role, false revokes it.
    /// @return Nothing; OZ AccessControl emits `RoleGranted`/`RoleRevoked`.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` for non-admins.
    /// Maps to: TS SDK delegation.ts setRootUpdater
    /// @dev Side effects: grants/revokes `ROOT_UPDATER_ROLE`. Security: admin-only; grants cross-delegator root authority.
    function setRootUpdater(address updater, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed) {
            _grantRole(ROOT_UPDATER_ROLE, updater);
        } else {
            _revokeRole(ROOT_UPDATER_ROLE, updater);
        }
    }

    /// @notice Registers a human-readable action string under its scope hash, so scope hashes stay auditable off-chain.
    /// @dev Admin-only. The scope hash is `keccak256(action)`; registration is a pure label — verification uses the hash, and an unregistered hash still verifies if a root exists for it. Re-registering the same action reverts.
    /// @param action Non-empty action string, e.g. "transfer_tokens" (empty string hashes too, but registers a meaningless scope — prefer non-empty).
    /// @return Nothing; emits `ScopeRegistered` on success.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` (non-admin) or `ScopeAlreadyRegistered` (action already registered).
    /// Maps to: TS SDK delegation.ts registerScope; event ScopeRegistered
    /// @dev Side effects: sets `scopeActions[scopeHash]`, emits `ScopeRegistered`. Security: admin-only.
    function registerScope(string calldata action) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 scopeHash = keccak256(abi.encodePacked(action));
        if (bytes(scopeActions[scopeHash]).length > 0) revert ScopeAlreadyRegistered();
        scopeActions[scopeHash] = action;
        emit ScopeRegistered(action, scopeHash);
    }

    /// @notice Emergency kill-switch: revokes ALL delegation leaves for a delegator at once.
    /// @dev Admin-only, no pause guard — it must work while paused. Sets a flag checked by every verification, so existing proofs fail immediately without touching any root. There is no per-leaf undo; recovery is `reAuthorizeDelegator`, which wipes the delegator's roots and forces fresh publication.
    /// @param delegator Address whose delegations are all revoked.
    /// @return Nothing; emits `DelegatorRevoked` on success.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` for non-admins. Idempotent — revoking an already-revoked delegator succeeds and re-emits.
    /// Maps to: TS SDK delegation.ts emergencyRevokeAll; event DelegatorRevoked
    /// @dev Side effects: sets `revokedDelegators[delegator] = true`, emits `DelegatorRevoked`. Security: admin-only; instant, irreversible except via re-authorization.
    function emergencyRevokeAll(address delegator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokedDelegators[delegator] = true;
        emit DelegatorRevoked(delegator);
    }

    /// @notice Re-authorizes a previously emergency-revoked delegator, clearing the revocation flag AND deleting all its live roots.
    /// @dev Admin-only. Roots are wiped deliberately: a stale root must never silently become valid again after re-authorization — the delegator must publish fresh roots (through the timelock). Per-leaf revocations are NOT cleared (they stay revoked; fresh roots with fresh leaves are the recovery path). No-op for a delegator that was never revoked except that it still wipes its roots — do not call it casually.
    /// @param delegator Address to re-authorize.
    /// @return Nothing; emits `DelegatorReAuthorized` on success.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` for non-admins.
    /// Maps to: TS SDK delegation.ts reAuthorizeDelegator; event DelegatorReAuthorized
    /// @dev Side effects: clears `revokedDelegators[delegator]`, deletes every `delegationRoots[delegator][scope]` and its scope-set entry, emits `DelegatorReAuthorized`. Security: admin-only; destroys live roots.
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

    /// @notice Proposes a new Merkle root for a delegator under one scope, effective only after the 2-day timelock and `acceptDelegationRoot`.
    /// @dev Callable by the delegator themself or a ROOT_UPDATER_ROLE holder. The scope limit (32 scopes per delegator) is checked here and re-checked at accept, because two pending new scopes proposed while under the limit could jointly exceed it by accept time. A pending proposal must be accepted or cancelled before a new one for the same delegator+scope is proposed. Proposing a zero root is allowed here (it clears the scope at accept); proposing for a revoked delegator reverts.
    /// @param delegator Address whose tree this root belongs to. @param scopeHash Scope this root covers (`keccak256(action)`). @param newRoot Merkle root of the delegation tree (zero clears the scope). @param expiresAt Unix timestamp when the root expires, or 0 for no expiry.
    /// @return Nothing; emits `DelegationRootProposed` with the activation timestamp.
    /// @dev Reverts with `DelegatorHasBeenRevoked` (delegator emergency-revoked), `AccessControlUnauthorizedAccount` (caller is neither the delegator nor a root updater), `PendingRootActive` (a proposal is already pending), `ScopeLimitExceeded` (would exceed 32 scopes), `EnforcedPause`.
    /// Maps to: TS SDK delegation.ts proposeDelegationRoot; event DelegationRootProposed
    /// @dev Side effects: writes `pendingDelegationRoots[delegator][scopeHash]`, emits `DelegationRootProposed`. Security: delegator-or-root-updater-only + 2-day timelock.
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

    /// @notice Activates a pending delegation root after the 2-day timelock, so proofs against it verify.
    /// @dev Callable by the delegator or a ROOT_UPDATER_ROLE holder. The scope limit is re-checked here (see `proposeDelegationRoot`). A new scope is added to the delegator's scope set only when the accepted root is non-zero and no live root existed; accepting a zero root for a new scope adds nothing. Calling early reverts; the delegator being emergency-revoked between propose and accept also reverts.
    /// @param delegator Address whose tree this root belongs to. @param scopeHash Scope the pending proposal covers.
    /// @return Nothing; emits `DelegationRootUpdated` on success.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` (caller is neither the delegator nor a root updater), `NoPendingRoot` (nothing proposed), `TimelockNotReady` (delay not yet elapsed), `DelegatorHasBeenRevoked`, `ScopeLimitExceeded`, `EnforcedPause`.
    /// Maps to: TS SDK delegation.ts acceptDelegationRoot; event DelegationRootUpdated
    /// @dev Side effects: writes `delegationRoots[delegator][scopeHash]`, clears the pending proposal, updates the scope set, emits `DelegationRootUpdated`. Security: delegator-or-root-updater-only + timelock.
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

    /// @notice Cancels a pending delegation-root proposal, so the current root stays in force.
    /// @dev Callable by the delegator, a ROOT_UPDATER_ROLE holder, or an admin — and deliberately NOT pause-guarded, so a bad proposal can be killed during an incident. Any of the three roles may cancel, not just the proposer.
    /// @param delegator Address whose proposal is cancelled. @param scopeHash Scope the proposal covers.
    /// @return Nothing; emits `DelegationRootUpdateCancelled` on success.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` (caller holds none of the three roles) or `NoPendingRoot` (nothing proposed). Never reverts for pause.
    /// Maps to: TS SDK delegation.ts cancelDelegationRoot; event DelegationRootUpdateCancelled
    /// @dev Side effects: deletes `pendingDelegationRoots[delegator][scopeHash]`, emits `DelegationRootUpdateCancelled`. Security: delegator/updater/admin-only; no pause guard by design.
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

    /// @notice Revokes one delegation leaf inside the delegator's own namespace, so its proof stops verifying immediately.
    /// @dev Revocations are keyed PER DELEGATOR, and only the delegator, a ROOT_UPDATER_ROLE holder, or the admin may write to that delegator's namespace — a self-registered attacker can only poison their OWN namespace, so cross-delegator griefing is impossible by construction without requiring a leaf preimage or Merkle proof (which would break emergency revocation). No pause guard (kill-switch), and deliberately no un-revoke path: a revoked leaf stays revoked; the delegator publishes fresh roots/leaves instead.
    /// @param delegationLeafHash Hash of the leaf to revoke. @param delegator Address whose namespace the leaf sits in.
    /// @return Nothing; emits `DelegationRevoked` on success.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` (caller is none of delegator/updater/admin) or `AlreadyRevokedDelegation` (leaf already revoked). Never reverts for pause.
    /// Maps to: TS SDK delegation.ts revokeDelegation; event DelegationRevoked
    /// @dev Side effects: sets `revokedDelegations[delegator][delegationLeafHash] = true`, emits `DelegationRevoked`. Security: namespaced revocation; no pause guard by design.
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

    /// @notice Verifies a single-hop delegation: the caller (`msg.sender`) is the delegate, proven by Merkle inclusion under the delegator's root for one scope.
    /// @dev View-only; returns false instead of reverting on any failure (expired/revoked root, revoked leaf, bad preimage, bad proof, depth exceeded). The delegate is always `msg.sender` — this function cannot verify a delegation for someone else. `maxDepth` caps the hop's position (here always depth 1); a `maxDepth` of 0 fails the check.
    /// @param delegationLeaf Leaf hash being proven. @param merkleProof Merkle proof from the leaf to the delegator's root. @param delegator Address that granted the delegation. @param scopeHash Scope the delegation covers. @param expiresAt Leaf expiry (Unix seconds, 0 = no expiry). @param maxDepth Maximum allowed hop depth (must be >= 1 here).
    /// @return True only if the leaf is proven, unrevoked, unexpired, and within depth; false otherwise (never reverts for an invalid delegation).
    /// Maps to: TS SDK delegation.ts verifyDelegation; internal — DelegationManager._verifySingleHop
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

    /// @notice Verifies a single-hop delegation by action name instead of a raw scope hash (hashes the action on the fly).
    /// @dev View-only; identical to `verifyDelegation` except `scopeHash = keccak256(action)`. Returns false instead of reverting on any failure. The delegate is always `msg.sender`.
    /// @param delegationLeaf Leaf hash being proven. @param merkleProof Merkle proof from the leaf to the delegator's root. @param delegator Address that granted the delegation. @param action Human-readable action string whose hash is the scope. @param expiresAt Leaf expiry (Unix seconds, 0 = no expiry). @param maxDepth Maximum allowed hop depth (must be >= 1 here).
    /// @return True only if the leaf is proven, unrevoked, unexpired, and within depth; false otherwise.
    /// Maps to: TS SDK delegation.ts verifyDelegationForAction; internal — DelegationManager._verifySingleHop
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

    /// @notice Verifies a multi-hop delegation chain, where each hop's delegate becomes the next hop's delegator.
    /// @dev Scope rule (fail closed): ALL hops must carry the SAME scopeHash — scopes are opaque hashes, so equality is the only enforceable non-widening rule; a chain like A→B for `read`, B→C for `transfer_assets` is NOT valid. Depth rule: each hop's 1-based position must be ≤ that hop's caller-supplied `maxDepth`, and the chain is capped at `MAX_DELEGATION_DEPTH` (10). `maxDepth` is NOT bound in any leaf or root — a larger-than-needed `maxDepth` is merely permissive, never widening, because hop continuity + per-hop proofs still hold. Returns false on any bad hop; reverts only on malformed input (empty chain, over-long chain, mismatched array lengths).
    /// @param delegationLeaves Leaf hash per hop. @param merkleProofs Merkle proof per hop. @param delegators Delegator per hop; hop i>0 must equal hop i-1's delegate. @param delegates Delegate per hop; the last hop's delegate must be `msg.sender` (enforced by the final `_verifySingleHop` call). @param scopeHashes Scope per hop; all must equal the first hop's scope. @param expiries Leaf expiry per hop (0 = no expiry). @param maxDepths Max depth per hop (each hop's position must be ≤ its entry).
    /// @return True only if every hop verifies and the chain links up (delegator continuity + single scope); false if any hop fails.
    /// @dev Reverts with `EmptyChain` (no hops), `ChainTooLong` (> 10 hops), `ArrayLengthMismatch` (parallel arrays differ in length).
    /// Maps to: TS SDK delegation.ts verifyDelegationChain; internal — DelegationManager._verifySingleHop
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

    /// @notice Returns a delegator's live root for one scope, with its expiry and creation time.
    /// @dev Read-only. A zero `root` means "no live root for this scope" — either never published or cleared (zero-root accept / re-authorization wipe).
    /// @param delegator Address whose root is queried. @param scopeHash Scope to look up.
    /// @return root Live Merkle root (bytes32(0) when none). @return expiresAt Root expiry (0 = no expiry). @return createdAt Time the root was accepted.
    /// Maps to: TS SDK delegation.ts getDelegationRoot
    function getDelegationRoot(address delegator, bytes32 scopeHash) external view returns (bytes32 root, uint64 expiresAt, uint64 createdAt) {
        DelegationRoot storage r = delegationRoots[delegator][scopeHash];
        return (r.root, r.expiresAt, r.createdAt);
    }

    /// @notice Reports whether one delegation leaf is revoked inside a delegator's namespace.
    /// @dev Read-only; never reverts. Revocation is namespaced per delegator — the same leaf hash may be revoked under one delegator and live under another.
    /// @param delegator Address whose namespace is checked. @param leafHash Leaf hash to check.
    /// @return True if revoked under this delegator, false otherwise.
    /// Maps to: TS SDK delegation.ts isRevoked
    function isRevoked(address delegator, bytes32 leafHash) external view returns (bool) {
        return revokedDelegations[delegator][leafHash];
    }

    /// @notice Returns the human-readable action string registered for a scope hash (empty when never registered).
    /// @dev Read-only; labels only — verification never consults this mapping, so an unregistered scope can still verify.
    /// @param scopeHash Scope hash to look up.
    /// @return The registered action string, or "" when the scope was never registered.
    /// Maps to: TS SDK delegation.ts getScopeAction
    function getScopeAction(bytes32 scopeHash) external view returns (string memory) {
        return scopeActions[scopeHash];
    }

    /// @notice Returns how many live scopes a delegator currently has (drives the 32-scope cap).
    /// @dev Read-only. Counts scopes with a live root entry in the set; accepting a zero root for a new scope does not add one, and `reAuthorizeDelegator` resets the count to 0.
    /// @param delegator Address to count scopes for.
    /// @return The number of live scopes (0–32).
    /// Maps to: TS SDK delegation.ts getDelegatorScopeCount
    function getDelegatorScopeCount(address delegator) external view returns (uint256) {
        return EnumerableSet.length(_delegatorScopes[delegator]);
    }

    // ──────────────────────────────────────────────
    //  Internal Verification
    // ──────────────────────────────────────────────

    /// @notice Internal single-hop check shared by all verification entry points: delegator liveness, root liveness/expiry, leaf revocation, leaf expiry, depth, leaf preimage, and Merkle proof.
    /// @dev Fail-closed at every step — any failure returns false, never reverts. The expected leaf is recomputed as `keccak256(abi.encode(delegator, delegate, scopeHash, expiresAt))`, so the caller must pass the exact preimage fields the delegator used when building the tree. Root expiry and leaf expiry are independent checks (either expiring fails the hop; 0 = no expiry in both).
    /// @param delegationLeaf Leaf hash being proven. @param merkleProof Merkle proof to the delegator's root. @param delegator Address that granted the delegation. @param delegate Address the delegation was granted to (must be `msg.sender` for a final hop). @param scopeHash Scope the delegation covers. @param expiresAt Leaf expiry (0 = no expiry). @param maxDepth Maximum allowed hop depth. @param currentDepth This hop's 1-based position in the chain.
    /// @return True only if every check passes; false otherwise.
    /// Maps to: internal — DelegationManager.verifyDelegation, verifyDelegationForAction, verifyDelegationChain
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

    /// @notice UUPS upgrade gate: only an admin may authorize an implementation upgrade.
    /// @dev Reverts with `AccessControlUnauthorizedAccount` for non-admins. Upgrading changes delegation verification — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    uint256[49] private __gap;
}
