// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1820Registry.sol";

error NotOwnerError();
error NotEntryPointError();
error NotAuthorizedError();
error AlreadyInitializedError();
error NotInitializedError();
error InvalidOwnerError();
error InvalidSessionManagerError();
error InvalidEntryPointError();
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
error OwnershipTransferPendingError();
error BatchTooLargeError();
error BatchNotAllowedForSessionError();
error TimelockNotReadyError();
error TimelockActiveError();

/// @notice ERC-4337 UserOperation struct for account abstraction.
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

/// @notice Interface for the ERC-4337 EntryPoint contract.
interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Interface for the SessionManager contract used to validate session-based operations.
interface ISessionManager {
    function validateSession(bytes32 sessionId, address signer, uint256 value, address target) external returns (bool);
    function validateLightweightSession(bytes32 sessionId, address signer, uint256 value, address target) external returns (bool);
    function getSessionType(bytes32 sessionId) external view returns (uint8);
}

/// @title AgentWallet
/// @notice ERC-4337 compatible smart contract wallet for AI agents. Supports owner-controlled and
///         session-based execution via the EntryPoint. Delegates all authorization to SessionManager.
/// @dev Non-upgradeable (constructed via factory clones). Uses 2FA-style ownership transfer.
///      Replay protection is NOT implemented here — SessionManager owns nullifier validation.
contract AgentWallet is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant EXECUTE_BATCH_SELECTOR = bytes4(keccak256("executeBatch(address[],uint256[],bytes[])"));

    uint256 public constant MAX_BATCH_SIZE = 20;
    uint256 public constant TIMELOCK_DELAY = 2 days;

    address private constant ERC1820_REGISTRY = 0x1820a4b7618BD7140785a44aF1a4f87C3332006C;
    bytes32 private constant ERC777_TOKENS_RECIPIENT_HASH = keccak256("ERC777TokensRecipient");

    event WalletInitialized(address indexed owner, address indexed sessionManager, address indexed entryPoint);
    event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes32 dataHash);
    event BatchExecutionPerformed(address indexed caller, uint256 callCount, uint256 totalValue);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event UserOperationValidated(bytes32 indexed userOpHash, address indexed signer, bytes32 indexed sessionId, uint256 value);
    event EntryPointDepositAdded(uint256 amount, uint256 newBalance);
    event EntryPointWithdrawal(address indexed recipient, uint256 amount);
    event SessionManagerProposed(address indexed previousSessionManager, address indexed newSessionManager, uint256 activationTime);
    event SessionManagerUpdated(address indexed oldSessionManager, address indexed newSessionManager);
    event EntryPointProposed(address indexed previousEntryPoint, address indexed newEntryPoint, uint256 activationTime);
    event EntryPointUpdated(address indexed oldEntryPoint, address indexed newEntryPoint);

    /// @notice The wallet owner (can execute directly or via sessions).
    address public owner;
    /// @notice Address that has been proposed as the new owner (pending acceptance).
    address public pendingOwner;
    /// @notice The SessionManager contract that validates session-based operations.
    address public sessionManager;
    /// @notice The ERC-4337 EntryPoint contract.
    address public entryPoint;

    /// @notice Pending SessionManager address awaiting timelock.
    address public pendingSessionManager;
    /// @notice Timestamp when pendingSessionManager can be activated.
    uint256 public sessionManagerActivationTime;

    /// @notice Pending EntryPoint address awaiting timelock.
    address public pendingEntryPoint;
    /// @notice Timestamp when pendingEntryPoint can be activated.
    uint256 public entryPointActivationTime;

    /// @notice Prevents re-initialization after factory creation.
    bool private initialized;

    /// @dev Locks the implementation contract so it cannot be initialized directly.
    ///      EIP-1167 clones do not execute constructors — initialization happens via initialize().
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
        if (!initialized) revert NotInitializedError();
        _;
    }

    /// @notice One-time initialization called by the factory after cloning.
    /// @param _owner The wallet owner address.
    /// @param _sessionManager The SessionManager contract address.
    /// @param _entryPoint The ERC-4337 EntryPoint contract address.
    function initialize(
        address _owner,
        address _sessionManager,
        address _entryPoint
    ) external {
        if (initialized) revert AlreadyInitializedError();
        if (_owner == address(0)) revert InvalidOwnerError();
        if (_sessionManager == address(0)) revert InvalidSessionManagerError();
        if (_entryPoint == address(0)) revert InvalidEntryPointError();

        initialized = true;

        owner = _owner;
        sessionManager = _sessionManager;
        entryPoint = _entryPoint;

        (bool erc1820Ok, ) = ERC1820_REGISTRY.call(
            abi.encodeWithSignature("setInterfaceImplementer(address,bytes32,address)",
                address(this), ERC777_TOKENS_RECIPIENT_HASH, address(this))
        );
        erc1820Ok; // success is optional — ERC1820 registry may not exist

        emit WalletInitialized(_owner, _sessionManager, _entryPoint);
    }

    /// @notice ERC-4337 validateUserOp hook. Validates the user operation signature
    ///         (owner direct or session-based) and optionally tops up the EntryPoint deposit.
    /// @param userOp The packed user operation.
    /// @param userOpHash Hash of the user operation.
    /// @param missingAccountFunds Funds to forward to the EntryPoint if > 0.
    /// @return validationData 0 on success, non-zero on failure.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint onlyInitialized returns (uint256 validationData) {
        (uint256 spendValue, bytes32 sessionId, address signer) = _validateUserOperation(userOp, userOpHash);

        _fundEntryPoint(missingAccountFunds);

        emit UserOperationValidated(userOpHash, signer, sessionId, spendValue);
        return 0;
    }

    /// @notice Executes a single call. Only callable by the owner or EntryPoint.
    /// @param target The address to call.
    /// @param value ETH value to forward.
    /// @param data Calldata to send.
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
        if (target == address(0)) revert InvalidRecipientError();
        (bool success,) = target.call{value: value}(data);
        if (!success) revert ExecutionFailedError();

        emit ExecutionPerformed(msg.sender, target, value, keccak256(data));
    }

    /// @notice Executes a batch of calls. Only callable by the owner or EntryPoint.
    /// @param targets Array of addresses to call.
    /// @param values Array of ETH values to forward.
    /// @param data Array of calldata to send.
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external nonReentrant onlyInitialized onlyOwnerOrEntryPoint {
        if (targets.length == 0) revert LengthMismatchError();
        if (targets.length != values.length || values.length != data.length) revert LengthMismatchError();
        if (targets.length > MAX_BATCH_SIZE) revert BatchTooLargeError();

        uint256 totalValue;
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidRecipientError();
            totalValue += values[i];

            (bool success,) = targets[i].call{value: values[i]}(data[i]);
            if (!success) revert CallFailedError();
        }

        emit BatchExecutionPerformed(msg.sender, targets.length, totalValue);
    }

    /// @notice Deposits ETH into the EntryPoint for gas payments.
    function addDeposit() external payable onlyInitialized {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
        emit EntryPointDepositAdded(msg.value, IEntryPoint(entryPoint).balanceOf(address(this)));
    }

    /// @notice Returns the wallet's deposit balance in the EntryPoint.
    function getDeposit() external view returns (uint256) {
        return IEntryPoint(entryPoint).balanceOf(address(this));
    }

    /// @notice Withdraws ETH from the EntryPoint deposit to a recipient.
    /// @param recipient The address to receive the funds.
    /// @param amount The amount to withdraw.
    function withdrawDepositTo(address payable recipient, uint256 amount) external onlyOwner onlyInitialized {
        if (recipient == address(0)) revert InvalidRecipientError();
        IEntryPoint(entryPoint).withdrawTo(recipient, amount);
        emit EntryPointWithdrawal(recipient, amount);
    }

    /// @notice Initiates a 2FA-style ownership transfer by setting a pending owner.
    /// @param newOwner The proposed new owner.
    function changeOwner(address newOwner) external onlyOwner onlyInitialized {
        if (newOwner == address(0)) revert InvalidOwnerError();
        if (pendingOwner != address(0)) revert OwnershipTransferPendingError();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Completes the ownership transfer. Must be called by the pending owner.
    function acceptOwnership() external onlyInitialized {
        if (msg.sender != pendingOwner) revert NotAuthorizedError();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerChanged(oldOwner, msg.sender);
    }

    receive() external payable {}

    /// @notice ERC-777 tokensReceived hook. Allows ERC-777 tokens to be sent to this wallet.
    /// @dev Implements IERC777Recipient. Registration with ERC1820 happens in initialize().
    function tokensReceived(
        address,
        address,
        address,
        uint256,
        bytes calldata,
        bytes calldata
    ) external {}

    /// @notice Proposes a new SessionManager with a 24-hour timelock.
    /// @param _sessionManager The proposed new SessionManager address.
    function proposeSessionManager(address _sessionManager) external onlyOwner onlyInitialized {
        if (_sessionManager == address(0)) revert InvalidSessionManagerError();
        if (pendingSessionManager != address(0)) revert TimelockActiveError();
        pendingSessionManager = _sessionManager;
        sessionManagerActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit SessionManagerProposed(sessionManager, _sessionManager, sessionManagerActivationTime);
    }

    /// @notice Activates the pending SessionManager after the timelock has elapsed.
    function acceptSessionManager() external onlyOwner onlyInitialized {
        if (pendingSessionManager == address(0)) revert InvalidSessionManagerError();
        if (block.timestamp < sessionManagerActivationTime) revert TimelockNotReadyError();
        address oldSessionManager = sessionManager;
        sessionManager = pendingSessionManager;
        pendingSessionManager = address(0);
        sessionManagerActivationTime = 0;
        emit SessionManagerUpdated(oldSessionManager, sessionManager);
    }

    /// @notice Proposes a new EntryPoint with a 24-hour timelock.
    /// @param _entryPoint The proposed new EntryPoint address.
    function proposeEntryPoint(address _entryPoint) external onlyOwner onlyInitialized {
        if (_entryPoint == address(0)) revert InvalidEntryPointError();
        if (pendingEntryPoint != address(0)) revert TimelockActiveError();
        pendingEntryPoint = _entryPoint;
        entryPointActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit EntryPointProposed(entryPoint, _entryPoint, entryPointActivationTime);
    }

    /// @notice Activates the pending EntryPoint after the timelock has elapsed.
    function acceptEntryPoint() external onlyOwner onlyInitialized {
        if (pendingEntryPoint == address(0)) revert InvalidEntryPointError();
        if (block.timestamp < entryPointActivationTime) revert TimelockNotReadyError();
        address oldEntryPoint = entryPoint;
        entryPoint = pendingEntryPoint;
        pendingEntryPoint = address(0);
        entryPointActivationTime = 0;
        emit EntryPointUpdated(oldEntryPoint, entryPoint);
    }

    /// @notice Returns the wallet's native ETH balance.
    function checkBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @dev Validates a user operation. Supports two signature modes:
    ///      - 65-byte owner signature (direct execution)
    ///      - Session-based signature (sessionId + sessionSignature)
    /// @dev Replay protection is NOT implemented here — SessionManager owns nullifier validation.
    function _validateUserOperation(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256 spendValue, bytes32 sessionId, address signer) {
        spendValue = _extractSpendValue(userOp.callData);
        signer = _validateSignature(userOp, userOpHash);

        if (signer == owner) {
            return (spendValue, bytes32(0), signer);
        }

        bytes4 selector = bytes4(userOp.callData[:4]);
        if (selector == EXECUTE_BATCH_SELECTOR) revert BatchNotAllowedForSessionError();

        (sessionId,) = abi.decode(userOp.signature, (bytes32, bytes));
        address target = _extractTarget(userOp.callData);
        _validateSession(sessionId, signer, spendValue, target);
        return (spendValue, sessionId, signer);
    }

    /// @dev Validates the signature against the owner or returns the signer for session validation.
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view returns (address signer) {
        bytes32 digest = userOpHash.toEthSignedMessageHash();

        if (userOp.signature.length == 65) {
            signer = digest.recover(userOp.signature);
            if (signer != owner) revert InvalidOwnerSignatureError();
            return signer;
        }

        bytes memory sessionSignature;
        (, sessionSignature) = abi.decode(userOp.signature, (bytes32, bytes));
        signer = digest.recover(sessionSignature);
    }

    /// @dev Validates a session via the SessionManager.
    function _validateSession(
        bytes32 sessionId,
        address signer,
        uint256 spendValue,
        address target
    ) internal {
        uint8 sessionType = ISessionManager(sessionManager).getSessionType(sessionId);
        if (sessionType == 1) {
            bool valid = ISessionManager(sessionManager).validateLightweightSession(
                sessionId, signer, spendValue, target
            );
            if (!valid) revert LightweightSessionValidationFailedError();
        } else if (sessionType == 0) {
            bool valid = ISessionManager(sessionManager).validateSession(
                sessionId, signer, spendValue, target
            );
            if (!valid) revert SessionValidationFailedError();
        } else {
            revert SessionValidationFailedError();
        }
    }

    /// @dev Tops up the EntryPoint deposit if needed.
    function _fundEntryPoint(uint256 missingAccountFunds) internal {
        if (missingAccountFunds > 0) {
            (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
            if (!success) revert FundingFailedError();
        }
    }

    /// @dev Extracts the total spend value from callData by decoding the selector and arguments.
    ///      Supports execute (single) and executeBatch (batch) selectors.
    function _extractSpendValue(bytes calldata callData) internal pure returns (uint256 totalValue) {
        bytes4 selector = bytes4(callData[:4]);

        if (selector == EXECUTE_SELECTOR) {
            (, uint256 value,) = abi.decode(callData[4:], (address, uint256, bytes));
            return value;
        }

        if (selector == EXECUTE_BATCH_SELECTOR) {
            (address[] memory targets, uint256[] memory values,) = abi.decode(callData[4:], (address[], uint256[], bytes[]));
            if (targets.length != values.length) revert LengthMismatchError();

            for (uint256 i = 0; i < targets.length; i++) {
                totalValue += values[i];
            }

            return totalValue;
        }

        revert UnsupportedCallDataError();
    }

    /// @dev Extracts the target address from execute() callData.
    function _extractTarget(bytes calldata callData) internal pure returns (address) {
        bytes4 selector = bytes4(callData[:4]);

        if (selector == EXECUTE_SELECTOR) {
            (address target,,) = abi.decode(callData[4:], (address, uint256, bytes));
            return target;
        }

        revert UnsupportedCallDataError();
    }
}
