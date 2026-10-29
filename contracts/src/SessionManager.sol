// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error InvalidSessionKey();
error InvalidExpiry();
error SessionAlreadyExists();
error NullifierMismatch();
error RootMismatch();
error RevokedRootMismatch();
error MaxValueMismatch();
error ExpiryMismatch();
error NullifierAlreadyUsed();
error InvalidProof();
error SessionNotFound();
error SessionIsRevoked();
error SessionExpired();
error InvalidSigner();
error LimitExceeded();
error SessionAlreadyRevoked();
error NotWalletOwner();
error DailySpendLimitExceeded();
error DailyTxLimitExceeded();
error NotAuthorizedToRevoke();
error NotAgentWallet();
error NotBoundWallet();
error InvalidSessionManager();
error TooManySessions();
error UnsupportedCredentialVersion();
error WalletFactoryTimelockNotReady();
error WalletFactoryTimelockActive();
error InvalidNullifier();
error TargetNotAllowed();
error TooManyTargets();

/// @notice Interface for the Groth16 ZK proof verifier.
interface IVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[7] calldata publicSignals
    ) external view returns (bool);
}

/// @notice Interface for the CredentialRegistry contract.
interface ICredentialRegistry {
    function activeRoot() external view returns (bytes32);
    function revokedSecretRoot() external view returns (bytes32);
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
    function markNullifierUsed(bytes32 nullifier) external;
}

/// @notice Interface for AgentWallet ownership checks.
interface IAgentWallet {
    function owner() external view returns (address);
}

/// @notice Interface for AgentWalletFactory wallet validation.
interface IAgentWalletFactory {
    function isAgentWallet(address wallet) external view returns (bool);
}

