// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

error IdentityAlreadyRegistered();
error IdentityAlreadyActive();
error IdentityNotFound();
error IdentityInactive();
error InvalidIdentityId();
error InvalidMetadataRoot();
error MetadataRootUnchanged();
error NotIdentityOwner();
error NotFactory();
error ZeroAddressNotAllowed();

/// @notice Minimal interface for AgentWallet ownership queries.
interface IAgentWallet {
    /// @notice Returns the wallet's owner address (the account controlling the AgentWallet).
    /// @dev Read-only; used to prove "caller owns this identity's wallet". Reverts only if the address is not a contract exposing `owner()`.
    /// @return The owner address.
    /// Maps to: contract AgentWallet.owner
    function owner() external view returns (address);
}

/// @title AgentIdentity
/// @notice Canonical on-chain registry describing an Agent. Stores identityId, wallet reference,
///         credential reference, metadata root, registration state, and timestamps.
/// @dev Upgradeable (UUPS). Created automatically by AgentWalletFactory during wallet creation.
///      Ownership is derived from AgentWallet — no duplicated owner storage.
contract AgentIdentity is
    Initializable,
    PausableUpgradeable,
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable
{
    struct Identity {
        address wallet;
        uint256 credentialId;
        bytes32 metadataRoot;
        uint64 createdAt;
        uint64 updatedAt;
        bool active;
    }

    event IdentityRegistered(uint256 indexed identityId, address indexed wallet);
    event WalletLinked(uint256 indexed identityId, address indexed wallet);
    event CredentialLinked(uint256 indexed identityId, uint256 indexed credentialId);
    event MetadataUpdated(uint256 indexed identityId, bytes32 metadataRoot);
    event IdentityDeactivated(uint256 indexed identityId);
    event IdentityReactivated(uint256 indexed identityId);

    uint256 public identityCount;
    address public walletFactory;

    mapping(uint256 => Identity) private _identities;
    mapping(address => uint256) private _walletToIdentity;

    /// @notice Gates factory-only registration: only the AgentWalletFactory may call the guarded function.
    /// @dev Reverts with `NotFactory` for any other caller; the factory address is set once in `initialize`.
    /// Maps to: contract AgentWalletFactory._createWallet
    modifier onlyFactory() {
        if (msg.sender != walletFactory) revert NotFactory();
        _;
    }

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @dev Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: wires the owner, pause/reentrancy guards, and the factory allowed to register identities.
    /// @dev Runs once (initializer); call it from the proxy deployment, never on the implementation. `walletFactory_` is not zero-checked here, so deploying with address(0) bricks `registerIdentity` (see report).
    /// @param owner_ Admin/owner of this registry (pause + upgrade rights).
    /// @param walletFactory_ AgentWalletFactory permitted to call `registerIdentity`.
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero owner (OZ `OwnableInvalidOwner`).
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner, `walletFactory`; disables further initialization.
    function initialize(address owner_, address walletFactory_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        __ReentrancyGuard_init();
        walletFactory = walletFactory_;
    }

    /// @notice Pauses all state-changing identity operations (register/link/update/deactivate).
    /// @dev Emergency brake for the owner; views keep working while paused. Does not pause `reactivate`'s guard separately — it shares `whenNotPaused`.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `EnforcedPause` if already paused.
    /// Maps to: TS SDK identity.ts pause (owner admin)
    /// @dev Side effects: sets paused flag. Security: owner-only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes identity operations after a pause.
    /// @dev Only the owner may unpause; call after the incident that caused the pause is resolved.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `ExpectedPause` if not paused.
    /// Maps to: TS SDK identity.ts unpause (owner admin)
    /// @dev Side effects: clears paused flag. Security: owner-only.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Registers a new identity for a wallet and returns its fresh sequential id.
    /// @dev Called by AgentWalletFactory during wallet creation; one wallet maps to exactly one identity, ids start at 1 (id 0 means "no identity").
    /// @param wallet Non-zero wallet to register; an already-registered wallet reverts.
    /// @return identityId The newly assigned identity ID (1, 2, 3, ...).
    /// @dev Reverts with `ZeroAddressNotAllowed` (zero wallet), `IdentityAlreadyRegistered` (wallet already has an id), `NotFactory` (non-factory caller), `EnforcedPause` (paused).
    /// Maps to: contract AgentWalletFactory._createWallet; event IdentityRegistered
    /// @dev Side effects: increments `identityCount`, writes the Identity record and wallet→id mapping, emits `IdentityRegistered`. Security: factory-only.
    function registerIdentity(address wallet) external onlyFactory whenNotPaused nonReentrant returns (uint256 identityId) {
        if (wallet == address(0)) revert ZeroAddressNotAllowed();
        if (_walletToIdentity[wallet] != 0) revert IdentityAlreadyRegistered();

        identityId = ++identityCount;
        _identities[identityId] = Identity({
            wallet: wallet,
            credentialId: 0,
            metadataRoot: bytes32(0),
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            active: true
        });
        _walletToIdentity[wallet] = identityId;

        emit IdentityRegistered(identityId, wallet);
    }

    /// @notice Links a CredentialRegistry credential to an identity, overwriting any previous link.
    /// @dev Only the wallet owner may call it; the credential itself is not validated here — validity is enforced at session creation via the ZK proof. Overwriting is intentional (credential rotation).
    /// @param credentialId Credential id from CredentialRegistry; 0 clears the link (no existence check is performed).
    /// @dev Emits `CredentialLinked` on success.
    /// @dev Reverts with `IdentityNotFound` (unknown id), `IdentityInactive` (deactivated), `NotIdentityOwner` (caller is not the wallet owner), `EnforcedPause` (paused).
    /// Maps to: TS SDK identity.ts linkCredential
    /// @dev Side effects: sets `credentialId` and `updatedAt`, emits `CredentialLinked`. Security: wallet-owner-only.
    function linkCredential(uint256 identityId, uint256 credentialId) external whenNotPaused nonReentrant {
        address wallet = _requireActive(identityId);
        if (msg.sender != IAgentWallet(wallet).owner()) revert NotIdentityOwner();

        _identities[identityId].credentialId = credentialId;
        _identities[identityId].updatedAt = uint64(block.timestamp);
        emit CredentialLinked(identityId, credentialId);
    }

    /// @notice Points an identity at a new off-chain metadata root hash.
    /// @dev Only the wallet owner may call it; the root is opaque content-addressed data — this contract never reads the metadata itself, so callers must pin/verify it off-chain.
    /// @param metadataRoot Non-zero new root hash; reverts if zero or identical to the current root (no-op updates are rejected).
    /// @dev Emits `MetadataUpdated` on success.
    /// @dev Reverts with `IdentityNotFound`, `IdentityInactive`, `NotIdentityOwner`, `InvalidMetadataRoot` (zero root), `MetadataRootUnchanged` (same root), `EnforcedPause`.
    /// Maps to: TS SDK identity.ts updateMetadata
    /// @dev Side effects: sets `metadataRoot` and `updatedAt`, emits `MetadataUpdated`. Security: wallet-owner-only.
    function updateMetadata(uint256 identityId, bytes32 metadataRoot) external whenNotPaused nonReentrant {
        address wallet = _requireActive(identityId);
        if (msg.sender != IAgentWallet(wallet).owner()) revert NotIdentityOwner();
        if (metadataRoot == bytes32(0)) revert InvalidMetadataRoot();
        if (metadataRoot == _identities[identityId].metadataRoot) revert MetadataRootUnchanged();

        _identities[identityId].metadataRoot = metadataRoot;
        _identities[identityId].updatedAt = uint64(block.timestamp);
        emit MetadataUpdated(identityId, metadataRoot);
    }

    /// @notice Deactivates an identity, blocking owner actions on it until reactivated.
    /// @dev Only the wallet owner may call it. Deactivation is soft: the record stays queryable (`exists` stays true, `isActive` goes false) and `reactivate` restores it. Already-deactivated ids revert via `_requireActive`.
    /// @dev Emits `IdentityDeactivated` on success.
    /// @dev Reverts with `IdentityNotFound`, `IdentityInactive` (already deactivated), `NotIdentityOwner`, `EnforcedPause`.
    /// Maps to: TS SDK identity.ts deactivate
    /// @dev Side effects: sets `active = false` and `updatedAt`, emits `IdentityDeactivated`. Security: wallet-owner-only.
    function deactivate(uint256 identityId) external whenNotPaused nonReentrant {
        address wallet = _requireActive(identityId);
        if (msg.sender != IAgentWallet(wallet).owner()) revert NotIdentityOwner();

        _identities[identityId].active = false;
        _identities[identityId].updatedAt = uint64(block.timestamp);
        emit IdentityDeactivated(identityId);
    }

    /// @notice Reactivates a deactivated identity, restoring owner actions on it.
    /// @dev Only the wallet owner may call it. Unlike the other mutators it uses `_requireExists` (not `_requireActive`) because an inactive identity must still be reachable to reactivate.
    /// @dev Emits `IdentityReactivated` on success.
    /// @dev Reverts with `IdentityNotFound`, `IdentityAlreadyActive` (already active), `NotIdentityOwner`, `EnforcedPause`.
    /// Maps to: TS SDK identity.ts reactivate
    /// @dev Side effects: sets `active = true` and `updatedAt`, emits `IdentityReactivated`. Security: wallet-owner-only.
    function reactivate(uint256 identityId) external whenNotPaused nonReentrant {
        Identity storage id = _requireExists(identityId);
        if (id.active) revert IdentityAlreadyActive();
        if (msg.sender != IAgentWallet(id.wallet).owner()) revert NotIdentityOwner();

        id.active = true;
        id.updatedAt = uint64(block.timestamp);
        emit IdentityReactivated(identityId);
    }

    /// @notice Returns the identity id for a wallet, or 0 when the wallet was never registered.
    /// @dev Read-only lookup; 0 is the "not found" answer here, not a revert — use `exists`/`walletOf` when an unknown wallet must fail loudly.
    /// @return The identity id, or 0 for an unregistered wallet.
    /// Maps to: TS SDK identity.ts identityOf
    function identityOf(address wallet) external view returns (uint256) {
        return _walletToIdentity[wallet];
    }

    /// @notice Returns the wallet address bound to an identity.
    /// @dev Read-only lookup.
    /// @return The wallet address; reverts with `IdentityNotFound` for an unknown id (never returns zero).
    /// Maps to: TS SDK identity.ts walletOf
    function walletOf(uint256 identityId) external view returns (address) {
        return _requireExists(identityId).wallet;
    }

    /// @notice Returns the credential id currently linked to an identity (0 when none is linked).
    /// @dev Read-only lookup; 0 means "no credential linked", not an error.
    /// @return The linked credential id, or 0.
    /// Maps to: TS SDK identity.ts credentialOf
    function credentialOf(uint256 identityId) external view returns (uint256) {
        return _requireExists(identityId).credentialId;
    }

    /// @notice Returns the off-chain metadata root hash for an identity (bytes32(0) when never set).
    /// @dev Read-only lookup; a zero root means "no metadata published yet".
    /// @return The metadata root hash, or bytes32(0).
    /// Maps to: TS SDK identity.ts metadataOf
    function metadataOf(uint256 identityId) external view returns (bytes32) {
        return _requireExists(identityId).metadataRoot;
    }

    /// @notice Reports whether an identity id exists (a wallet was ever registered under it).
    /// @dev Read-only; unlike the getters above it never reverts. Deactivated identities still count as existing.
    /// @return True if the id was registered, false otherwise.
    /// Maps to: TS SDK identity.ts exists
    function exists(uint256 identityId) external view returns (bool) {
        return _identities[identityId].wallet != address(0);
    }

    /// @notice Reports whether an identity exists AND is currently active.
    /// @dev Read-only; never reverts. False covers both "never registered" and "deactivated".
    /// @return True only for a registered, active identity.
    /// Maps to: TS SDK identity.ts isActive
    function isActive(uint256 identityId) external view returns (bool) {
        Identity storage id = _identities[identityId];
        return id.wallet != address(0) && id.active;
    }

    /// @notice Returns an identity's registration and last-update timestamps (seconds since epoch, truncated to uint64).
    /// @dev Read-only lookup.
    /// @return createdAt Registration time; updatedAt time of the last link/metadata/active-state change.
    /// @dev Reverts with `IdentityNotFound` for an unknown id.
    /// Maps to: TS SDK identity.ts timestampsOf
    function timestampsOf(uint256 identityId) external view returns (uint64 createdAt, uint64 updatedAt) {
        Identity storage id = _requireExists(identityId);
        return (id.createdAt, id.updatedAt);
    }

    /// @notice Returns the wallet owner of an identity, resolving ownership through the AgentWallet itself.
    /// @dev Read-only; ownership is derived live from the wallet, never cached here, so an ownership transfer is reflected immediately.
    /// @return The owner address of the identity's wallet.
    /// @dev Reverts with `IdentityNotFound` for an unknown id. The external `owner()` call can also revert if the wallet address is not a contract (not possible for registered identities).
    /// Maps to: TS SDK identity.ts ownerOfIdentity
    function ownerOfIdentity(uint256 identityId) external view returns (address) {
        address wallet = _requireExists(identityId).wallet;
        return IAgentWallet(wallet).owner();
    }

    /// @notice Internal guard: loads an identity or reverts when the id was never registered.
    /// @dev Shared by every getter/mutator that must fail on unknown ids.
    /// @return id Storage reference to the identity record.
    /// @dev Reverts with `IdentityNotFound` when the stored wallet is address(0).
    /// Maps to: internal — AgentIdentity getters and mutators
    function _requireExists(uint256 identityId) internal view returns (Identity storage id) {
        id = _identities[identityId];
        if (id.wallet == address(0)) revert IdentityNotFound();
    }

    /// @notice Internal guard: loads an identity that exists and is active, returning its wallet.
    /// @dev Shared by mutators that must reject deactivated identities.
    /// @return The identity's wallet address.
    /// @dev Reverts with `IdentityNotFound` (unknown id) or `IdentityInactive` (deactivated).
    /// Maps to: internal — AgentIdentity linkCredential, updateMetadata, deactivate
    function _requireActive(uint256 identityId) internal view returns (address) {
        Identity storage id = _requireExists(identityId);
        if (!id.active) revert IdentityInactive();
        return id.wallet;
    }

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrades are a one-way trust decision — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
