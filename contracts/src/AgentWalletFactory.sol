// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";

interface IAgentWallet {
    function initialize(address owner, address sessionManager) external;
}

contract AgentWalletFactory {

    using Clones for address;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event WalletCreated(
        address indexed wallet,
        address indexed owner
    );

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable implementation;
    address public sessionManager;

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _implementation, address _sessionManager) {
        implementation = _implementation;
        sessionManager = _sessionManager;
    }

    /*//////////////////////////////////////////////////////////////
                        WALLET CREATION
    //////////////////////////////////////////////////////////////*/

    function createWallet(address owner)
        external
        returns (address wallet)
    {
        wallet = implementation.clone();

        IAgentWallet(wallet).initialize(
            owner,
            sessionManager
        );

        emit WalletCreated(wallet, owner);
    }

}
