// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error OnlyIssuer();
error OnlyOwner();
error InvalidOwner();
error NullifierUsed();
error OnlySessionManager();

/// @title CredentialRegistry
/// @notice Manages Merkle roots for credential trees and nullifier tracking to prevent double-use of credentials.
/// @dev Upgradeable (UUPS) singleton. Issuers update roots; SessionManagers consume nullifiers.
contract CredentialRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    event CredentialIssued(address indexed issuer, bytes32 indexed commitment, uint64 expiry);
    event CredentialRevoked(address indexed issuer, bytes32 indexed commitment);
    event ActiveRootUpdated(bytes32 indexed newRoot);
    event RevokedSecretRootUpdated(bytes32 indexed newRoot);

    /// @notice Addresses authorised to update Merkle roots.
    mapping(address => bool) public issuers;
    /// @notice Addresses authorised to mark nullifiers as used (i.e. SessionManager contracts).
    mapping(address => bool) public sessionManagers;

    /// @notice Current root of the active (non-revoked) credential Merkle tree.
    bytes32 public activeRoot;
    /// @notice Current root of the revoked-secret Merkle tree (used to prove non-revocation).
    bytes32 public revokedSecretRoot;

    /// @notice Tracks nullifiers already consumed to prevent credential double-spending.
    mapping(bytes32 => bool) public usedNullifiers;

    modifier onlyIssuer() {
        if (!issuers[msg.sender]) revert OnlyIssuer();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the registry and sets the initial owner.
    /// @param owner_ The address that will own the contract and be added as an issuer.
    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        __UUPSUpgradeable_init();
        issuers[owner_] = true;
    }

    /// @notice Pauses root updates. Only callable by the owner.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses root updates. Only callable by the owner.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Grants issuer role to an address.
    /// @param issuer The address to authorise.
    function addIssuer(address issuer) external onlyOwner {
        issuers[issuer] = true;
    }

    /// @notice Revokes issuer role from an address.
    /// @param issuer The address to de-authorise.
    function removeIssuer(address issuer) external onlyOwner {
        issuers[issuer] = false;
    }

    /// @notice Enables or disables an address as a session manager.
    /// @param sessionManager The contract address to configure.
    /// @param allowed Whether the address may mark nullifiers as used.
    function setSessionManager(address sessionManager, bool allowed) external onlyOwner {
        sessionManagers[sessionManager] = allowed;
    }

    /// @notice Updates the active credential Merkle tree root.
    /// @param newRoot The new root hash of the active credential tree.
    function updateActiveRoot(bytes32 newRoot)
        external
        onlyIssuer
        whenNotPaused
    {
        activeRoot = newRoot;
        emit ActiveRootUpdated(newRoot);
    }

    /// @notice Updates the revoked-secret Merkle tree root.
    /// @param newRoot The new root hash of the revoked-secret tree.
    function updateRevokedSecretRoot(bytes32 newRoot)
        external
        onlyIssuer
        whenNotPaused
    {
        revokedSecretRoot = newRoot;
        emit RevokedSecretRootUpdated(newRoot);
    }

    /// @notice Marks a nullifier as used, preventing the associated credential from being used again.
    /// @param nullifier The nullifier hash to consume.
    function markNullifierUsed(bytes32 nullifier) external {
        if (!sessionManagers[msg.sender]) revert OnlySessionManager();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        usedNullifiers[nullifier] = true;
    }

    /// @notice Checks whether a nullifier has already been consumed.
    /// @param nullifier The nullifier hash to query.
    /// @return True if the nullifier has been used.
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
