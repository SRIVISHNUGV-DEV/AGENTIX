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

interface IAgentWallet {
    function initialize(address owner, address sessionManager, address entryPoint) external;
}

contract AgentWalletFactory is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using Clones for address;

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 indexed salt, address entryPoint);

    address public implementation;
    address public entryPoint;
    address public sessionManager;
    uint256 public walletCount;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address implementation_,
        address sessionManager_,
        address entryPoint_
    ) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        if (implementation_ == address(0)) revert InvalidImplementationError();
        if (sessionManager_ == address(0)) revert InvalidSessionManagerError();
        if (entryPoint_ == address(0)) revert InvalidEntryPointError();
        implementation = implementation_;
        sessionManager = sessionManager_;
        entryPoint = entryPoint_;
    }

    function createWallet(address owner) external returns (address wallet) {
        bytes32 salt = keccak256(abi.encode(owner, msg.sender, block.chainid, walletCount));
        walletCount++;
        return _createWallet(owner, salt);
    }

    function createWallet(address owner, bytes32 salt) external returns (address wallet) {
        return _createWallet(owner, salt);
    }

    function getAddress(bytes32 salt) external view returns (address wallet) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    function setImplementation(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementationError();
        implementation = newImplementation;
    }

    function setSessionManager(address newSessionManager) external onlyOwner {
        if (newSessionManager == address(0)) revert InvalidSessionManagerError();
        sessionManager = newSessionManager;
    }

    function setEntryPoint(address newEntryPoint) external onlyOwner {
        if (newEntryPoint == address(0)) revert InvalidEntryPointError();
        entryPoint = newEntryPoint;
    }

    function _createWallet(address owner, bytes32 salt) internal returns (address wallet) {
        if (owner == address(0)) revert InvalidOwnerError();
        wallet = implementation.predictDeterministicAddress(salt, address(this));

        if (wallet.code.length == 0) {
            wallet = implementation.cloneDeterministic(salt);
            IAgentWallet(wallet).initialize(owner, sessionManager, entryPoint);
        }

        emit WalletCreated(wallet, owner, salt, entryPoint);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
