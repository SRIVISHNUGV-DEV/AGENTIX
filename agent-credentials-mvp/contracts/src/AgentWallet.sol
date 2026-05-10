// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

interface ISessionManager {
    function validateSession(
        bytes32 sessionId,
        address signer,
        uint256 value
    ) external returns (bool);
}

contract AgentWallet is ReentrancyGuard {
    using ECDSA for bytes32;

    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant EXECUTE_BATCH_SELECTOR = bytes4(keccak256("executeBatch(address[],uint256[],bytes[])"));

    event WalletInitialized(address indexed owner, address indexed sessionManager, address indexed entryPoint);
    event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes data);
    event BatchExecutionPerformed(address indexed caller, uint256 callCount, uint256 totalValue);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event WhiteListUpdated(address indexed party, bool status);
    event UserOperationValidated(bytes32 indexed userOpHash, address indexed signer, bytes32 indexed sessionId, uint256 value);
    event EntryPointDepositAdded(uint256 amount, uint256 newBalance);
    event EntryPointWithdrawal(address indexed recipient, uint256 amount);

    address public owner;
    address public sessionManager;
    address public entryPoint;

    mapping(address => bool) public whiteListedParties;

    bool private initialized;

    constructor() {
        initialized = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Not entry point");
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        require(msg.sender == owner || msg.sender == entryPoint, "Not authorized");
        _;
    }

    modifier onlyInitialized() {
        require(initialized, "Not initialized");
        _;
    }

    function initialize(
        address _owner,
        address _sessionManager,
        address _entryPoint
    ) external {
        require(!initialized, "Already initialized");
        require(_owner != address(0), "Invalid owner");
        require(_sessionManager != address(0), "Invalid session manager");
        require(_entryPoint != address(0), "Invalid entry point");

        owner = _owner;
        sessionManager = _sessionManager;
        entryPoint = _entryPoint;

        initialized = true;
        emit WalletInitialized(_owner, _sessionManager, _entryPoint);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint onlyInitialized returns (uint256 validationData) {
        (uint256 spendValue, bytes32 sessionId, address signer) = _validateUserOperation(userOp, userOpHash);

        if (missingAccountFunds > 0) {
            (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
            require(success, "Funding failed");
        }

        emit UserOperationValidated(userOpHash, signer, sessionId, spendValue);
        return 0;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
        require(whiteListedParties[target], "Not white listed");

        (bool success,) = target.call{value: value}(data);
        require(success, "Execution failed");

        emit ExecutionPerformed(msg.sender, target, value, data);
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
        require(targets.length == values.length && values.length == data.length, "Length mismatch");

        uint256 totalValue;
        for (uint256 i = 0; i < targets.length; i++) {
            require(whiteListedParties[targets[i]], "Not white listed");
            totalValue += values[i];

            (bool success,) = targets[i].call{value: values[i]}(data[i]);
            require(success, "Call failed");
        }

        emit BatchExecutionPerformed(msg.sender, targets.length, totalValue);
    }

    function addDeposit() external payable onlyInitialized {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
        emit EntryPointDepositAdded(msg.value, IEntryPoint(entryPoint).balanceOf(address(this)));
    }

    function getDeposit() external view returns (uint256) {
        return IEntryPoint(entryPoint).balanceOf(address(this));
    }

    function withdrawDepositTo(address payable recipient, uint256 amount) external onlyOwner onlyInitialized {
        require(recipient != address(0), "Invalid recipient");
        IEntryPoint(entryPoint).withdrawTo(recipient, amount);
        emit EntryPointWithdrawal(recipient, amount);
    }

    function changeOwner(address newOwner) external onlyOwner onlyInitialized {
        require(newOwner != address(0), "Invalid owner");

        address oldOwner = owner;
        owner = newOwner;
        emit OwnerChanged(oldOwner, newOwner);
    }

    receive() external payable {}

    function checkBalance() external view returns (uint128) {
        return uint128(address(this).balance);
    }

    function setWhiteListedParty(address party, bool status) external onlyOwner onlyInitialized {
        whiteListedParties[party] = status;
        emit WhiteListUpdated(party, status);
    }

    function _validateUserOperation(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256 spendValue, bytes32 sessionId, address signer) {
        spendValue = _extractSpendValue(userOp.callData);

        bytes32 digest = ECDSA.toEthSignedMessageHash(userOpHash);
        if (userOp.signature.length == 65) {
            signer = digest.recover(userOp.signature);
            require(signer == owner, "Invalid owner signature");
            return (spendValue, bytes32(0), signer);
        }

        bytes memory sessionSignature;
        (sessionId, sessionSignature) = abi.decode(userOp.signature, (bytes32, bytes));
        signer = digest.recover(sessionSignature);

        bool valid = ISessionManager(sessionManager).validateSession(sessionId, signer, spendValue);
        require(valid, "Invalid session");
    }

    function _extractSpendValue(bytes calldata callData) internal view returns (uint256 totalValue) {
        bytes4 selector = _selector(callData);

        if (selector == EXECUTE_SELECTOR) {
            (, uint256 value,) = abi.decode(callData[4:], (address, uint256, bytes));
            _assertWhitelistedCall(callData[4:]);
            return value;
        }

        if (selector == EXECUTE_BATCH_SELECTOR) {
            (address[] memory targets, uint256[] memory values,) = abi.decode(callData[4:], (address[], uint256[], bytes[]));
            require(targets.length == values.length, "Length mismatch");

            for (uint256 i = 0; i < targets.length; i++) {
                require(whiteListedParties[targets[i]], "Not white listed");
                totalValue += values[i];
            }

            return totalValue;
        }

        revert("Unsupported callData");
    }

    function _assertWhitelistedCall(bytes calldata encodedArgs) internal view {
        (address target,,) = abi.decode(encodedArgs, (address, uint256, bytes));
        require(whiteListedParties[target], "Not white listed");
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        require(data.length >= 4, "Invalid callData");
        assembly {
            selector := calldataload(data.offset)
        }
    }
}
