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
error SessionTargetDenied();
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
    /// @notice Deposits ETH into the EntryPoint on behalf of an account, funding future user-op gas.
    /// @dev Payable; `msg.value` is credited to `account`'s deposit. Called by `AgentWallet.addDeposit`.
    /// @param account Account whose deposit is topped up.
    /// @return Nothing.
    /// Maps to: ERC-4337 EntryPoint depositTo; contract AgentWallet.addDeposit
    function depositTo(address account) external payable;
    /// @notice Withdraws ETH from an account's EntryPoint deposit to a recipient.
    /// @dev Only the deposit owner (the wallet) may call it on-chain; withdrawing more than deposited reverts in the EntryPoint.
    /// @param withdrawAddress Recipient of the withdrawn ETH. @param amount Wei to withdraw.
    /// @return Nothing.
    /// Maps to: ERC-4337 EntryPoint withdrawTo; contract AgentWallet.withdrawDepositTo
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    /// @notice Returns an account's current EntryPoint deposit balance.
    /// @dev Read-only.
    /// @param account Account to query.
    /// @return The deposit balance in wei (0 when nothing is deposited).
    /// Maps to: ERC-4337 EntryPoint balanceOf; contract AgentWallet.getDeposit
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Interface for the SessionManager contract used to validate session-based operations.
/// @dev The `data` parameter is the inner calldata of the execute() call — the SessionManager
///      needs it to enforce the token-selector rule (token transfers carry ETH value 0 and
///      would otherwise bypass session spend limits).
interface ISessionManager {
    /// @notice Validates one spend under a standard (ZK-proof) session, booking the spend on success.
    /// @dev Called by the wallet during `validateUserOp`; reverts (never returns false) on any validation failure.
    /// @param sessionId Session to validate. @param signer Recovered signer (must be the session key). @param value ETH value (wei) of the call. @param target Call target. @param data Inner calldata of the `execute()` call (token-selector rule).
    /// @return True when the session is valid and within its cumulative cap.
    /// Maps to: contract SessionManager.validateSession
    function validateSession(bytes32 sessionId, address signer, uint256 value, address target, bytes calldata data) external returns (bool);
    /// @notice Validates one spend under a lightweight (owner-signed) session, booking the spend on success.
    /// @dev Called by the wallet during `validateUserOp`; reverts (never returns false) on any validation failure.
    /// @param sessionId Session to validate. @param signer Recovered signer (must be the session key). @param value ETH value (wei) of the call. @param target Call target. @param data Inner calldata of the `execute()` call (token-selector rule).
    /// @return True when the session is valid and within its daily limits.
    /// Maps to: contract SessionManager.validateLightweightSession
    function validateLightweightSession(bytes32 sessionId, address signer, uint256 value, address target, bytes calldata data) external returns (bool);
    /// @notice Returns the session type: 0 = standard, 1 = lightweight, 2 = not found.
    /// @dev Read-only; the wallet routes validation on this value, and type 2 fails closed.
    /// @param sessionId Session to query.
    /// @return 0, 1, or 2 as above.
    /// Maps to: contract SessionManager.getSessionType
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

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev EIP-1167 clones do not execute constructors — initialization happens via `initialize()`. Setting `initialized = true` here means the implementation itself can never be initialized or used as a wallet; only its clones are usable.
    /// @return Nothing. Never reverts.
    /// Maps to: internal — AgentWallet.initialize (the real setup path); contract AgentWalletFactory (clones this implementation)
    constructor() {
        initialized = true;
    }

