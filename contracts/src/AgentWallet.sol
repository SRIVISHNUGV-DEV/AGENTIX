// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface ISessionManager {
    function validateSession(
        bytes32 sessionId,
        address signer,
        uint256 value
    ) external returns (bool);
}

contract AgentWallet is ReentrancyGuard {

    using ECDSA for bytes32;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event WalletInitialized(address indexed owner, address indexed sessionManager);
    event ExecutionPerformed(bytes32 indexed sessionId, address indexed target, uint256 value, bytes data);
    event BatchExecutionPerformed(bytes32 indexed sessionId, uint256 callCount, uint256 totalValue);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event WhiteListUpdated(address indexed party, bool status);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public owner;
    address public sessionManager;
    mapping(address => bool) public whiteListedParties;

    uint256 public nonce;

    bool private initialized;

    constructor() {
        initialized = true;
    }

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyInitialized() {
        require(initialized, "Not initialized");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            INITIALIZATION
    //////////////////////////////////////////////////////////////*/

    function initialize(
        address _owner,
        address _sessionManager
    ) external {

        require(!initialized, "Already initialized");

        require(_owner != address(0), "Invalid owner");
        require(_sessionManager != address(0), "Invalid session manager");

        owner = _owner;
        sessionManager = _sessionManager;

        initialized = true;
        emit WalletInitialized(_owner, _sessionManager);
    }

    /*//////////////////////////////////////////////////////////////
                        EXECUTE SINGLE ACTION
    //////////////////////////////////////////////////////////////*/

    function execute(
        bytes32 sessionId,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata signature
    ) external nonReentrant onlyInitialized {

        require(whiteListedParties[target], "Not white listed");
        bytes32 hash = ECDSA.toEthSignedMessageHash(
            keccak256(
                abi.encode(
                block.chainid,
                address(this),
                sessionId,
                target,
                value,
                data,
                nonce
                )
            )
        );

        address signer = hash.recover(signature);

        bool valid = ISessionManager(sessionManager).validateSession(sessionId, signer, value);

        require(valid, "Invalid session");

        nonce++;

        (bool success,) = target.call{value:value}(data);
        require(success, "Execution failed");
        emit ExecutionPerformed(sessionId, target, value, data);
    }

    /*//////////////////////////////////////////////////////////////
                        EXECUTE BATCH ACTIONS
    //////////////////////////////////////////////////////////////*/

    function executeBatch(
        bytes32 sessionId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data,
        bytes calldata signature
    ) external nonReentrant onlyInitialized {

        require(
            targets.length == values.length && 
            values.length == data.length,
            "Length mismatch"
        );

        bytes32 hash = ECDSA.toEthSignedMessageHash(
        keccak256(
            abi.encode(
                block.chainid,
                address(this),
                sessionId,
                targets,
                values,
                data,
                nonce
            )
        )
    );

        address signer = hash.recover(signature);

        uint256 totalValue;

        for(uint256 i=0;i<values.length;i++){
            totalValue += values[i];
        }

        bool valid = ISessionManager(sessionManager).validateSession(sessionId, signer, totalValue);

        require(valid,"Invalid session");

        nonce++;

        for(uint256 i=0;i<targets.length;i++){
            require(whiteListedParties[targets[i]], "Not white listed");
            (bool success,) = targets[i].call{value:values[i]}(data[i]);

            require(success,"Call failed");
        }

        emit BatchExecutionPerformed(sessionId, targets.length, totalValue);
    }

    /*//////////////////////////////////////////////////////////////
                            OWNER RECOVERY
    //////////////////////////////////////////////////////////////*/

    function changeOwner(address newOwner)
        external
        onlyOwner
        onlyInitialized
    {
        require(newOwner != address(0), "Invalid owner");

        address oldOwner = owner;
        owner = newOwner;
        emit OwnerChanged(oldOwner, newOwner);
    }

    /*//////////////////////////////////////////////////////////////
                            RECEIVE ETH
    //////////////////////////////////////////////////////////////*/

    receive() external payable {}

    function checkBalance() external view returns (uint128) {
        return uint128(address(this).balance);
    }

    function setWhiteListedParty(address party, bool status) external onlyOwner onlyInitialized {
        whiteListedParties[party] = status;
        emit WhiteListUpdated(party, status);
    }
    
}
