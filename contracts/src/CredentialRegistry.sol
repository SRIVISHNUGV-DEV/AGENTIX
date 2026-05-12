// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract CredentialRegistry is ReentrancyGuard {

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event CredentialIssued(
        address indexed issuer,
        uint64 indexed agentId,
        bytes32 indexed commitment,
        uint64 expiry
    );

    event CredentialRevoked(
        address indexed issuer,
        bytes32 indexed secretHash
    );

    event ActiveRootUpdated(bytes32 indexed newRoot);
    event RevokedSecretRootUpdated(bytes32 indexed newRoot);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public owner;

    mapping(address => bool) public issuers;
    mapping(address => bool) public sessionManagers;

    bytes32 public activeRoot;
    bytes32 public revokedSecretRoot;

    mapping(bytes32 => bool) public usedNullifiers;

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyIssuer() {
        require(issuers[msg.sender], "Only issuer");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor() {
        owner = msg.sender;
        issuers[msg.sender] = true;
    }

    /*//////////////////////////////////////////////////////////////
                        ISSUER MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    function addIssuer(address issuer) external onlyOwner {
        issuers[issuer] = true;
    }

    function removeIssuer(address issuer) external onlyOwner {
        issuers[issuer] = false;
    }

    function setSessionManager(address sessionManager, bool allowed)
        external
        onlyOwner
    {
        sessionManagers[sessionManager] = allowed;
    }

    /*//////////////////////////////////////////////////////////////
                        ROOT MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    function updateActiveRoot(bytes32 newRoot)
        external
        onlyIssuer
        nonReentrant
    {
        activeRoot = newRoot;
        emit ActiveRootUpdated(newRoot);
    }

    function updateRevokedSecretRoot(bytes32 newRoot)
        external
        onlyIssuer
        nonReentrant
    {
        revokedSecretRoot = newRoot;
        emit RevokedSecretRootUpdated(newRoot);
    }

    /*//////////////////////////////////////////////////////////////
                        NULLIFIER MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    function markNullifierUsed(bytes32 nullifier) external {
        require(sessionManagers[msg.sender], "Only session manager");
        require(!usedNullifiers[nullifier], "Nullifier used");
        usedNullifiers[nullifier] = true;
    }

    function isNullifierUsed(bytes32 nullifier)
        external
        view
        returns (bool)
    {
        return usedNullifiers[nullifier];
    }
}