/// @title SessionManager
/// @notice Manages two types of agent sessions on AgentWallets:
///         1. **Standard sessions** - ZK proof-based with cumulative spend limits.
///         2. **Lightweight sessions** - Owner-signed with daily spend/tx limits and target restrictions.
/// @dev Upgradeable (UUPS). Standard sessions require a Groth16 ZK proof verifying credential ownership
///      via the CredentialRegistry. Lightweight sessions use ECDSA owner signatures for simpler auth.
///      All authorization policy (targets, budgets, limits) lives here — the wallet only executes.
///      SESSION TARGET RULES (fail closed, enforced in validateSession/validateLightweightSession):
///      - Denied targets, unconditionally: the bound wallet itself, this SessionManager,
///        the CredentialRegistry, and the DelegationManager (once set via setDelegationManager).
///        The EntryPoint is denied as a session target in AgentWallet._validateUserOperation.
///      - Allowlist: standard sessions gain one via setSessionTargets (bound wallet only);
///        lightweight sessions set one at creation. A non-empty allowlist restricts ALL calls.
///      - Token selectors (ERC-20 transfer/approve/transferFrom, ERC-721 transferFrom/
///        safeTransferFrom) ALWAYS require an allowlisted target. An empty allowlist DENIES
///        token selectors outright — this is what makes the session spend limit real for
///        tokens, since token transfers carry ETH value 0 and would otherwise bypass maxValue.
///      - Credential revocation does NOT kill live sessions (see validateSession NatSpec):
///        sessions end by expiry or explicit revoke only.
contract SessionManager is Initializable, ReentrancyGuard, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {
    using ECDSA for bytes32;

    // Token selectors that move value without ETH `value`. Any session call whose inner
    // calldata starts with one of these is a token transfer and requires an allowlisted target.
    bytes4 private constant ERC20_TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 private constant ERC20_APPROVE_SELECTOR = 0x095ea7b3;
    bytes4 private constant ERC20_TRANSFER_FROM_SELECTOR = 0x23b872dd;
    bytes4 private constant ERC721_SAFE_TRANSFER_FROM_SELECTOR = 0x42842e0e;
    bytes4 private constant ERC721_SAFE_TRANSFER_FROM_DATA_SELECTOR = 0xb88d4fde;

    event SessionCreated(bytes32 indexed sessionId, address indexed wallet, address indexed sessionKey, uint64 expiry, uint128 maxValue, bytes32 nullifier);
    event SessionUsed(bytes32 indexed sessionId, uint256 value, uint256 totalUsed);
    event SessionRevoked(bytes32 indexed sessionId);
    event LightSessionCreated(bytes32 indexed sessionId, address indexed wallet, address indexed sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry);
    event LightSessionUsed(bytes32 indexed sessionId, uint256 value, uint256 newDailySpend);
    event LightSessionRevoked(bytes32 indexed sessionId);
    event DailyLimitsReset(bytes32 indexed sessionId, uint64 newDay);
    event WalletFactoryProposed(address indexed previous, address indexed next, uint256 activationTime);
    event WalletFactoryUpdated(address indexed oldFactory, address indexed newFactory);

    event SessionTargetsUpdated(bytes32 indexed sessionId, address[] targets);

    /// @notice Standard session with a cumulative max-value limit.
    struct Session {
        address wallet;        // AgentWallet this session is bound to
        address sessionKey;    // Address authorised to sign for this session
        uint256 valueUsed;     // Cumulative value spent under this session
        uint256 maxValue;      // Maximum total value allowed
        uint64 expiry;         // Unix timestamp when the session expires
        bool revoked;          // Whether the session has been revoked
    }

    /// @notice Lightweight session with daily spend, transaction count, and target restrictions.
    struct LightweightSession {
        address wallet;           // AgentWallet this session is bound to
        address sessionKey;       // Address authorised to sign for this session
        uint256 dailySpendLimit;  // Maximum value spendable per day
        uint256 dailyTxLimit;     // Maximum transactions per day
        uint256 dailySpendUsed;   // Value spent today
        uint256 dailyTxUsed;      // Transactions used today
        uint64 lastResetDay;      // Day index of last daily limit reset
        uint64 expiry;            // Unix timestamp when the session expires
        bool revoked;             // Whether the session has been revoked
    }

    /// @notice Standard sessions keyed by session ID.
    mapping(bytes32 => Session) public sessions;
    /// @notice Lightweight sessions keyed by session ID.
    mapping(bytes32 => LightweightSession) public lightSessions;
    /// @notice Allowed targets for standard and lightweight sessions.
    ///         Empty array = any NON-TOKEN target allowed; token selectors always
    ///         require an allowlisted target (see _checkTarget). Standard sessions
    ///         set this via setSessionTargets; lightweight sessions at creation.
    mapping(bytes32 => address[]) public sessionTargets;
    /// @notice Maps each wallet to its list of session IDs for enumeration/pruning.
    mapping(address => bytes32[]) public walletSessions;
    uint256 public constant MAX_SESSIONS_PER_WALLET = 100;
    uint256 public constant MAX_ALLOWED_TARGETS = 32;
    uint256 public constant TIMELOCK_DELAY = 2 days;
    uint256 public constant SUPPORTED_CREDENTIAL_VERSION = 1;

    IVerifier public verifier;
    ICredentialRegistry public registry;
    IAgentWalletFactory public walletFactory;

    /// @notice DelegationManager address denied as a session target once set.
    ///         address(0) (unset) means that one denial is inactive; the
    ///         DelegationManager's own delegator-or-role check still blocks
    ///         session-key writes. Set it on deploy or after an upgrade.
    address public delegationManager;

    address public pendingWalletFactory;
    uint256 public walletFactoryActivationTime;
    bool private _walletFactoryInitialized;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyWallet() {
        if (!walletFactory.isAgentWallet(msg.sender)) revert NotAgentWallet();
        _;
    }

    /// @notice Initializes the SessionManager with external contract dependencies.
    /// @param verifier_ The Groth16 ZK verifier contract.
    /// @param registry_ The CredentialRegistry contract.
    /// @param walletFactory_ The AgentWalletFactory contract. Pass address(0) if
    ///        the factory is not yet deployed (use setInitialWalletFactory later).
    function initialize(address verifier_, address registry_, address walletFactory_) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        verifier = IVerifier(verifier_);
        registry = ICredentialRegistry(registry_);
        if (walletFactory_ != address(0)) {
            walletFactory = IAgentWalletFactory(walletFactory_);
        }
        _walletFactoryInitialized = (walletFactory_ != address(0));
    }

    /// @notice Sets the AgentWalletFactory for the first time during deployment.
    ///         This bypasses the timelock and can only be called once. All subsequent
    ///         changes must go through proposeWalletFactory + acceptWalletFactory.
    /// @param walletFactory_ The AgentWalletFactory contract address.
    function setInitialWalletFactory(address walletFactory_) external onlyOwner {
        if (_walletFactoryInitialized) revert WalletFactoryTimelockActive();
        if (walletFactory_ == address(0)) revert InvalidSessionManager();
        walletFactory = IAgentWalletFactory(walletFactory_);
        _walletFactoryInitialized = true;
        emit WalletFactoryUpdated(address(0), walletFactory_);
    }

    /// @notice Sets the DelegationManager address denied as a session target.
    ///         Only the owner. Call once after deploy, or after an upgrade that
    ///         introduces this field, to activate the DelegationManager denial.
    /// @param delegationManager_ The DelegationManager contract address (address(0) clears it).
    function setDelegationManager(address delegationManager_) external onlyOwner {
        delegationManager = delegationManager_;
    }

    /// @notice Pauses session creation and validation.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses session creation and validation.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Proposes a new AgentWalletFactory with a 2-day timelock.
    /// @param walletFactory_ The proposed new AgentWalletFactory address.
    function proposeWalletFactory(address walletFactory_) external onlyOwner {
        if (walletFactory_ == address(0)) revert InvalidSessionManager();
        if (pendingWalletFactory != address(0)) revert WalletFactoryTimelockActive();
        pendingWalletFactory = walletFactory_;
        walletFactoryActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit WalletFactoryProposed(address(walletFactory), walletFactory_, walletFactoryActivationTime);
    }

    /// @notice Activates the pending AgentWalletFactory after the timelock has elapsed.
    function acceptWalletFactory() external onlyOwner {
        if (pendingWalletFactory == address(0)) revert InvalidSessionManager();
        if (block.timestamp < walletFactoryActivationTime) revert WalletFactoryTimelockNotReady();
        IAgentWalletFactory oldFactory = walletFactory;
        walletFactory = IAgentWalletFactory(pendingWalletFactory);
        pendingWalletFactory = address(0);
        walletFactoryActivationTime = 0;
        emit WalletFactoryUpdated(address(oldFactory), address(walletFactory));
    }

    /// @notice Creates a standard (ZK-proof-based) session for an AgentWallet.
    /// @param sessionId Unique identifier for the session.
    /// @param wallet The AgentWallet this session is bound to.
    /// @param sessionKey The address authorised to sign transactions under this session.
    /// @param maxValue Maximum cumulative value this session may spend.
    /// @param expiry Unix timestamp when the session expires.
    /// @param a Groth16 proof component A.
    /// @param b Groth16 proof component B.
    /// @param c Groth16 proof component C.
    /// @param publicSignals [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier].
    function createSession(
        bytes32 sessionId,
        address wallet,
        address sessionKey,
        uint128 maxValue,
        uint64 expiry,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[7] calldata publicSignals
    ) external nonReentrant whenNotPaused {
        if (msg.sender != wallet) revert NotBoundWallet();
        if (wallet.code.length == 0) revert NotAgentWallet();
        if (!walletFactory.isAgentWallet(wallet)) revert NotAgentWallet();
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (sessionKey == wallet) revert InvalidSessionKey();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (sessions[sessionId].sessionKey != address(0)) revert SessionAlreadyExists();
        if (lightSessions[sessionId].sessionKey != address(0)) revert SessionAlreadyExists();

        if (walletSessions[wallet].length >= MAX_SESSIONS_PER_WALLET) revert TooManySessions();

        bytes32 nullifier = bytes32(publicSignals[6]);
        if (nullifier == bytes32(0)) revert InvalidNullifier();
        if (bytes32(registry.activeRoot()) != bytes32(publicSignals[0])) revert RootMismatch();
        if (bytes32(registry.revokedSecretRoot()) != bytes32(publicSignals[1])) revert RevokedRootMismatch();
        if (uint256(maxValue) != publicSignals[2]) revert MaxValueMismatch();
        if (uint256(expiry) != publicSignals[3]) revert ExpiryMismatch();
        if (address(uint160(publicSignals[4])) != wallet) revert NotAgentWallet();
        if (publicSignals[5] != SUPPORTED_CREDENTIAL_VERSION) revert UnsupportedCredentialVersion();
        if (registry.isNullifierUsed(nullifier)) revert NullifierAlreadyUsed();

        bool valid = verifier.verifyProof(a, b, c, publicSignals);
        if (!valid) revert InvalidProof();

        Session storage s = sessions[sessionId];
        s.wallet = wallet;
        s.sessionKey = sessionKey;
        s.maxValue = maxValue;
        s.valueUsed = 0;
        s.expiry = expiry;
        s.revoked = false;

        walletSessions[wallet].push(sessionId);

        registry.markNullifierUsed(nullifier);

        emit SessionCreated(sessionId, wallet, sessionKey, expiry, maxValue, nullifier);
    }

    /// @notice Sets the allowed-target allowlist for a STANDARD session.
    /// @dev Only the bound wallet may call (mirrors createSession's msg.sender == wallet
    ///      gate — in practice the wallet owner drives this through the wallet).
    ///      No pause guard: an owner must be able to TIGHTEN targets during an incident
    ///      without unpausing (validation does not run while paused, so a change here
    ///      cannot be exploited mid-pause). Empty list clears the allowlist, which
    ///      re-allows non-token targets but still DENIES token selectors.
    /// @param sessionId The standard session to restrict.
    /// @param targets Array of contract addresses this session may call (max 32, no zero addresses).
    function setSessionTargets(bytes32 sessionId, address[] calldata targets) external {
        Session storage s = sessions[sessionId];
        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (msg.sender != s.wallet) revert NotBoundWallet();
        if (targets.length > MAX_ALLOWED_TARGETS) revert TooManyTargets();
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert TargetNotAllowed();
        }
        sessionTargets[sessionId] = targets;
        emit SessionTargetsUpdated(sessionId, targets);
    }

    /// @dev True if `selector` moves tokens without ETH value (ERC-20 transfer/approve/
    ///      transferFrom, ERC-721 transferFrom/safeTransferFrom, both overloads).
    function _isTokenSelector(bytes4 selector) internal pure returns (bool) {
        return selector == ERC20_TRANSFER_SELECTOR ||
            selector == ERC20_APPROVE_SELECTOR ||
            selector == ERC20_TRANSFER_FROM_SELECTOR ||
            selector == ERC721_SAFE_TRANSFER_FROM_SELECTOR ||
            selector == ERC721_SAFE_TRANSFER_FROM_DATA_SELECTOR;
    }

    /// @dev True only if the session has a non-empty allowlist containing `target`.
    ///      An empty allowlist returns false — this is what makes token selectors
    ///      deny-by-default.
    function _isAllowlisted(bytes32 sessionId, address target) internal view returns (bool) {
        address[] storage allowed = sessionTargets[sessionId];
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == target) return true;
        }
        return false;
    }

    /// @dev Enforces the session target rules (fail closed). Called by both validators.
    ///      - Denied unconditionally: zero address, the bound wallet itself (msg.sender),
    ///        this SessionManager, the CredentialRegistry, and the DelegationManager (if set).
    ///      - Token selectors: require an allowlisted target (empty allowlist = deny).
    ///      - Other calls: a non-empty allowlist restricts; an empty allowlist allows.
    function _checkTarget(bytes32 sessionId, address target, bytes calldata data) internal view {
        if (target == address(0)) revert TargetNotAllowed();
        if (target == msg.sender) revert TargetNotAllowed();
        if (target == address(this)) revert TargetNotAllowed();
        if (target == address(registry)) revert TargetNotAllowed();
        if (delegationManager != address(0) && target == delegationManager) revert TargetNotAllowed();
        if (data.length >= 4 && _isTokenSelector(bytes4(data[:4]))) {
            if (!_isAllowlisted(sessionId, target)) revert TargetNotAllowed();
        } else {
            address[] storage allowed = sessionTargets[sessionId];
            if (allowed.length > 0 && !_isAllowlisted(sessionId, target)) revert TargetNotAllowed();
        }
    }

    /// @notice Validates a standard session for a transaction. Called by the AgentWallet before execution.
    /// @param sessionId The session to validate.
    /// @param signer The address that signed the transaction.
    /// @param value The ETH value being spent in this transaction.
    /// @param target The target contract being called.
    /// @param data The inner calldata of the wallet execute() call (used for the token-selector rule).
    /// @return True if the session is valid and the spend limit is not exceeded.
    /// @dev NOTE (C-4, documented residual): credential revocation does NOT kill live sessions.
    ///      validateSession never consults the CredentialRegistry's revoked root — a session
    ///      created before its credential was revoked keeps spending until its own expiry or
    ///      an explicit revokeSession call. Issuers cannot terminate sessions; only the
    ///      session key or the wallet owner can. Mitigation: keep standard-session expiries
    ///      short. No phantom mapping is maintained; this is the documented behavior.
    function validateSession(
        bytes32 sessionId,
        address signer,
        uint256 value,
        address target,
        bytes calldata data
    ) external onlyWallet whenNotPaused returns (bool) {
        Session storage s = sessions[sessionId];

        if (s.wallet != msg.sender) revert NotBoundWallet();
        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (s.sessionKey != signer) revert InvalidSigner();
        _checkTarget(sessionId, target, data);

        uint256 newValue = s.valueUsed + value;
        if (newValue > s.maxValue) revert LimitExceeded();
        if (newValue > type(uint128).max) revert LimitExceeded();

        s.valueUsed = uint128(newValue);
        emit SessionUsed(sessionId, value, newValue);
        return true;
    }

    /// @notice Revokes a standard session. Callable by the session key or the wallet owner.
    /// @dev The `wallet` parameter MUST equal the session's bound wallet — it is not
    ///      trusted as a lookup key (previously any factory-wallet owner could revoke
    ///      anyone's session by passing their own wallet). No pause guard: revocation
    ///      is a kill-switch and must work while paused.
    /// @param sessionId The session to revoke.
    /// @param wallet The AgentWallet the session belongs to (must equal s.wallet).
    function revokeSession(bytes32 sessionId, address wallet) external {
        Session storage s = sessions[sessionId];
        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (s.revoked) revert SessionAlreadyRevoked();
        if (wallet != s.wallet) revert NotAuthorizedToRevoke();
        if (msg.sender != s.sessionKey && IAgentWallet(s.wallet).owner() != msg.sender) {
            revert NotAuthorizedToRevoke();
        }
        s.revoked = true;
        emit SessionRevoked(sessionId);
    }

    /// @dev Resets daily spend and tx counters if a new day has started.
    function _checkAndResetDaily(bytes32 sessionId, LightweightSession storage s) internal {
        uint64 currentDay = uint64(block.timestamp / 1 days);
        if (s.lastResetDay < currentDay) {
            s.dailySpendUsed = 0;
            s.dailyTxUsed = 0;
            s.lastResetDay = currentDay;
            emit DailyLimitsReset(sessionId, currentDay);
        }
    }

    /// @notice Creates a lightweight session using an owner ECDSA signature (no ZK proof needed).
    /// @param sessionId Unique identifier for the session.
    /// @param sessionKey The address authorised to sign transactions.
    /// @param dailySpendLimit Maximum value spendable per day.
    /// @param dailyTxLimit Maximum transactions per day.
    /// @param expiry Unix timestamp when the session expires.
    /// @param allowedTargets Array of contract addresses this session may call. Empty = any target.
    /// @param ownerSignature ECDSA signature from the wallet owner authorising this session.
    function createLightweightSession(
        bytes32 sessionId,
        address sessionKey,
        uint256 dailySpendLimit,
        uint256 dailyTxLimit,
        uint64 expiry,
        address[] calldata allowedTargets,
        bytes calldata ownerSignature
    ) external whenNotPaused {
        if (!walletFactory.isAgentWallet(msg.sender)) revert NotAgentWallet();
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (sessionKey == msg.sender) revert InvalidSessionKey();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (lightSessions[sessionId].sessionKey != address(0)) revert SessionAlreadyExists();
        if (sessions[sessionId].sessionKey != address(0)) revert SessionAlreadyExists();
        if (allowedTargets.length > MAX_ALLOWED_TARGETS) revert TooManyTargets();

        bytes32 messageHash = keccak256(abi.encode(
            block.chainid, address(this), msg.sender, sessionId, sessionKey,
            dailySpendLimit, dailyTxLimit, expiry, allowedTargets
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", messageHash
        ));
        address signer = ECDSA.recover(digest, ownerSignature);

        if (IAgentWallet(msg.sender).owner() != signer) revert NotWalletOwner();

        lightSessions[sessionId] = LightweightSession({
            wallet: msg.sender,
            sessionKey: sessionKey,
            dailySpendLimit: dailySpendLimit,
            dailyTxLimit: dailyTxLimit,
            dailySpendUsed: 0,
            dailyTxUsed: 0,
            lastResetDay: uint64(block.timestamp / 1 days),
            expiry: expiry,
            revoked: false
        });

        if (allowedTargets.length > 0) {
            sessionTargets[sessionId] = allowedTargets;
        }

        if (walletSessions[msg.sender].length >= MAX_SESSIONS_PER_WALLET) revert TooManySessions();
        walletSessions[msg.sender].push(sessionId);
        emit LightSessionCreated(sessionId, msg.sender, sessionKey, dailySpendLimit, dailyTxLimit, expiry);
    }

    /// @notice Validates a lightweight session for a transaction. Called by the AgentWallet.
    /// @param sessionId The session to validate.
    /// @param signer The address that signed the transaction.
    /// @param value The ETH value being spent in this transaction.
    /// @param target The target contract being called.
    /// @param data The inner calldata of the wallet execute() call (used for the token-selector rule).
    /// @return True if the session is valid, daily limits are not exceeded, and target is allowed.
    /// @dev Token selectors require an allowlisted target even when the session was created
    ///      with an empty allowlist (which otherwise allows any non-token target). See _checkTarget.
    function validateLightweightSession(
        bytes32 sessionId,
        address signer,
        uint256 value,
        address target,
        bytes calldata data
    ) external onlyWallet whenNotPaused returns (bool) {
        LightweightSession storage s = lightSessions[sessionId];

        if (s.wallet != msg.sender) revert NotBoundWallet();
        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (s.sessionKey != signer) revert InvalidSigner();

        _checkTarget(sessionId, target, data);

        _checkAndResetDaily(sessionId, s);

        uint256 newSpend = s.dailySpendUsed + value;
        if (newSpend > s.dailySpendLimit) revert DailySpendLimitExceeded();
        if (s.dailyTxUsed + 1 > s.dailyTxLimit) revert DailyTxLimitExceeded();

        s.dailySpendUsed = newSpend;
        s.dailyTxUsed++;

        emit LightSessionUsed(sessionId, value, s.dailySpendUsed);
        return true;
    }

    /// @notice Revokes a lightweight session. Callable by the session key or wallet owner.
    /// @dev The `wallet` parameter MUST equal the session's bound wallet (see revokeSession).
    ///      No pause guard: revocation is a kill-switch and must work while paused.
    /// @param sessionId The session to revoke.
    /// @param wallet The AgentWallet the session belongs to (must equal s.wallet).
    function revokeLightweightSession(bytes32 sessionId, address wallet) external {
        LightweightSession storage s = lightSessions[sessionId];
        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (s.revoked) revert SessionAlreadyRevoked();

        if (wallet != s.wallet) revert NotAuthorizedToRevoke();
        if (s.sessionKey != msg.sender && IAgentWallet(s.wallet).owner() != msg.sender) {
            revert NotAuthorizedToRevoke();
        }

        s.revoked = true;
        emit LightSessionRevoked(sessionId);
    }

    /// @notice Returns all fields of a lightweight session.
    /// @param sessionId The session to query.
    function getLightSession(bytes32 sessionId) external view returns (
        address sessionWallet,
        address sessionKey,
        uint256 dailySpendLimit,
        uint256 dailyTxLimit,
        uint256 dailySpendUsed,
        uint256 dailyTxUsed,
        uint64 expiry,
        bool revoked
    ) {
        LightweightSession storage s = lightSessions[sessionId];
        return (
            s.wallet, s.sessionKey, s.dailySpendLimit, s.dailyTxLimit,
            s.dailySpendUsed, s.dailyTxUsed, s.expiry, s.revoked
        );
    }

    /// @notice Returns the type of a session: 0 = standard, 1 = lightweight, 2 = not found.
    /// @param sessionId The session to query.
    function getSessionType(bytes32 sessionId) external view returns (uint8) {
        if (sessions[sessionId].sessionKey != address(0)) return 0;
        if (lightSessions[sessionId].sessionKey != address(0)) return 1;
        return 2;
    }

    /// @notice Returns all session IDs associated with a wallet.
    /// @param wallet The wallet address.
    function getWalletSessions(address wallet) external view returns (bytes32[] memory) {
        return walletSessions[wallet];
    }

    /// @notice Returns the allowed targets for a lightweight session.
    /// @param sessionId The session to query.
    function getSessionTargets(bytes32 sessionId) external view returns (address[] memory) {
        return sessionTargets[sessionId];
    }

    /// @notice Removes expired sessions from a wallet's session list (gas-efficient pruning).
    /// @param wallet The wallet whose sessions to prune.
    /// @param limit Maximum number of sessions to prune in this call.
    function pruneExpiredSessions(address wallet, uint256 limit) external onlyWallet {
        if (wallet != msg.sender) revert NotBoundWallet();
        bytes32[] storage sessionIds = walletSessions[wallet];
        uint256 pruned;
        for (int256 i = int256(sessionIds.length) - 1; i >= 0 && pruned < limit; i--) {
            bytes32 sid = sessionIds[uint256(i)];
            bool expired = false;
            // Check standard session
            if (sessions[sid].sessionKey != address(0)) {
                expired = sessions[sid].expiry <= block.timestamp || sessions[sid].revoked;
            }
            // Check lightweight session
            if (!expired && lightSessions[sid].sessionKey != address(0)) {
                expired = lightSessions[sid].expiry <= block.timestamp || lightSessions[sid].revoked;
            }
            if (expired) {
                sessionIds[uint256(i)] = sessionIds[sessionIds.length - 1];
                sessionIds.pop();
                pruned++;
            }
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[49] private __gap;
}