    /// @notice Gates owner-only calls (direct execution, ownership and timelock admin).
    /// @dev Reverts with `NotOwnerError` for anyone else, including the EntryPoint.
    /// Maps to: internal — AgentWallet owner-gated functions
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwnerError();
        _;
    }

    /// @notice Gates ERC-4337 EntryPoint-only calls (`validateUserOp`).
    /// @dev Reverts with `NotEntryPointError` for anyone else, including the owner.
    /// Maps to: internal — AgentWallet.validateUserOp
    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPointError();
        _;
    }

    /// @notice Gates execution calls to the owner or the EntryPoint (user-op flow).
    /// @dev Reverts with `NotAuthorizedError` for session keys and everyone else — session keys never call `execute` directly; the EntryPoint calls it after `validateUserOp`.
    /// Maps to: internal — AgentWallet.execute, executeBatch
    modifier onlyOwnerOrEntryPoint() {
        if (msg.sender != owner && msg.sender != entryPoint) revert NotAuthorizedError();
        _;
    }

    /// @notice Gates calls that require a fully initialized clone.
    /// @dev Reverts with `NotInitializedError` on the implementation contract (its constructor locks it) or any uninitialized clone.
    /// Maps to: internal — AgentWallet state-changing functions
    modifier onlyInitialized() {
        if (!initialized) revert NotInitializedError();
        _;
    }

    /// @notice One-time initialization called by the factory right after cloning; binds owner, SessionManager, and EntryPoint.
    /// @dev EIP-1167 clones never run the constructor, so this is the real setup step. The implementation contract locks itself in its constructor (`initialized = true`), so it can never be initialized directly. ERC1820 registration is best-effort: failure is ignored because the registry may not exist on the chain.
    /// @param _owner Non-zero wallet owner. @param _sessionManager Non-zero SessionManager that validates session calls. @param _entryPoint Non-zero ERC-4337 EntryPoint.
    /// @return Nothing; emits `WalletInitialized` on success.
    /// @dev Reverts with `AlreadyInitializedError` (second call), `InvalidOwnerError` / `InvalidSessionManagerError` / `InvalidEntryPointError` (zero address).
    /// Maps to: contract AgentWalletFactory._createWallet; TS SDK wallet.ts createWallet
    /// @dev Side effects: sets `initialized`, `owner`, `sessionManager`, `entryPoint`; attempts ERC1820 registration; emits `WalletInitialized`.
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

    /// @notice ERC-4337 `validateUserOp` hook: authenticates the user operation (owner signature or session) and tops up the EntryPoint deposit.
    /// @dev EntryPoint-only. Returns 0 on success — this contract signals failure by reverting instead of returning a non-zero `validationData`, so a revert here fails the whole user operation. Actual signature/session logic lives in `_validateUserOperation`.
    /// @param userOp The packed user operation whose `callData` must be `execute`/`executeBatch`. @param userOpHash Hash of the user operation, signed by the owner or session key. @param missingAccountFunds ETH (wei) to forward to the EntryPoint when > 0.
    /// @return validationData Always 0 on success (never returns a failure code — failures revert).
    /// @dev Reverts with `NotEntryPointError` (non-EntryPoint caller), `NotInitializedError`, or any revert from signature/session validation (`InvalidOwnerSignatureError`, `SessionValidationFailedError`, `BatchNotAllowedForSessionError`, `SessionTargetDenied`, `FundingFailedError`).
    /// Maps to: ERC-4337 EntryPoint `validateUserOp`; contract SessionManager.validateSession / validateLightweightSession; event UserOperationValidated
    /// @dev Side effects: forwards `missingAccountFunds` to the EntryPoint when > 0, emits `UserOperationValidated`. Security: EntryPoint-only; session path denies the EntryPoint and the wallet itself as targets (see `_validateUserOperation`).
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

    /// @notice Executes one arbitrary call with ETH value, owner- or EntryPoint-driven.
    /// @dev The wallet itself performs no authorization beyond the caller gate — spending limits and target rules are enforced upstream in `validateUserOp` (session path) or not at all (direct owner path). A failing target call reverts the whole transaction; no partial execution is kept.
    /// @param target Non-zero contract/EOA to call. @param value ETH (wei) forwarded with the call; must not exceed the wallet balance. @param data Calldata sent to the target.
    /// @return Nothing; emits `ExecutionPerformed` on success.
    /// @dev Reverts with `NotAuthorizedError` (caller is neither owner nor EntryPoint), `NotInitializedError`, `InvalidRecipientError` (zero target), `ExecutionFailedError` (target call returned false).
    /// Maps to: ERC-4337 user-op execution; contract SessionManager.validateSession (session path); event ExecutionPerformed
    /// @dev Side effects: external call with value to an arbitrary target, emits `ExecutionPerformed`. Reentrancy-guarded. Security: arbitrary call — only the owner or a validated user-op may reach it.
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

    /// @notice Executes a batch of calls atomically, owner- or EntryPoint-driven.
    /// @dev All calls run in order; any single failure reverts the entire batch (no partial state is kept). Session user-ops may never reach this function — `_validateUserOperation` rejects `executeBatch` for sessions — so batches are owner-only in practice.
    /// @param targets Non-empty array of non-zero addresses, at most `MAX_BATCH_SIZE` (20). @param values ETH (wei) per call; length must equal `targets.length`. @param data Calldata per call; length must equal `targets.length`.
    /// @return Nothing; emits `BatchExecutionPerformed` with the call count and summed value on success.
    /// @dev Reverts with `NotAuthorizedError`, `NotInitializedError`, `LengthMismatchError` (empty arrays or mismatched lengths), `BatchTooLargeError` (> 20 calls), `InvalidRecipientError` (zero target), `CallFailedError` (any sub-call failed).
    /// Maps to: ERC-4337 user-op execution; event BatchExecutionPerformed
    /// @dev Side effects: up to 20 external calls with value, emits `BatchExecutionPerformed`. Reentrancy-guarded. Security: arbitrary calls — owner/validated-user-op only.
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

    /// @notice Deposits the sent ETH into the EntryPoint to pay for future user-op gas.
    /// @dev Anyone may call it (e.g. a paymaster topping up the wallet); `msg.value` is forwarded in full. A 0-value call is a no-op deposit that still emits the event.
    /// @return Nothing; emits `EntryPointDepositAdded` with the deposited amount and the wallet's new EntryPoint balance.
    /// @dev Reverts with `NotInitializedError`, or if the EntryPoint's `depositTo` call itself reverts.
    /// Maps to: ERC-4337 EntryPoint depositTo; event EntryPointDepositAdded
    /// @dev Side effects: transfers `msg.value` to the EntryPoint, emits `EntryPointDepositAdded`.
    function addDeposit() external payable onlyInitialized {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
        emit EntryPointDepositAdded(msg.value, IEntryPoint(entryPoint).balanceOf(address(this)));
    }

    /// @notice Returns the wallet's current gas deposit balance held in the EntryPoint.
    /// @dev Read-only; queries the EntryPoint live, so the value can change between calls as user-ops consume gas.
    /// @return The EntryPoint deposit balance in wei (0 when nothing is deposited).
    /// Maps to: ERC-4337 EntryPoint balanceOf; TS SDK wallet.ts getDeposit
    function getDeposit() external view returns (uint256) {
        return IEntryPoint(entryPoint).balanceOf(address(this));
    }

    /// @notice Withdraws part of the EntryPoint gas deposit to a recipient.
    /// @dev Owner-only. The EntryPoint itself enforces the balance — withdrawing more than deposited reverts there, not here. Note the session-path denial: a session can never call this indirectly because the EntryPoint is a denied session target.
    /// @param recipient Non-zero address receiving the ETH. @param amount Wei to withdraw; 0 is allowed by this contract (EntryPoint decides).
    /// @return Nothing; emits `EntryPointWithdrawal` on success.
    /// @dev Reverts with `NotOwnerError`, `NotInitializedError`, `InvalidRecipientError` (zero recipient), or the EntryPoint's own revert on insufficient deposit.
    /// Maps to: ERC-4337 EntryPoint withdrawTo; event EntryPointWithdrawal
    /// @dev Side effects: moves ETH out of the EntryPoint deposit, emits `EntryPointWithdrawal`. Security: owner-only; moves value.
    function withdrawDepositTo(address payable recipient, uint256 amount) external onlyOwner onlyInitialized {
        if (recipient == address(0)) revert InvalidRecipientError();
        IEntryPoint(entryPoint).withdrawTo(recipient, amount);
        emit EntryPointWithdrawal(recipient, amount);
    }

    /// @notice Starts a two-step ownership transfer by naming a pending owner; nothing changes until they accept.
    /// @dev 2FA-style: proposing alone never moves ownership, so a compromised owner key cannot instantly hand the wallet away. Only one transfer may be pending at a time — there is no cancel function, the pending owner must accept or the owner must wait (see report).
    /// @param newOwner Non-zero proposed owner.
    /// @return Nothing; emits `OwnershipTransferStarted` on success.
    /// @dev Reverts with `NotOwnerError`, `NotInitializedError`, `InvalidOwnerError` (zero address), `OwnershipTransferPendingError` (a transfer is already pending).
    /// Maps to: TS SDK wallet.ts changeOwner; event OwnershipTransferStarted
    /// @dev Side effects: sets `pendingOwner`, emits `OwnershipTransferStarted`. Security: owner-only; ownership moves only via `acceptOwnership`.
    function changeOwner(address newOwner) external onlyOwner onlyInitialized {
        if (newOwner == address(0)) revert InvalidOwnerError();
        if (pendingOwner != address(0)) revert OwnershipTransferPendingError();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Completes the pending ownership transfer; only the named pending owner may call it.
    /// @dev The second step of `changeOwner`. Takes effect immediately: the old owner loses all owner rights in the same transaction, so in-flight owner operations from the old owner after this call revert.
    /// @return Nothing; emits `OwnerChanged` on success.
    /// @dev Reverts with `NotInitializedError` or `NotAuthorizedError` (caller is not the pending owner, including when no transfer is pending).
    /// Maps to: TS SDK wallet.ts acceptOwnership; event OwnerChanged
    /// @dev Side effects: sets `owner`, clears `pendingOwner`, emits `OwnerChanged`. Security: pending-owner-only; transfers full control of the wallet.
    function acceptOwnership() external onlyInitialized {
        if (msg.sender != pendingOwner) revert NotAuthorizedError();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerChanged(oldOwner, msg.sender);
    }

    /// @notice Accepts plain ETH transfers into the wallet (funding, refunds, or native receipts).
    /// @dev No logic, no access check — anyone may send ETH here. Receiving ETH does not authorize spending it; execution still requires the owner or a validated user-op.
    /// Maps to: internal — ETH funding path (see `addDeposit` for EntryPoint gas deposits)
    receive() external payable {}

    /// @notice ERC-777 `tokensReceived` hook, accepting ERC-777 token transfers into the wallet.
    /// @dev Implements `IERC777Recipient`; registration with the ERC1820 registry happens (best-effort) in `initialize()`. All parameters are intentionally ignored — receipt is unconditional, and accepting a token never grants spending authority over it.
    /// @return Nothing; no state is changed.
    /// Maps to: ERC-777 tokensReceived; internal — AgentWallet.initialize (ERC1820 registration)
    function tokensReceived(
        address,
        address,
        address,
        uint256,
        bytes calldata,
        bytes calldata
    ) external {}

    /// @notice Proposes a replacement SessionManager, effective only after the 2-day timelock and `acceptSessionManager`.
    /// @dev The SessionManager is the wallet's entire authorization policy — swapping it is the highest-risk admin action, hence propose-then-accept with a delay during which the owner can spot a bad proposal (there is no cancel; a new proposal must wait for the pending one to clear — see report).
    /// @param _sessionManager Non-zero proposed SessionManager.
    /// @return Nothing; emits `SessionManagerProposed` with the activation timestamp on success.
    /// @dev Reverts with `NotOwnerError`, `NotInitializedError`, `InvalidSessionManagerError` (zero address), `TimelockActiveError` (a proposal is already pending).
    /// Maps to: contract SessionManager (the dependency being swapped); event SessionManagerProposed
    /// @dev Side effects: sets `pendingSessionManager` and `sessionManagerActivationTime`, emits `SessionManagerProposed`. Security: owner-only; swaps who may authorize spending.
    function proposeSessionManager(address _sessionManager) external onlyOwner onlyInitialized {
        if (_sessionManager == address(0)) revert InvalidSessionManagerError();
        if (pendingSessionManager != address(0)) revert TimelockActiveError();
        pendingSessionManager = _sessionManager;
        sessionManagerActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit SessionManagerProposed(sessionManager, _sessionManager, sessionManagerActivationTime);
    }

    /// @notice Activates the pending SessionManager once the 2-day timelock has elapsed.
    /// @dev Calling early reverts; after activation all session validation routes to the new manager immediately, including live sessions. Old sessions are validated against the new manager's state, not migrated.
    /// @return Nothing; emits `SessionManagerUpdated` on success.
    /// @dev Reverts with `NotOwnerError`, `NotInitializedError`, `InvalidSessionManagerError` (no proposal pending), `TimelockNotReadyError` (delay not yet elapsed).
    /// Maps to: contract SessionManager (the dependency being swapped); event SessionManagerUpdated
    /// @dev Side effects: sets `sessionManager`, clears the pending proposal and activation time, emits `SessionManagerUpdated`. Security: owner-only; swaps who may authorize spending.
    function acceptSessionManager() external onlyOwner onlyInitialized {
        if (pendingSessionManager == address(0)) revert InvalidSessionManagerError();
        if (block.timestamp < sessionManagerActivationTime) revert TimelockNotReadyError();
        address oldSessionManager = sessionManager;
        sessionManager = pendingSessionManager;
        pendingSessionManager = address(0);
        sessionManagerActivationTime = 0;
        emit SessionManagerUpdated(oldSessionManager, sessionManager);
    }

    /// @notice Proposes a replacement ERC-4337 EntryPoint, effective only after the 2-day timelock and `acceptEntryPoint`.
    /// @dev The EntryPoint is the only caller of `validateUserOp` — swapping it re-roots all user-op authentication, hence the same propose-then-accept delay as the SessionManager swap.
    /// @param _entryPoint Non-zero proposed EntryPoint.
    /// @return Nothing; emits `EntryPointProposed` with the activation timestamp on success.
    /// @dev Reverts with `NotOwnerError`, `NotInitializedError`, `InvalidEntryPointError` (zero address), `TimelockActiveError` (a proposal is already pending).
    /// Maps to: ERC-4337 EntryPoint; event EntryPointProposed
    /// @dev Side effects: sets `pendingEntryPoint` and `entryPointActivationTime`, emits `EntryPointProposed`. Security: owner-only; swaps who may authenticate user-ops.
    function proposeEntryPoint(address _entryPoint) external onlyOwner onlyInitialized {
        if (_entryPoint == address(0)) revert InvalidEntryPointError();
        if (pendingEntryPoint != address(0)) revert TimelockActiveError();
        pendingEntryPoint = _entryPoint;
        entryPointActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit EntryPointProposed(entryPoint, _entryPoint, entryPointActivationTime);
    }

    /// @notice Activates the pending EntryPoint once the 2-day timelock has elapsed.
    /// @dev Calling early reverts; after activation only the new EntryPoint may call `validateUserOp`, and the old EntryPoint loses all access. Gas deposits held at the old EntryPoint are NOT moved — withdraw them first.
    /// @return Nothing; emits `EntryPointUpdated` on success.
    /// @dev Reverts with `NotOwnerError`, `NotInitializedError`, `InvalidEntryPointError` (no proposal pending), `TimelockNotReadyError` (delay not yet elapsed).
    /// Maps to: ERC-4337 EntryPoint; event EntryPointUpdated
    /// @dev Side effects: sets `entryPoint`, clears the pending proposal and activation time, emits `EntryPointUpdated`. Security: owner-only; swaps who may authenticate user-ops.
    function acceptEntryPoint() external onlyOwner onlyInitialized {
        if (pendingEntryPoint == address(0)) revert InvalidEntryPointError();
        if (block.timestamp < entryPointActivationTime) revert TimelockNotReadyError();
        address oldEntryPoint = entryPoint;
        entryPoint = pendingEntryPoint;
        pendingEntryPoint = address(0);
        entryPointActivationTime = 0;
        emit EntryPointUpdated(oldEntryPoint, entryPoint);
    }

    /// @notice Returns the wallet's native ETH balance (not the EntryPoint gas deposit — see `getDeposit`).
    /// @dev Read-only.
    /// @return The wallet's ETH balance in wei (0 when empty).
    /// Maps to: TS SDK wallet.ts checkBalance
    function checkBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Internal core of `validateUserOp`: decides whether a user-op is owner-direct or session-based and enforces the session fail-closed target denials.
    /// @dev Owner path (65-byte signature recovering the owner) bypasses all session rules. Session path rejects `executeBatch` outright and denies the EntryPoint and the wallet itself as targets — blocking the deposit-drain variant (session calling `withdrawTo` on the EntryPoint with value 0) and self-calls that could rewire `sessionManager`/`entryPoint`. The SessionManager additionally denies itself, the CredentialRegistry, and the DelegationManager, and enforces the token-selector rule. Replay protection is NOT done here — the SessionManager owns nullifier validation.
    /// @param userOp The packed user operation. @param userOpHash Hash signed by the owner or session key.
    /// @return spendValue Total ETH value the call would move. @return sessionId Session id, or bytes32(0) for the owner path. @return signer Address that signed the user-op.
    /// @dev Reverts with `InvalidOwnerSignatureError` (65-byte signature is not the owner's), `BatchNotAllowedForSessionError` (session batch), `SessionTargetDenied` (target is EntryPoint or this wallet), `UnsupportedCallDataError` (unknown selector), or any revert from `_validateSession`.
    /// Maps to: internal — AgentWallet.validateUserOp; contract SessionManager.validateSession / validateLightweightSession
    /// @dev Side effects: calls the SessionManager (state-changing validation: spend accounting), no storage writes here. Security: fail-closed denials; owner path is unaffected by them.
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
        bytes memory innerData = _extractData(userOp.callData);
        if (target == entryPoint) revert SessionTargetDenied();
        if (target == address(this)) revert SessionTargetDenied();
        _validateSession(sessionId, signer, spendValue, target, innerData);
        return (spendValue, sessionId, signer);
    }

    /// @notice Recovers the signer of a user-op: the owner for a 65-byte ECDSA signature, or the session key for a session-encoded signature.
    /// @dev A 65-byte signature is treated as an owner signature and must recover the owner; anything else is decoded as `(bytes32 sessionId, bytes sessionSignature)` and the recovered signer is returned unchecked — session authorization happens in `_validateSession`, not here. A malformed non-65-byte signature reverts inside `abi.decode`.
    /// @param userOp The packed user operation carrying the signature. @param userOpHash The signed hash (EIP-191 prefixed before recovery).
    /// @return signer The recovered signer address.
    /// @dev Reverts with `InvalidOwnerSignatureError` (65-byte signature is not the owner's) or on `abi.decode` failure for a malformed session signature.
    /// Maps to: internal — AgentWallet._validateUserOperation
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

    /// @notice Dispatches session validation to the SessionManager, routing by session type (0 = standard, 1 = lightweight).
    /// @dev Type comes from `getSessionType`; any other value (including 2 = not found) reverts as a failed validation. A `false` return from the manager is converted into a revert — this function never returns false.
    /// @param sessionId Session to validate. @param signer Recovered signer, must be the session key. @param spendValue ETH value of the call. @param target Call target. @param innerData Inner calldata of the `execute()` call (inspected for the token-selector rule).
    /// @return Nothing; returns silently on success.
    /// @dev Reverts with `LightweightSessionValidationFailedError` (lightweight check returned false) or `SessionValidationFailedError` (standard check failed, or unknown session type).
    /// Maps to: internal — AgentWallet._validateUserOperation; contract SessionManager.validateSession / validateLightweightSession / getSessionType
    /// @dev Side effects: external calls to the SessionManager that update spend accounting. Security: unknown session types fail closed.
    function _validateSession(
        bytes32 sessionId,
        address signer,
        uint256 spendValue,
        address target,
        bytes memory innerData
    ) internal {
        uint8 sessionType = ISessionManager(sessionManager).getSessionType(sessionId);
        if (sessionType == 1) {
            bool valid = ISessionManager(sessionManager).validateLightweightSession(
                sessionId, signer, spendValue, target, innerData
            );
            if (!valid) revert LightweightSessionValidationFailedError();
        } else if (sessionType == 0) {
            bool valid = ISessionManager(sessionManager).validateSession(
                sessionId, signer, spendValue, target, innerData
            );
            if (!valid) revert SessionValidationFailedError();
        } else {
            revert SessionValidationFailedError();
        }
    }

    /// @notice Tops up the EntryPoint deposit from the wallet's own ETH when the EntryPoint reports a shortfall.
    /// @dev Called at the end of `validateUserOp`. Sends `missingAccountFunds` to `msg.sender` — which, in the EntryPoint flow, is the EntryPoint itself. A zero amount is a no-op.
    /// @param missingAccountFunds Wei to forward; 0 skips the transfer.
    /// @return Nothing.
    /// @dev Reverts with `FundingFailedError` if the ETH transfer to the EntryPoint fails.
    /// Maps to: internal — AgentWallet.validateUserOp; ERC-4337 EntryPoint deposit flow
    /// @dev Side effects: external ETH transfer of `missingAccountFunds`. Security: recipient is always `msg.sender` (the EntryPoint in this flow), never a caller-supplied address.
    function _fundEntryPoint(uint256 missingAccountFunds) internal {
        if (missingAccountFunds > 0) {
            (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
            if (!success) revert FundingFailedError();
        }
    }

    /// @notice Extracts the total ETH value a user-op would spend by decoding its `execute`/`executeBatch` calldata.
    /// @dev Sums `value` for a single call, or all `values` for a batch. Only the two known selectors are supported — anything else reverts, so an unrecognized call can never slip past spend accounting with a value of 0.
    /// @param callData Full user-op calldata, starting with the `execute` or `executeBatch` selector.
    /// @return totalValue Summed ETH value in wei.
    /// @dev Reverts with `UnsupportedCallDataError` (unknown selector) or `LengthMismatchError` (batch targets/values length mismatch).
    /// Maps to: internal — AgentWallet._validateUserOperation
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

    /// @notice Extracts the target address from an `execute()` call's calldata.
    /// @dev Single-call only: batch calldata is rejected here because session validation never needs a single target from a batch (batches are denied for sessions upstream). Used to enforce the fail-closed target denials.
    /// @param callData Full user-op calldata starting with the `execute` selector.
    /// @return The `target` argument of the `execute()` call.
    /// @dev Reverts with `UnsupportedCallDataError` for any selector other than `execute`.
    /// Maps to: internal — AgentWallet._validateUserOperation
    function _extractTarget(bytes calldata callData) internal pure returns (address) {
        bytes4 selector = bytes4(callData[:4]);

        if (selector == EXECUTE_SELECTOR) {
            (address target,,) = abi.decode(callData[4:], (address, uint256, bytes));
            return target;
        }

        revert UnsupportedCallDataError();
    }

    /// @notice Extracts the inner calldata from an `execute()` call — the bytes the target will actually receive.
    /// @dev The SessionManager inspects these bytes for the token-selector rule: a token transfer carries ETH value 0, so without this the spend limit could be bypassed. Single-call only, like `_extractTarget`.
    /// @param callData Full user-op calldata starting with the `execute` selector.
    /// @return The `data` argument of the `execute()` call.
    /// @dev Reverts with `UnsupportedCallDataError` for any selector other than `execute`.
    /// Maps to: internal — AgentWallet._validateUserOperation; contract SessionManager._checkTarget (token-selector rule)
    function _extractData(bytes calldata callData) internal pure returns (bytes memory) {
        bytes4 selector = bytes4(callData[:4]);

        if (selector == EXECUTE_SELECTOR) {
            (,, bytes memory data) = abi.decode(callData[4:], (address, uint256, bytes));
            return data;
        }

        revert UnsupportedCallDataError();
    }
}
