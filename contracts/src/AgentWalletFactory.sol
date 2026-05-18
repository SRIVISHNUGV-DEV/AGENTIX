// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";

interface IAgentWallet {
    function initialize(address owner, address sessionManager, address entryPoint) external;
}

contract AgentWalletFactory {
    using Clones for address;

    event WalletCreated(
        address indexed wallet,
        address indexed owner,
        bytes32 indexed salt,
        address entryPoint
    );

    address public immutable implementation;
    address public immutable entryPoint;
    address public sessionManager;
    uint256 public walletCount;

    constructor(address _implementation, address _sessionManager, address _entryPoint) {
        require(_implementation != address(0), "Invalid implementation");
        require(_sessionManager != address(0), "Invalid session manager");
        require(_entryPoint != address(0), "Invalid entry point");

        implementation = _implementation;
        sessionManager = _sessionManager;
        entryPoint = _entryPoint;
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

    function _createWallet(address owner, bytes32 salt) internal returns (address wallet) {
        require(owner != address(0), "Invalid owner");
        wallet = implementation.predictDeterministicAddress(salt, address(this));

        if (wallet.code.length == 0) {
            wallet = implementation.cloneDeterministic(salt);
            IAgentWallet(wallet).initialize(owner, sessionManager, entryPoint);
        }

        emit WalletCreated(wallet, owner, salt, entryPoint);
    }
}
