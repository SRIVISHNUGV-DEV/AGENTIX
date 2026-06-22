// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error InvalidImplementationError();
error InvalidSessionManagerError();
error InvalidEntryPointError();
error InvalidOwnerError();
error WalletAlreadyExistsWithDifferentOwner();

/// @notice Minimal interface for AgentWallet initialization.
interface IAgentWallet {
    function initialize(address owner, address sessionManager, address entryPoint) external;
    function owner() external view returns (address);
}

/// @title AgentWalletFactory
/// @notice Deterministic factory for creating AgentWallet clones. Each wallet is a minimal proxy
///         (EIP-1167 clone) of a shared implementation, initialised with the wallet owner, the
///         canonical SessionManager, and the ERC-4337 EntryPoint.
/// @dev Upgradeable (UUPS). Wallets are created with CREATE2 for deterministic addresses.
contract AgentWalletFactory is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using Clones for address;

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 indexed salt, address entryPoint);

    /// @notice The AgentWallet implementation contract that clones are based on.
    address public implementation;
    /// @notice The ERC-4337 EntryPoint contract assigned to all new wallets.
    address public entryPoint;
    /// @notice The SessionManager contract assigned to all new wallets.
    address public sessionManager;
    /// @notice Counter used to generate unique salts for auto-generated wallets.
    uint256 public walletCount;
    /// @notice Registry of all wallets created by this factory.
    mapping(address => bool) public agentWallets;

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
        if (sessionManager_ == address(0)) revert InvalidSessionManagerError();
        if (entryPoint_ == address(0)) revert InvalidEntryPointError();
        implementation = implementation_;
        sessionManager = sessionManager_;
        entryPoint = entryPoint_;
    }

    /// @notice Creates a new wallet for the given owner using an auto-generated salt.
    /// @param owner The wallet owner address.
    /// @return wallet The address of the newly created (or existing) wallet.
    function createWallet(address owner) external returns (address wallet) {
        bytes32 salt = keccak256(abi.encode(owner, msg.sender, block.chainid, walletCount));
        walletCount++;
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

    /// @notice Updates the AgentWallet implementation for future clones.
    /// @param newImplementation The new implementation contract address.
    function setImplementation(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementationError();
        implementation = newImplementation;
    }

    /// @notice Updates the SessionManager for future wallet creation.
    /// @param newSessionManager The new SessionManager contract address.
    function setSessionManager(address newSessionManager) external onlyOwner {
        if (newSessionManager == address(0)) revert InvalidSessionManagerError();
        sessionManager = newSessionManager;
    }

    /// @notice Updates the EntryPoint for future wallet creation.
    /// @param newEntryPoint The new EntryPoint contract address.
    function setEntryPoint(address newEntryPoint) external onlyOwner {
        if (newEntryPoint == address(0)) revert InvalidEntryPointError();
        entryPoint = newEntryPoint;
    }

    /// @notice Checks whether an address is an AgentWallet created by this factory.
    /// @param wallet The address to check.
    /// @return True if the address is a known AgentWallet.
    function isAgentWallet(address wallet) external view returns (bool) {
        return agentWallets[wallet];
    }

    /// @dev Internal wallet creation logic. Deploys a deterministic clone and initializes it.
    ///      Reverts if a wallet at that address belongs to a different owner.
    function _createWallet(address owner, bytes32 salt) internal returns (address wallet) {
        if (owner == address(0)) revert InvalidOwnerError();
        wallet = implementation.predictDeterministicAddress(salt, address(this));

        if (wallet.code.length == 0) {
            wallet = implementation.cloneDeterministic(salt);
            IAgentWallet(wallet).initialize(owner, sessionManager, entryPoint);
            agentWallets[wallet] = true;
            emit WalletCreated(wallet, owner, salt, entryPoint);
        } else if (IAgentWallet(wallet).owner() != owner) {
            revert WalletAlreadyExistsWithDifferentOwner();
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
