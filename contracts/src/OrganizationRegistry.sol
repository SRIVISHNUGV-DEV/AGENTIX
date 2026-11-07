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

    uint256 public constant TIMELOCK_DELAY = 2 days;

    mapping(bytes32 => address) public pendingAnchor;
    mapping(bytes32 => uint256) public anchorActivationTime;

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @return Nothing. Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: wires the owner, the pause guard, and the anchor implementation to clone.
    /// @dev Runs once (initializer) from the proxy deployment. The anchor implementation is the template every organization's clone points at; swapping it later requires an upgrade (there is no setter — new organizations always use this implementation).
    /// @param owner_ Admin/owner (pause + upgrade + registration rights). @param anchorImplementation_ Non-zero OrganizationCredentialAnchor implementation to clone.
    /// @return Nothing.
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero implementation (`ZeroAddressNotAllowed`); a zero owner reverts via OZ `OwnableInvalidOwner`.
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner, `anchorImplementation`. Security: deployer-chosen owner.
    function initialize(address owner_, address anchorImplementation_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        if (anchorImplementation_ == address(0)) revert ZeroAddressNotAllowed();
        anchorImplementation = anchorImplementation_;
    }

    /// @notice Pauses organization registration (deactivation/reactivation and anchor swaps stay available while paused).
    /// @dev Emergency brake for the owner; `deactivateOrganization`, `reactivateOrganization`, and anchor management deliberately have no pause guard so containment still works mid-pause. Views keep working.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `EnforcedPause` if already paused.
    /// Maps to: TS SDK organization.ts pause (registry owner)
    /// @dev Side effects: sets paused flag. Security: owner-only.
    function pause() external onlyOwner { _pause(); }
    /// @notice Resumes organization registration after a pause.
    /// @dev Only the owner may unpause; call after the incident that caused the pause is resolved.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `ExpectedPause` if not paused.
    /// Maps to: TS SDK organization.ts unpause (registry owner)
    /// @dev Side effects: clears paused flag. Security: owner-only.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Registers a new organization and deploys its credential-anchor clone, owned by the given address.
    /// @dev Owner-only. The anchor is a deterministic EIP-1167 clone salted by the organization id, so the same id always predicts the same anchor address — and re-registering an id reverts before any deployment. The organization starts active. The anchor's owner is `owner_` (the organization owner), not the registry owner, so the registry cannot later manage the anchor's roots.
    /// @param organizationId Caller-chosen non-zero id (typically a hash); must be unused. @param name Non-empty display name. @param owner_ Non-zero organization owner who will own the anchor.
    /// @return Nothing; emits `OrganizationRegistered` with the anchor address on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `OrganizationAlreadyExists` (id taken), `InvalidOwnerAddress` (zero owner), `InvalidName` (empty name), `EnforcedPause` (paused). The clone's `initialize` can also revert on a zero id.
    /// Maps to: TS SDK organization.ts registerOrganization; contract OrganizationCredentialAnchor.initialize; event OrganizationRegistered
    /// @dev Side effects: deploys a deterministic anchor clone, initializes it, stores the Organization record, appends to the owner's list, emits `OrganizationRegistered`. Security: registry-owner-only; anchor ownership goes to `owner_`.
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

    /// @notice Deactivates an organization, marking it inactive in the registry (the anchor itself is untouched).
    /// @dev Owner-only, no pause guard — deactivation is a containment action that must work mid-pause. Deactivation is soft: the record and anchor stay queryable, and `reactivateOrganization` restores it. Consumers must check `isActive`; this contract does not block anchor operations for deactivated organizations.
    /// @param organizationId Id of the organization to deactivate.
    /// @return Nothing; emits `OrganizationDeactivated` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `OrganizationNotFound` (unknown id), `OrganizationAlreadyInactive` (already inactive).
    /// Maps to: TS SDK organization.ts deactivateOrganization; event OrganizationDeactivated
    /// @dev Side effects: sets `active = false`, emits `OrganizationDeactivated`. Security: registry-owner-only.
    function deactivateOrganization(bytes32 organizationId) external onlyOwner {
        Organization storage org = _getOrg(organizationId);
        if (!org.active) revert OrganizationAlreadyInactive();
        org.active = false;
        emit OrganizationDeactivated(organizationId);
    }

    /// @notice Reactivates a deactivated organization.
    /// @dev Owner-only, no pause guard. Restores the registry's active flag; it does not touch the anchor or its roots.
    /// @param organizationId Id of the organization to reactivate.
    /// @return Nothing; emits `OrganizationReactivated` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `OrganizationNotFound` (unknown id), `OrganizationAlreadyActive` (already active).
    /// Maps to: TS SDK organization.ts reactivateOrganization; event OrganizationReactivated
    /// @dev Side effects: sets `active = true`, emits `OrganizationReactivated`. Security: registry-owner-only.
    function reactivateOrganization(bytes32 organizationId) external onlyOwner {
        Organization storage org = _getOrg(organizationId);
        if (org.active) revert OrganizationAlreadyActive();
        org.active = true;
        emit OrganizationReactivated(organizationId);
    }

    /// @notice Proposes swapping an organization's credential anchor for a new one, effective only after the 2-day timelock and `acceptCredentialAnchor`.
    /// @dev Owner-only. The new anchor must be a deployed contract (code length is checked) — an EOA or empty address cannot become an anchor. Only one proposal per organization may be pending at a time. Note there is no cancel function: a bad proposal can only be cleared by accepting it (after the timelock) and then proposing the correct anchor — leaving it pending blocks all future proposals for that organization (see report).
    /// @param organizationId Id of the organization. @param newAnchor Non-zero address of a deployed contract to become the new anchor.
    /// @return Nothing; emits `CredentialAnchorProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `ZeroAddressNotAllowed` (zero anchor), `InvalidAnchor` (no code at the address), `OrganizationNotFound` (unknown id), `AnchorTimelockActive` (a proposal is already pending).
    /// Maps to: TS SDK organization.ts proposeCredentialAnchor; event CredentialAnchorProposed
    /// @dev Side effects: sets `pendingAnchor[organizationId]` and `anchorActivationTime[organizationId]`, emits `CredentialAnchorProposed`. Security: registry-owner-only + 2-day timelock.
    function proposeCredentialAnchor(bytes32 organizationId, address newAnchor) external onlyOwner {
        if (newAnchor == address(0)) revert ZeroAddressNotAllowed();
        if (newAnchor.code.length == 0) revert InvalidAnchor();
        _getOrg(organizationId);
        if (pendingAnchor[organizationId] != address(0)) revert AnchorTimelockActive();
        pendingAnchor[organizationId] = newAnchor;
        anchorActivationTime[organizationId] = block.timestamp + TIMELOCK_DELAY;
        emit CredentialAnchorProposed(organizationId, _organizations[organizationId].credentialAnchor, newAnchor, anchorActivationTime[organizationId]);
    }

    /// @notice Activates the pending credential anchor once the 2-day timelock has elapsed.
    /// @dev Owner-only. Calling early reverts. The old anchor is NOT decommissioned — it keeps its own roots and owner; only the registry pointer moves, so verifiers reading `getCredentialAnchor` switch immediately. The new anchor is not initialized or validated here beyond the code check at propose time — deploy and initialize it before proposing.
    /// @param organizationId Id of the organization.
    /// @return Nothing; emits `CredentialAnchorUpdated` with old and new anchors.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `InvalidAnchor` (no proposal pending), `AnchorTimelockNotReady` (delay not yet elapsed), `OrganizationNotFound` (unknown id).
    /// Maps to: TS SDK organization.ts acceptCredentialAnchor; event CredentialAnchorUpdated
    /// @dev Side effects: sets the organization's `credentialAnchor`, clears the pending proposal and activation time, emits `CredentialAnchorUpdated`. Security: registry-owner-only + timelock.
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

    /// @notice Returns the full stored record for an organization.
    /// @dev Read-only; reverts for unknown ids (use `organizationExists` for a non-reverting check).
    /// @param organizationId Id to look up.
    /// @return The Organization struct (organizationId, name, owner, credentialAnchor, active, createdAt).
    /// @dev Reverts with `OrganizationNotFound` for an unknown id.
    /// Maps to: TS SDK organization.ts getOrganization
    function getOrganization(bytes32 organizationId) external view returns (Organization memory) {
        return _getOrg(organizationId);
    }

    /// @notice Reports whether an organization id was ever registered.
    /// @dev Read-only; never reverts. Deactivated organizations still count as existing.
    /// @param organizationId Id to check.
    /// @return True if registered, false otherwise.
    /// Maps to: TS SDK organization.ts organizationExists
    function organizationExists(bytes32 organizationId) external view returns (bool) {
        return _organizations[organizationId].createdAt != 0;
    }

    /// @notice Reports whether an organization is currently active.
    /// @dev Read-only; never reverts. Returns false both for "never registered" and "deactivated" — combine with `organizationExists` when the distinction matters.
    /// @param organizationId Id to check.
    /// @return True only for a registered, active organization.
    /// Maps to: TS SDK organization.ts isActive
    function isActive(bytes32 organizationId) external view returns (bool) {
        return _organizations[organizationId].active;
    }

    /// @notice Returns the credential-anchor address currently recorded for an organization.
    /// @dev Read-only; does NOT revert for unknown ids — it returns address(0) (the mapping default). Use `getOrganization` when an unknown id must fail loudly.
    /// @param organizationId Id to look up.
    /// @return The anchor address, or address(0) for an unregistered organization.
    /// Maps to: TS SDK organization.ts getCredentialAnchor
    function getCredentialAnchor(bytes32 organizationId) external view returns (address) {
        return _organizations[organizationId].credentialAnchor;
    }

    /// @notice Returns every organization id ever registered under one owner address.
    /// @dev Read-only. The list is append-only: deactivation never removes an id, and there is no removal path. An owner with no organizations gets an empty array, not a revert.
    /// @param owner_ Owner address to look up.
    /// @return The array of organization ids (possibly empty).
    /// Maps to: TS SDK organization.ts getOwnerOrganizations
    function getOwnerOrganizations(address owner_) external view returns (bytes32[] memory) {
        return _ownerOrganizations[owner_];
    }

    /// @notice Internal guard: loads an organization or reverts when the id was never registered.
    /// @dev Shared by every function that must fail on unknown ids. Existence is proven by a non-zero `createdAt` (set once at registration, never cleared).
    /// @param organizationId Id to load.
    /// @return org Storage reference to the organization record.
    /// @dev Reverts with `OrganizationNotFound` when `createdAt == 0`.
    /// Maps to: internal — OrganizationRegistry mutators and getters
    function _getOrg(bytes32 organizationId) internal view returns (Organization storage org) {
        org = _organizations[organizationId];
        if (org.createdAt == 0) revert OrganizationNotFound();
    }

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrading changes how organizations and anchors are registered — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
