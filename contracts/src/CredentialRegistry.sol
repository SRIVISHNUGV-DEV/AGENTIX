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
error NotIssuerOrOwner();

/// @title CredentialRegistry
/// @notice Manages Merkle roots for credential trees and nullifier tracking to prevent double-use.
/// @dev Upgradeable (UUPS). Issuers update roots; SessionManagers consume nullifiers.
///      ROOT CHANGES ARE TIMELOCKED (2 days, matching the codebase convention): issuers
///      propose, anyone (issuer or owner) may cancel while pending, and only after the
///      delay may an issuer accept. There is NO instant root update anymore — a single
///      compromised issuer key can no longer instantly DoS all new sessions (garbage root)
///      or un-revoke credentials. This is a BREAKING change from the previous instant
///      updateActiveRoot/updateRevokedSecretRoot API (removed in this change).
contract CredentialRegistry is Initializable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {

    error NoPendingRoot();
    error PendingRootActive();
    error TimelockNotReady();

    event ActiveRootUpdated(bytes32 indexed newRoot);
    event RevokedSecretRootUpdated(bytes32 indexed newRoot);
    event ActiveRootProposed(bytes32 indexed newRoot, uint256 activationTime);
    event ActiveRootUpdateCancelled(bytes32 indexed cancelledRoot);
    event RevokedSecretRootProposed(bytes32 indexed newRoot, uint256 activationTime);
    event RevokedSecretRootUpdateCancelled(bytes32 indexed cancelledRoot);

    mapping(address => bool) public issuers;
    mapping(address => bool) public sessionManagers;
    bytes32 public activeRoot;
    bytes32 public revokedSecretRoot;
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Pending active-root proposal awaiting the timelock.
    bytes32 public pendingActiveRoot;
    /// @notice Timestamp after which the pending active root may be accepted.
    uint256 public activeRootActivationTime;
    /// @notice Pending revoked-secret-root proposal awaiting the timelock.
    bytes32 public pendingRevokedSecretRoot;
    /// @notice Timestamp after which the pending revoked-secret root may be accepted.
    uint256 public revokedSecretRootActivationTime;

    uint256 public constant TIMELOCK_DELAY = 2 days;

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

    function proposeActiveRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
        if (newRoot == bytes32(0)) revert RootCannotBeZero();
        if (pendingActiveRoot != bytes32(0)) revert PendingRootActive();
        pendingActiveRoot = newRoot;
        activeRootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit ActiveRootProposed(newRoot, activeRootActivationTime);
    }

    /// @notice Activates the pending active root after the 2-day timelock.
    function acceptActiveRoot() external onlyIssuer whenNotPaused {
        if (pendingActiveRoot == bytes32(0)) revert NoPendingRoot();
        if (block.timestamp < activeRootActivationTime) revert TimelockNotReady();
        activeRoot = pendingActiveRoot;
        pendingActiveRoot = bytes32(0);
        activeRootActivationTime = 0;
        emit ActiveRootUpdated(activeRoot);
    }

    /// @notice Cancels a pending active-root proposal. Issuer or owner; no pause guard
    ///         (cancellation is a defensive action and must work during an incident).
    function cancelActiveRoot() external {
        if (!issuers[msg.sender] && msg.sender != owner()) revert NotIssuerOrOwner();
        if (pendingActiveRoot == bytes32(0)) revert NoPendingRoot();
        bytes32 cancelled = pendingActiveRoot;
        pendingActiveRoot = bytes32(0);
        activeRootActivationTime = 0;
        emit ActiveRootUpdateCancelled(cancelled);
    }

    function proposeRevokedSecretRoot(bytes32 newRoot) external onlyIssuer whenNotPaused {
        if (newRoot == bytes32(0)) revert RootCannotBeZero();
        if (pendingRevokedSecretRoot != bytes32(0)) revert PendingRootActive();
        pendingRevokedSecretRoot = newRoot;
        revokedSecretRootActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit RevokedSecretRootProposed(newRoot, revokedSecretRootActivationTime);
    }

    /// @notice Activates the pending revoked-secret root after the 2-day timelock.
    function acceptRevokedSecretRoot() external onlyIssuer whenNotPaused {
        if (pendingRevokedSecretRoot == bytes32(0)) revert NoPendingRoot();
        if (block.timestamp < revokedSecretRootActivationTime) revert TimelockNotReady();
        revokedSecretRoot = pendingRevokedSecretRoot;
        pendingRevokedSecretRoot = bytes32(0);
        revokedSecretRootActivationTime = 0;
        emit RevokedSecretRootUpdated(revokedSecretRoot);
    }

    /// @notice Cancels a pending revoked-secret-root proposal. Issuer or owner; no pause guard.
    function cancelRevokedSecretRoot() external {
        if (!issuers[msg.sender] && msg.sender != owner()) revert NotIssuerOrOwner();
        if (pendingRevokedSecretRoot == bytes32(0)) revert NoPendingRoot();
        bytes32 cancelled = pendingRevokedSecretRoot;
        pendingRevokedSecretRoot = bytes32(0);
        revokedSecretRootActivationTime = 0;
        emit RevokedSecretRootUpdateCancelled(cancelled);
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

    uint256[46] private __gap;
}
