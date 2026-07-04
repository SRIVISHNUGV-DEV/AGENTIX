// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error OnlyIssuer();
error NullifierUsed();
error OnlySessionManager();
error RootCannotBeZero();

/// @title CredentialRegistry
/// @notice Manages Merkle roots for credential trees and nullifier tracking to prevent double-use.
/// @dev Upgradeable (UUPS). Issuers update roots; SessionManagers consume nullifiers.
contract CredentialRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    event ActiveRootUpdated(bytes32 indexed newRoot);
    event RevokedSecretRootUpdated(bytes32 indexed newRoot);

    mapping(address => bool) public issuers;
    mapping(address => bool) public sessionManagers;
    bytes32 public activeRoot;
    bytes32 public revokedSecretRoot;
    mapping(bytes32 => bool) public usedNullifiers;

    modifier onlyIssuer() {
        if (!issuers[msg.sender]) revert OnlyIssuer();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        issuers[owner_] = true;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function addIssuer(address issuer) external onlyOwner { issuers[issuer] = true; }
    function removeIssuer(address issuer) external onlyOwner { issuers[issuer] = false; }
    function setSessionManager(address sessionManager, bool allowed) external onlyOwner { sessionManagers[sessionManager] = allowed; }

    function updateActiveRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
        if (newRoot == bytes32(0)) revert RootCannotBeZero();
        activeRoot = newRoot;
        emit ActiveRootUpdated(newRoot);
    }

    function updateRevokedSecretRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
        if (newRoot == bytes32(0)) revert RootCannotBeZero();
        revokedSecretRoot = newRoot;
        emit RevokedSecretRootUpdated(newRoot);
    }

    function markNullifierUsed(bytes32 nullifier) external {
        if (!sessionManagers[msg.sender]) revert OnlySessionManager();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        usedNullifiers[nullifier] = true;
    }

    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
