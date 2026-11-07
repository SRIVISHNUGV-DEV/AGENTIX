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

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @dev Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: wires the owner and the pause guard.
    /// @dev Runs once (initializer) from the proxy deployment. The owner is the default capability registrar and admin.
    /// @param owner_ Admin/owner of this registry (pause + upgrade rights, default registrar).
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero owner (OZ `OwnableInvalidOwner`).
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner, clears paused flag. Security: deployer-chosen owner.
    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
    }

    /// @notice Pauses capability registration and grant-root updates (revocation stays available while paused).
    /// @dev Emergency brake for the owner; `revokeCapability` and `revokeGrant` deliberately have no pause guard so a compromise can still be contained mid-pause. Views keep working.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `EnforcedPause` if already paused.
    /// Maps to: TS SDK capability.ts pause (owner admin)
    /// @dev Side effects: sets paused flag. Security: owner-only.
    function pause() external onlyOwner { _pause(); }
    /// @notice Resumes capability registration and grant-root updates after a pause.
    /// @dev Only the owner may unpause; call after the incident that caused the pause is resolved.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `ExpectedPause` if not paused.
    /// Maps to: TS SDK capability.ts unpause (owner admin)
    /// @dev Side effects: clears paused flag. Security: owner-only.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Defines a new named capability (an action an agent may be granted), identified by a caller-chosen id.
    /// @dev Owner-only. The action string is hashed, not stored — the plaintext action is recoverable only from the event. `expiresAt` of 0 means the definition itself never expires (per-grant expiries still apply in `verifyCapability`).
    /// @param capabilityId Caller-chosen id (typically a hash); must be unused. @param action Non-empty human-readable action string, e.g. "transfer_tokens". @param expiresAt Unix timestamp when the definition expires, or 0 for no expiry.
    /// @dev Emits `CapabilityRegistered` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `CapabilityExists` (id already registered), `ActionRequired` (empty action), `EnforcedPause` (paused).
    /// Maps to: TS SDK capability.ts registerCapability; event CapabilityRegistered
    /// @dev Side effects: writes the CapabilityDef, appends to the capability list/index, emits `CapabilityRegistered`. Security: owner-only.
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

    /// @notice Revokes a capability definition, removing it from enumeration so no new grant can be verified against it.
    /// @dev Callable by the original registrar or the owner — and deliberately NOT pause-guarded, so revocation works as a kill-switch during an incident. Revocation is permanent for the definition (no un-revoke); grants already issued under it fail verification because the definition is gone from the list and `revoked` is set. Note the swap-and-pop removal: enumeration order changes.
    /// @param capabilityId Id of the capability to revoke.
    /// @dev Emits `CapabilityRevoked` on success.
    /// @dev Reverts with `CapabilityNotFound` (never registered), `NotAuthorizedForCapability` (caller is neither registrar nor owner), `AlreadyRevokedCapability` (already revoked).
    /// Maps to: TS SDK capability.ts revokeCapability; event CapabilityRevoked
    /// @dev Side effects: sets `revoked = true`, swap-and-pop removes the id from `capabilityList`, emits `CapabilityRevoked`. Security: registrar-or-owner-only; no pause guard by design.
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

    /// @notice Publishes (or replaces) the Merkle root of the grants a grantor has given one grantee for one capability.
    /// @dev Callable by the capability's registrar or the owner; the stored root is keyed by `msg.sender` as grantor, so the caller is always the grantor — a grantor cannot publish roots for someone else. Publishing a new root supersedes the old one for future verifications; already-issued leaves under the old root stop verifying unless they are also in the new tree.
    /// @param grantee Non-zero agent receiving the grant. @param capabilityId Id of a registered capability. @param newRoot Non-zero Merkle root of the grant tree.
    /// @dev Emits `GrantRootUpdated` on success.
    /// @dev Reverts with `InvalidRecipient` (zero grantee), `CapabilityNotFound` (unknown capability), `NotAuthorizedForCapability` (caller is neither registrar nor owner), `InvalidRoot` (zero root), `EnforcedPause` (paused).
    /// Maps to: TS SDK capability.ts updateGrantRoot; event GrantRootUpdated
    /// @dev Side effects: sets `grantRoots[msg.sender][grantee][capabilityId]`, emits `GrantRootUpdated`. Security: registrar-or-owner-only; grantor is always `msg.sender`.
    function updateGrantRoot(address grantee, bytes32 capabilityId, bytes32 newRoot) external whenNotPaused {
        if (grantee == address(0)) revert InvalidRecipient();
        CapabilityDef storage cap = capabilities[capabilityId];
        if (cap.createdAt == 0) revert CapabilityNotFound();
        if (cap.registrar != msg.sender && msg.sender != owner()) revert NotAuthorizedForCapability();
        if (newRoot == bytes32(0)) revert InvalidRoot();
        grantRoots[msg.sender][grantee][capabilityId] = newRoot;
        emit GrantRootUpdated(msg.sender, grantee, capabilityId, newRoot);
    }

    /// @notice Revokes one specific grant leaf, so its Merkle proof stops verifying even though the grant root is unchanged.
    /// @dev Callable by the registrar, the owner, or the grantor named in the call — and deliberately NOT pause-guarded (kill-switch). Revocation is permanent for the leaf (no un-revoke); the grantor publishes a fresh root or re-issues instead. The leaf preimage is not checked here, so the caller must supply the exact leaf hash they mean.
    /// @param grantLeafHash Hash of the grant leaf to revoke. @param capabilityId Id of the capability the grant belongs to. @param grantor Address whose grant root the leaf sits under. @param grantee Address the grant was issued to.
    /// @dev Emits `GrantRevoked` on success.
    /// @dev Reverts with `GrantNotRevocable` (caller is none of registrar/owner/grantor, or no grant root exists for this grantor/grantee/capability) or `AlreadyRevokedGrant` (leaf already revoked).
    /// Maps to: TS SDK capability.ts revokeGrant; event GrantRevoked
    /// @dev Side effects: sets `revokedGrants[grantLeafHash] = true`, emits `GrantRevoked`. Security: registrar/owner/grantor-only; no pause guard by design.
    function revokeGrant(bytes32 grantLeafHash, bytes32 capabilityId, address grantor, address grantee) external {
        if (capabilities[capabilityId].registrar != msg.sender && msg.sender != owner() && msg.sender != grantor) revert GrantNotRevocable();
        if (grantRoots[grantor][grantee][capabilityId] == bytes32(0)) revert GrantNotRevocable();
        if (revokedGrants[grantLeafHash]) revert AlreadyRevokedGrant();
        revokedGrants[grantLeafHash] = true;
        emit GrantRevoked(grantLeafHash);
    }

    /// @notice Verifies that an agent holds a capability grant: checks the definition, the leaf preimage, the Merkle proof against the grantor's root, and both expiries.
    /// @dev Pure view — it never reverts on a bad grant, it returns false. Callers must treat false as "not authorized". The expected leaf is recomputed as `keccak256(abi.encode(capabilityId, grantor, agent, constraintsHash, expiresAt))`, so the caller must pass the exact preimage fields the grantor used; `agent` here is the grantee address the grant was issued to. Both the definition expiry and the per-grant `expiresAt` are enforced (0 = no expiry in either case).
    /// @param agent Grantee address the grant was issued to. @param capabilityId Id of the capability. @param grantLeaf The grant leaf hash being proven. @param merkleProof Merkle proof from the leaf to the grantor's root. @param grantor Address that published the grant root; must equal the capability's registrar. @param constraintsHash Hash of the grant's constraints (part of the leaf preimage). @param expiresAt Per-grant expiry (Unix seconds, 0 = no expiry).
    /// @return True only if every check passes (definition live, leaf matches preimage, root exists and is non-revoked, both expiries unexpired, Merkle proof valid); false otherwise — never reverts for an invalid grant.
    /// Maps to: TS SDK capability.ts verifyCapability; contract DelegationManager.verifyDelegation (same Merkle-proof pattern)
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

    /// @notice Returns the full stored definition for a capability.
    /// @dev Read-only. For an unregistered id it returns a zeroed struct (`createdAt == 0`, `actionHash == 0`) rather than reverting — check `createdAt` to distinguish "never registered".
    /// @param capabilityId Id to look up.
    /// @return The CapabilityDef struct (actionHash, registrar, createdAt, expiresAt, revoked).
    /// Maps to: TS SDK capability.ts getCapability
    function getCapability(bytes32 capabilityId) external view returns (CapabilityDef memory) {
        return capabilities[capabilityId];
    }

    /// @notice Returns how many capability definitions are currently enumerated (registered and not revoked).
    /// @dev Read-only; revoked capabilities are removed from the list, so this shrinks on revocation.
    /// @return The count of live capability definitions.
    /// Maps to: TS SDK capability.ts getCapabilityCount
    function getCapabilityCount() external view returns (uint256) {
        return capabilityList.length;
    }

    /// @notice Returns the capability id at an enumeration index (for iterating all live definitions).
    /// @dev Read-only. Order is insertion order except that revocation swap-and-pops, moving the last id into the revoked id's slot — never assume stable indices across revocations.
    /// @param index Zero-based index, must be < `getCapabilityCount()`.
    /// @return The capability id at that index.
    /// @dev Reverts with a panic (array out-of-bounds) for an out-of-range index.
    /// Maps to: TS SDK capability.ts getCapabilityAt
    function getCapabilityAt(uint256 index) external view returns (bytes32) {
        return capabilityList[index];
    }

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrading changes how capability grants verify — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
