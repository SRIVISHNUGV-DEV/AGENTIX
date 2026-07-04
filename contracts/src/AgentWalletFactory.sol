// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error InvalidImplementationError();
error FactoryInvalidSessionManagerError();
error FactoryInvalidEntryPointError();
error FactoryInvalidOwnerError();
error WalletAlreadyExistsWithDifferentOwner();
error FactoryTimelockNotReadyError();
error FactoryTimelockActiveError();
error InvalidAgentIdentityError();

/// @notice Minimal interface for AgentWallet initialization.
interface IAgentWallet {
    function initialize(address owner, address sessionManager, address entryPoint) external;
    function owner() external view returns (address);
}

/// @notice Minimal interface for AgentIdentity registration.
interface IAgentIdentity {
    function registerIdentity(address wallet) external returns (uint256);
}

/// @title AgentWalletFactory
/// @notice Deterministic factory for creating AgentWallet clones. Each wallet is a minimal proxy
///         (EIP-1167 clone) of a shared implementation, initialised with the wallet owner, the
///         canonical SessionManager, and the ERC-4337 EntryPoint.
/// @dev Upgradeable (UUPS). Wallets are created with CREATE2 for deterministic addresses.
contract AgentWalletFactory is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using Clones for address;

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 indexed salt, address entryPoint);
    event ImplementationProposed(address indexed previous, address indexed next, uint256 activationTime);
    event ImplementationUpdated(address indexed oldImpl, address indexed newImpl);
    event SessionManagerProposed(address indexed previous, address indexed next, uint256 activationTime);
    event SessionManagerUpdated(address indexed oldSM, address indexed newSM);
    event EntryPointProposed(address indexed previous, address indexed next, uint256 activationTime);
    event EntryPointUpdated(address indexed oldEP, address indexed newEP);

    uint256 public constant TIMELOCK_DELAY = 0 seconds;

    /// @notice The AgentWallet implementation contract that clones are based on.
    address public implementation;
    /// @notice The ERC-4337 EntryPoint contract assigned to all new wallets.
    address public entryPoint;
    /// @notice The SessionManager contract assigned to all new wallets.
    address public sessionManager;
    /// @notice The AgentIdentity registry contract.
    address public agentIdentity;
    /// @notice Counter used to generate unique salts for auto-generated wallets.
    uint256 public walletCount;
    /// @notice Registry of all wallets created by this factory.
    mapping(address => bool) public agentWallets;

    /// @notice Pending implementation address awaiting timelock.
    address public pendingImplementation;
    /// @notice Timestamp when pendingImplementation can be activated.
    uint256 public implementationActivationTime;

    /// @notice Pending SessionManager address awaiting timelock.
    address public pendingSessionManager;
    /// @notice Timestamp when pendingSessionManager can be activated.
    uint256 public sessionManagerActivationTime;

    /// @notice Pending EntryPoint address awaiting timelock.
    address public pendingEntryPoint;
    /// @notice Timestamp when pendingEntryPoint can be activated.
    uint256 public entryPointActivationTime;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the factory with implementation, session manager, and entry point.
    /// @param implementation_ The AgentWallet implementation contract to clone.
    /// @param sessionManager_ The SessionManager contract address.
    /// @param entryPoint_ The ERC-4337 EntryPoint contract address.
    function initialize(
        address implementation_,
        address sessionManager_,
        address entryPoint_
    ) public initializer {
        __Ownable_init(msg.sender);
        if (implementation_ == address(0)) revert InvalidImplementationError();
        if (sessionManager_ == address(0)) revert FactoryInvalidSessionManagerError();
        if (entryPoint_ == address(0)) revert FactoryInvalidEntryPointError();
        implementation = implementation_;
        sessionManager = sessionManager_;
        entryPoint = entryPoint_;
    }

    /// @notice Creates a new wallet for the given owner using an auto-generated salt.
    /// @param owner The wallet owner address.
    /// @return wallet The address of the newly created (or existing) wallet.
    function createWallet(address owner) external returns (address wallet) {
        bytes32 salt = keccak256(abi.encode(owner, block.chainid, walletCount));
        return _createWallet(owner, salt);
    }

    /// @notice Creates a new wallet for the given owner with a user-specified salt.
    /// @param owner The wallet owner address.
    /// @param salt The CREATE2 salt for deterministic address generation.
    /// @return wallet The address of the newly created (or existing) wallet.
    function createWallet(address owner, bytes32 salt) external returns (address wallet) {
        return _createWallet(owner, salt);
    }

    /// @notice Predicts the deterministic address of a wallet for a given salt.
    /// @param salt The CREATE2 salt.
    /// @return wallet The predicted wallet address.
    function getAddress(bytes32 salt) external view returns (address wallet) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    /// @notice Proposes a new AgentWallet implementation with a 24-hour timelock.
    /// @param newImplementation The proposed new implementation contract address.
    function proposeImplementation(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementationError();
        if (pendingImplementation != address(0)) revert FactoryTimelockActiveError();
        pendingImplementation = newImplementation;
        implementationActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit ImplementationProposed(implementation, newImplementation, implementationActivationTime);
    }

    /// @notice Activates the pending implementation after the timelock has elapsed.
    function acceptImplementation() external onlyOwner {
        if (pendingImplementation == address(0)) revert InvalidImplementationError();
        if (block.timestamp < implementationActivationTime) revert FactoryTimelockNotReadyError();
        address oldImpl = implementation;
        implementation = pendingImplementation;
        pendingImplementation = address(0);
        implementationActivationTime = 0;
        emit ImplementationUpdated(oldImpl, implementation);
    }

    /// @notice Proposes a new SessionManager with a 24-hour timelock.
    /// @param newSessionManager The proposed new SessionManager contract address.
    function proposeSessionManager(address newSessionManager) external onlyOwner {
        if (newSessionManager == address(0)) revert FactoryInvalidSessionManagerError();
        if (pendingSessionManager != address(0)) revert FactoryTimelockActiveError();
        pendingSessionManager = newSessionManager;
        sessionManagerActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit SessionManagerProposed(sessionManager, newSessionManager, sessionManagerActivationTime);
    }

    /// @notice Activates the pending SessionManager after the timelock has elapsed.
    function acceptSessionManager() external onlyOwner {
        if (pendingSessionManager == address(0)) revert FactoryInvalidSessionManagerError();
        if (block.timestamp < sessionManagerActivationTime) revert FactoryTimelockNotReadyError();
        address oldSM = sessionManager;
        sessionManager = pendingSessionManager;
        pendingSessionManager = address(0);
        sessionManagerActivationTime = 0;
        emit SessionManagerUpdated(oldSM, sessionManager);
    }

    /// @notice Proposes a new EntryPoint with a 24-hour timelock.
    /// @param newEntryPoint The proposed new EntryPoint contract address.
    function proposeEntryPoint(address newEntryPoint) external onlyOwner {
        if (newEntryPoint == address(0)) revert FactoryInvalidEntryPointError();
        if (pendingEntryPoint != address(0)) revert FactoryTimelockActiveError();
        pendingEntryPoint = newEntryPoint;
        entryPointActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit EntryPointProposed(entryPoint, newEntryPoint, entryPointActivationTime);
    }

    /// @notice Activates the pending EntryPoint after the timelock has elapsed.
    function acceptEntryPoint() external onlyOwner {
        if (pendingEntryPoint == address(0)) revert FactoryInvalidEntryPointError();
        if (block.timestamp < entryPointActivationTime) revert FactoryTimelockNotReadyError();
        address oldEP = entryPoint;
        entryPoint = pendingEntryPoint;
        pendingEntryPoint = address(0);
        entryPointActivationTime = 0;
        emit EntryPointUpdated(oldEP, entryPoint);
    }

    /// @notice Checks whether an address is an AgentWallet created by this factory.
    /// @param wallet The address to check.
    /// @return True if the address is a known AgentWallet.
    function isAgentWallet(address wallet) external view returns (bool) {
        return agentWallets[wallet];
    }

    /// @notice Sets the AgentIdentity registry contract. Only callable by the owner.
    /// @param agentIdentity_ The AgentIdentity contract address.
    function setAgentIdentity(address agentIdentity_) external onlyOwner {
        if (agentIdentity_ == address(0)) revert InvalidAgentIdentityError();
        agentIdentity = agentIdentity_;
    }

    /// @dev Internal wallet creation logic. Deploys a deterministic clone and initializes it.
    ///      Reverts if a wallet at that address belongs to a different owner.
    function _createWallet(address owner, bytes32 salt) internal returns (address wallet) {
        if (owner == address(0)) revert FactoryInvalidOwnerError();
        wallet = implementation.predictDeterministicAddress(salt, address(this));

        if (wallet.code.length == 0) {
            wallet = implementation.cloneDeterministic(salt);
            IAgentWallet(wallet).initialize(owner, sessionManager, entryPoint);
            agentWallets[wallet] = true;
            walletCount++;
            if (agentIdentity != address(0)) {
                IAgentIdentity(agentIdentity).registerIdentity(wallet);
            }
            emit WalletCreated(wallet, owner, salt, entryPoint);
        } else if (IAgentWallet(wallet).owner() != owner) {
            revert WalletAlreadyExistsWithDifferentOwner();
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
