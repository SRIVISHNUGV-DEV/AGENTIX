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

    modifier onlyFactory() {
        if (msg.sender != walletFactory) revert NotFactory();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address walletFactory_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        __ReentrancyGuard_init();
        walletFactory = walletFactory_;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Registers a new identity for a wallet. Called by AgentWalletFactory during wallet creation.
    /// @param wallet The wallet address to register.
    /// @return identityId The newly assigned identity ID.
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

    /// @notice Links a credential to an identity. Only callable by the wallet owner.
    /// @param identityId The identity to link the credential to.
    /// @param credentialId The credential ID from CredentialRegistry.
    function linkCredential(uint256 identityId, uint256 credentialId) external whenNotPaused nonReentrant {
        address wallet = _requireActive(identityId);
        if (msg.sender != IAgentWallet(wallet).owner()) revert NotIdentityOwner();

        _identities[identityId].credentialId = credentialId;
        _identities[identityId].updatedAt = uint64(block.timestamp);
        emit CredentialLinked(identityId, credentialId);
    }

    /// @notice Updates the metadata root hash. Only callable by the wallet owner.
    /// @param identityId The identity to update.
    /// @param metadataRoot The new metadata root hash (off-chain content).
    function updateMetadata(uint256 identityId, bytes32 metadataRoot) external whenNotPaused nonReentrant {
        address wallet = _requireActive(identityId);
        if (msg.sender != IAgentWallet(wallet).owner()) revert NotIdentityOwner();
        if (metadataRoot == bytes32(0)) revert InvalidMetadataRoot();
        if (metadataRoot == _identities[identityId].metadataRoot) revert MetadataRootUnchanged();

        _identities[identityId].metadataRoot = metadataRoot;
        _identities[identityId].updatedAt = uint64(block.timestamp);
        emit MetadataUpdated(identityId, metadataRoot);
    }

    /// @notice Deactivates an identity. Only callable by the wallet owner.
    /// @param identityId The identity to deactivate.
    function deactivate(uint256 identityId) external whenNotPaused nonReentrant {
        address wallet = _requireActive(identityId);
        if (msg.sender != IAgentWallet(wallet).owner()) revert NotIdentityOwner();

        _identities[identityId].active = false;
        _identities[identityId].updatedAt = uint64(block.timestamp);
        emit IdentityDeactivated(identityId);
    }

    /// @notice Reactivates a deactivated identity. Only callable by the wallet owner.
    /// @param identityId The identity to reactivate.
    function reactivate(uint256 identityId) external whenNotPaused nonReentrant {
        Identity storage id = _requireExists(identityId);
        if (id.active) revert IdentityAlreadyActive();
        if (msg.sender != IAgentWallet(id.wallet).owner()) revert NotIdentityOwner();

        id.active = true;
        id.updatedAt = uint64(block.timestamp);
        emit IdentityReactivated(identityId);
    }

    function identityOf(address wallet) external view returns (uint256) {
        return _walletToIdentity[wallet];
    }

    function walletOf(uint256 identityId) external view returns (address) {
        return _requireExists(identityId).wallet;
    }

    function credentialOf(uint256 identityId) external view returns (uint256) {
        return _requireExists(identityId).credentialId;
    }

    function metadataOf(uint256 identityId) external view returns (bytes32) {
        return _requireExists(identityId).metadataRoot;
    }

    function exists(uint256 identityId) external view returns (bool) {
        return _identities[identityId].wallet != address(0);
    }

    function isActive(uint256 identityId) external view returns (bool) {
        Identity storage id = _identities[identityId];
        return id.wallet != address(0) && id.active;
    }

    function timestampsOf(uint256 identityId) external view returns (uint64 createdAt, uint64 updatedAt) {
        Identity storage id = _requireExists(identityId);
        return (id.createdAt, id.updatedAt);
    }

    /// @notice Returns the wallet owner of an identity. Resolves through AgentWallet.
    /// @param identityId The identity to query.
    /// @return The owner address of the identity's wallet.
    function ownerOfIdentity(uint256 identityId) external view returns (address) {
        address wallet = _requireExists(identityId).wallet;
        return IAgentWallet(wallet).owner();
    }

    function _requireExists(uint256 identityId) internal view returns (Identity storage id) {
        id = _identities[identityId];
        if (id.wallet == address(0)) revert IdentityNotFound();
    }

    function _requireActive(uint256 identityId) internal view returns (address) {
        Identity storage id = _requireExists(identityId);
        if (!id.active) revert IdentityInactive();
        return id.wallet;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
