// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

error NotOwnerError();
error NotEntryPointError();
error NotAuthorizedError();
error AlreadyInitializedError();
error InvalidOwnerError();
error InvalidSessionManagerError();
error InvalidEntryPointError();
error NotWhiteListedError();
error ExecutionFailedError();
error CallFailedError();
error LengthMismatchError();
error InvalidRecipientError();
error FundingFailedError();
error InvalidCallDataError();
error UnsupportedCallDataError();
error InvalidOwnerSignatureError();
error LightweightSessionValidationFailedError();
error SessionValidationFailedError();

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
    function validateSession(bytes32 sessionId, address signer, uint256 value) external returns (bool);
    function validateLightweightSession(bytes32 sessionId, address signer, uint256 value) external returns (bool);
}

contract AgentWallet is ReentrancyGuard {
    using ECDSA for bytes32;

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32 message) {
        assembly {
            mstore(0x00, "\x19Ethereum Signed Message:\n32")
            mstore(0x1c, hash)
            message := keccak256(0x00, 0x3c)
        }
    }

    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant EXECUTE_BATCH_SELECTOR = bytes4(keccak256("executeBatch(address[],uint256[],bytes[])"));

    event WalletInitialized(address indexed owner, address indexed sessionManager, address indexed entryPoint);
    event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes32 dataHash);
    event BatchExecutionPerformed(address indexed caller, uint256 callCount, uint256 totalValue);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event WhiteListUpdated(address indexed party, bool status);
    event UserOperationValidated(bytes32 indexed userOpHash, address indexed signer, bytes32 indexed sessionId, uint256 value);
    event EntryPointDepositAdded(uint256 amount, uint256 newBalance);
    event EntryPointWithdrawal(address indexed recipient, uint256 amount);

    address public owner;
    address public pendingOwner;
    address public sessionManager;
    address public entryPoint;

    mapping(address => bool) public whiteListedParties;

    bool private initialized;

    constructor() {
        initialized = true;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwnerError();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPointError();
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        if (msg.sender != owner && msg.sender != entryPoint) revert NotAuthorizedError();
        _;
    }

    modifier onlyInitialized() {
        if (!initialized) revert AlreadyInitializedError();
        _;
    }

    function initialize(
        address _owner,
        address _sessionManager,
        address _entryPoint
    ) external {
        if (initialized) revert AlreadyInitializedError();
        if (_owner == address(0)) revert InvalidOwnerError();
        if (_sessionManager == address(0)) revert InvalidSessionManagerError();
        if (_entryPoint == address(0)) revert InvalidEntryPointError();

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
            if (!success) revert FundingFailedError();
        }

        emit UserOperationValidated(userOpHash, signer, sessionId, spendValue);
        return 0;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
        if (!whiteListedParties[target]) revert NotWhiteListedError();

        (bool success,) = target.call{value: value}(data);
        if (!success) revert ExecutionFailedError();

        emit ExecutionPerformed(msg.sender, target, value, keccak256(data));
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
        if (targets.length != values.length || values.length != data.length) revert LengthMismatchError();

        uint256 totalValue;
        for (uint256 i = 0; i < targets.length; i++) {
            if (!whiteListedParties[targets[i]]) revert NotWhiteListedError();
            totalValue += values[i];

            (bool success,) = targets[i].call{value: values[i]}(data[i]);
            if (!success) revert CallFailedError();
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
        if (recipient == address(0)) revert InvalidRecipientError();
        IEntryPoint(entryPoint).withdrawTo(recipient, amount);
        emit EntryPointWithdrawal(recipient, amount);
    }

    function changeOwner(address newOwner) external onlyOwner onlyInitialized {
        if (newOwner == address(0)) revert InvalidOwnerError();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external onlyInitialized {
        if (msg.sender != pendingOwner) revert NotAuthorizedError();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerChanged(oldOwner, msg.sender);
    }

    receive() external payable {}

    function checkBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function setWhiteListedParty(address party, bool status) external onlyOwner onlyInitialized {
        whiteListedParties[party] = status;
        emit WhiteListUpdated(party, status);
    }

    function setWhiteListedPartyBatch(address[] calldata parties, bool[] calldata statuses) external onlyOwner onlyInitialized {
        if (parties.length != statuses.length) revert LengthMismatchError();
        for (uint256 i = 0; i < parties.length; i++) {
            whiteListedParties[parties[i]] = statuses[i];
            emit WhiteListUpdated(parties[i], statuses[i]);
        }
    }

    function _validateUserOperation(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256 spendValue, bytes32 sessionId, address signer) {
        spendValue = _extractSpendValue(userOp.callData);

        bytes32 digest = _toEthSignedMessageHash(userOpHash);

        if (userOp.signature.length == 65) {
            signer = digest.recover(userOp.signature);
            if (signer != owner) revert InvalidOwnerSignatureError();
            return (spendValue, bytes32(0), signer);
        }

        bytes memory sessionSignature;
        (sessionId, sessionSignature) = abi.decode(userOp.signature, (bytes32, bytes));
        signer = digest.recover(sessionSignature);

        try ISessionManager(sessionManager).validateLightweightSession(
            sessionId, signer, spendValue
        ) returns (bool valid) {
            if (!valid) revert LightweightSessionValidationFailedError();
        } catch {
            bool valid = ISessionManager(sessionManager).validateSession(
                sessionId, signer, spendValue
            );
            if (!valid) revert SessionValidationFailedError();
        }
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
            if (targets.length != values.length) revert LengthMismatchError();

            for (uint256 i = 0; i < targets.length; i++) {
                if (!whiteListedParties[targets[i]]) revert NotWhiteListedError();
                totalValue += values[i];
            }

            return totalValue;
        }

        revert UnsupportedCallDataError();
    }

    function _assertWhitelistedCall(bytes calldata encodedArgs) internal view {
        (address target,,) = abi.decode(encodedArgs, (address, uint256, bytes));
        if (!whiteListedParties[target]) revert NotWhiteListedError();
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) revert InvalidCallDataError();
        assembly {
            selector := calldataload(data.offset)
        }
    }
}
