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
    /// @notice Verifies a Groth16 proof for the credential circuit against 7 public signals.
    /// @dev View-only; returns false (never reverts) for an invalid proof. Signal order: [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier].
    /// @param a Proof point A. @param b Proof point B. @param c Proof point C. @param publicSignals Exactly 7 public signals in circuit order.
    /// @return True if the proof is valid for these signals, false otherwise.
    /// Maps to: contract Groth16Verifier.verifyProof; circuit CredentialCircuit
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[7] calldata publicSignals
    ) external view returns (bool);
}

/// @notice Interface for the CredentialRegistry contract.
interface ICredentialRegistry {
    /// @notice Returns the current active credential-tree root.
    /// @dev Read-only; sessions prove membership against this root.
    /// @return The active root (bytes32(0) before any root is accepted).
    /// Maps to: contract CredentialRegistry.activeRoot
    function activeRoot() external view returns (bytes32);
    /// @notice Returns the current revoked-secret-tree root.
    /// @dev Read-only; sessions prove non-revocation against this root.
    /// @return The revoked-secret root (bytes32(0) before any root is accepted).
    /// Maps to: contract CredentialRegistry.revokedSecretRoot
    function revokedSecretRoot() external view returns (bytes32);
    /// @notice Reports whether a nullifier has already been burned.
    /// @dev Read-only.
    /// @param nullifier Nullifier hash to check.
    /// @return True if already used, false if still fresh.
    /// Maps to: contract CredentialRegistry.isNullifierUsed
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
    /// @notice Burns a nullifier so its credential proof can never create a second session.
    /// @dev Only a registered SessionManager may call it; reverts with `NullifierUsed` on replay.
    /// @param nullifier Nullifier hash to mark used.
    /// Maps to: contract CredentialRegistry.markNullifierUsed
    function markNullifierUsed(bytes32 nullifier) external;
}

/// @notice Interface for AgentWallet ownership checks.
interface IAgentWallet {
    /// @notice Returns the wallet's owner address.
    /// @dev Read-only; used to check "caller is the wallet owner" (e.g. in revoke guards).
    /// @return The owner address.
    /// Maps to: contract AgentWallet.owner
    function owner() external view returns (address);
}

/// @notice Interface for AgentWalletFactory wallet validation.
interface IAgentWalletFactory {
    /// @notice Reports whether an address is a wallet created by the factory.
    /// @dev Read-only; the `onlyWallet` gate relies on this.
    /// @param wallet Address to check.
    /// @return True only if the factory created the wallet.
    /// Maps to: contract AgentWalletFactory.isAgentWallet
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

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @dev Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Gates wallet-only calls: the caller must be a wallet created by the registered factory.
    /// @dev Reverts with `NotAgentWallet` for any other caller, including the factory itself and EOAs. The factory address is the trust root — if it is swapped, the set of recognized wallets changes with it.
    /// Maps to: internal — SessionManager.validateSession, validateLightweightSession, pruneExpiredSessions; contract AgentWalletFactory.isAgentWallet
    modifier onlyWallet() {
        if (!walletFactory.isAgentWallet(msg.sender)) revert NotAgentWallet();
        _;
    }

    /// @notice One-time initializer: wires the ZK verifier, the credential registry, and (optionally) the wallet factory.
    /// @dev Runs once (initializer) from the proxy deployment. `walletFactory_` may be address(0) when the factory is not deployed yet — then `setInitialWalletFactory` must be called once before any wallet-gated function works (until then `onlyWallet` reverts on the zero-address call). `verifier_`/`registry_` are not zero-checked here, so deploying with a wrong address bricks session creation.
    /// @param verifier_ Groth16 verifier contract for credential proofs. @param registry_ CredentialRegistry holding the active/revoked roots and nullifiers. @param walletFactory_ AgentWalletFactory, or address(0) to set it later via `setInitialWalletFactory`.
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero owner (OZ `OwnableInvalidOwner` via `__Ownable_init(msg.sender)`).
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner to `msg.sender`, `verifier`, `registry`, and (when non-zero) `walletFactory` + the initialized flag.
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

    /// @notice Sets the AgentWalletFactory for the first time during deployment, bypassing the timelock; callable only once.
    /// @dev Owner-only. This is the one-time bootstrap for a factory that did not exist at `initialize` time. After this call, every later factory change must go through `proposeWalletFactory` + `acceptWalletFactory` — there is no second bypass.
    /// @param walletFactory_ Non-zero AgentWalletFactory contract.
    /// @dev Emits `WalletFactoryUpdated` with the old factory as address(0).
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `WalletFactoryTimelockActive` (already set — one-time only), `InvalidSessionManager` (zero address; note the error name is a legacy misnomer — it means "invalid factory address" here).
    /// Maps to: deployment script — factory bootstrap; event WalletFactoryUpdated
    /// @dev Side effects: sets `walletFactory`, sets `_walletFactoryInitialized = true`, emits `WalletFactoryUpdated`. Security: owner-only, one-time.
    function setInitialWalletFactory(address walletFactory_) external onlyOwner {
        if (_walletFactoryInitialized) revert WalletFactoryTimelockActive();
        if (walletFactory_ == address(0)) revert InvalidSessionManager();
        walletFactory = IAgentWalletFactory(walletFactory_);
        _walletFactoryInitialized = true;
        emit WalletFactoryUpdated(address(0), walletFactory_);
    }

    /// @notice Sets (or clears) the DelegationManager address that sessions may never call as a target.
    /// @dev Owner-only, no timelock. Call once after deploy, or after an upgrade that introduces this field, to activate the denial. While it is address(0) the DelegationManager denial is inactive — the manager's own delegator-or-role checks still block session-key writes, but the target-level denial is off. Passing address(0) clears the denial.
    /// @param delegationManager_ DelegationManager contract, or address(0) to clear the denial.
    /// @dev No event is emitted.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners.
    /// Maps to: contract DelegationManager (the denied target); internal — SessionManager._checkTarget
    /// @dev Side effects: sets `delegationManager`. Security: owner-only; controls a fail-closed session target denial.
    function setDelegationManager(address delegationManager_) external onlyOwner {
        delegationManager = delegationManager_;
    }

    /// @notice Pauses session creation and validation (revocation stays available while paused).
    /// @dev Owner-only. `revokeSession`/`revokeLightweightSession` and `setSessionTargets` deliberately have no pause guard — revocation and target-tightening are kill-switches that must work during an incident. Validation calls revert while paused, so no session spending can happen.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `EnforcedPause` if already paused.
    /// Maps to: TS SDK session.ts pause (owner admin)
    /// @dev Side effects: sets paused flag. Security: owner-only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes session creation and validation after a pause.
    /// @dev Owner-only; call after the incident that caused the pause is resolved. Sessions that expired during the pause stay expired.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners, `ExpectedPause` if not paused.
    /// Maps to: TS SDK session.ts unpause (owner admin)
    /// @dev Side effects: clears paused flag. Security: owner-only.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Proposes a replacement AgentWalletFactory, effective only after the 2-day timelock and `acceptWalletFactory`.
    /// @dev Owner-only. The factory is the trust root for `onlyWallet` — swapping it changes which addresses count as wallets, so the delay matters. Only one proposal may be pending at a time.
    /// @param walletFactory_ Non-zero proposed factory.
    /// @dev Emits `WalletFactoryProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `InvalidSessionManager` (zero address — legacy error name, means "invalid factory address" here), `WalletFactoryTimelockActive` (a proposal is already pending).
    /// Maps to: contract AgentWalletFactory (the dependency being swapped); event WalletFactoryProposed
    /// @dev Side effects: sets `pendingWalletFactory` and `walletFactoryActivationTime`, emits `WalletFactoryProposed`. Security: owner-only + 2-day timelock.
    function proposeWalletFactory(address walletFactory_) external onlyOwner {
        if (walletFactory_ == address(0)) revert InvalidSessionManager();
        if (pendingWalletFactory != address(0)) revert WalletFactoryTimelockActive();
        pendingWalletFactory = walletFactory_;
        walletFactoryActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit WalletFactoryProposed(address(walletFactory), walletFactory_, walletFactoryActivationTime);
    }

    /// @notice Activates the pending AgentWalletFactory once the 2-day timelock has elapsed.
    /// @dev Owner-only. Calling early reverts. After activation, `onlyWallet` recognizes wallets from the new factory only — wallets created by the old factory stop validating (their sessions become unusable until/unless the factory is swapped back).
    /// @dev Emits `WalletFactoryUpdated` with old and new factories.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `InvalidSessionManager` (no proposal pending — legacy error name), `WalletFactoryTimelockNotReady` (delay not yet elapsed).
    /// Maps to: contract AgentWalletFactory (the dependency being swapped); event WalletFactoryUpdated
    /// @dev Side effects: sets `walletFactory`, clears the pending proposal and activation time, emits `WalletFactoryUpdated`. Security: owner-only + timelock.
    function acceptWalletFactory() external onlyOwner {
        if (pendingWalletFactory == address(0)) revert InvalidSessionManager();
        if (block.timestamp < walletFactoryActivationTime) revert WalletFactoryTimelockNotReady();
        IAgentWalletFactory oldFactory = walletFactory;
        walletFactory = IAgentWalletFactory(pendingWalletFactory);
        pendingWalletFactory = address(0);
        walletFactoryActivationTime = 0;
        emit WalletFactoryUpdated(address(oldFactory), address(walletFactory));
    }

    /// @notice Creates a standard ZK-proof session for a wallet: verifies the credential proof, binds the session key, and burns the nullifier.
    /// @dev Only the bound wallet may call it (`msg.sender` must be the wallet — in practice the wallet owner drives this through the wallet). The 7 public signals must match the call arguments exactly: [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier]; any mismatch reverts before the proof is even checked. The nullifier is burned only after the proof verifies, so a failed proof never consumes the credential. A wallet may hold at most `MAX_SESSIONS_PER_WALLET` (100) session ids (standard + lightweight share the list).
    /// @param sessionId Caller-chosen unique id; must not collide with an existing standard or lightweight session. @param wallet AgentWallet the session binds to (must be `msg.sender` and a factory wallet). @param sessionKey Non-zero signer for this session; must not be the wallet itself. @param maxValue Cumulative ETH (wei) cap for the session, as uint128; must equal `publicSignals[2]`. @param expiry Unix timestamp when the session expires; must be in the future and equal `publicSignals[3]`. @param a Groth16 proof component A. @param b Groth16 proof component B. @param c Groth16 proof component C. @param publicSignals [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier] — see above.
    /// @dev Emits `SessionCreated` with the session id, wallet, session key, expiry, max value, and nullifier.
    /// @dev Reverts with `NotBoundWallet` (caller is not the wallet), `NotAgentWallet` (wallet has no code / is not a factory wallet / public signal wallet mismatch), `InvalidSessionKey` (zero or equal to the wallet), `InvalidExpiry` (expiry in the past), `SessionAlreadyExists` (id taken), `TooManySessions` (wallet at 100 sessions), `InvalidNullifier` (zero nullifier), `RootMismatch` / `RevokedRootMismatch` (signals differ from registry roots), `MaxValueMismatch` / `ExpiryMismatch` (signals differ from arguments), `UnsupportedCredentialVersion` (signal != 1), `NullifierAlreadyUsed` (replay), `InvalidProof` (verifier returns false), `EnforcedPause`.
    /// Maps to: TS SDK session.ts createSession; circuit CredentialCircuit nullifier + public signals; contract CredentialRegistry.markNullifierUsed; event SessionCreated
    /// @dev Side effects: writes the Session record, appends to `walletSessions`, burns the nullifier in the registry, emits `SessionCreated`. Reentrancy-guarded. Security: wallet-only; proof + nullifier enforced.
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

    /// @notice Sets the allowed-target allowlist for a STANDARD session (which contracts it may call).
    /// @dev Only the bound wallet may call it (mirrors `createSession`'s `msg.sender == wallet` gate — in practice the wallet owner drives this through the wallet). No pause guard: an owner must be able to TIGHTEN targets during an incident without unpausing (validation does not run while paused, so a change here cannot be exploited mid-pause). An empty list clears the allowlist, which re-allows non-token targets but still DENIES token selectors (see `_checkTarget`).
    /// @param sessionId The standard session to restrict (must exist; lightweight sessions use the allowlist set at creation instead). @param targets Array of contract addresses this session may call (max 32, no zero addresses).
    /// @dev Emits `SessionTargetsUpdated` on success.
    /// @dev Reverts with `SessionNotFound` (no standard session with this id), `NotBoundWallet` (caller is not the bound wallet), `TooManyTargets` (> 32), `TargetNotAllowed` (zero address in the list).
    /// Maps to: TS `tools/session.ts` setSessionTargets (via wallet `execute`); internal — SessionManager._checkTarget; event SessionTargetsUpdated
    /// @dev Side effects: overwrites `sessionTargets[sessionId]`, emits `SessionTargetsUpdated`. Security: bound-wallet-only; no pause guard by design.
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

    /// @notice Internal predicate: true when a 4-byte selector moves tokens without ETH value (ERC-20 transfer/approve/transferFrom, ERC-721 transferFrom/safeTransferFrom, both overloads).
    /// @dev Pure helper. The ERC-721 `transferFrom` selector (0x23b872dd) is shared with ERC-20 `transferFrom`, so it is covered once. Any new token standard's selector must be added here or its transfers escape the allowlist rule.
    /// @param selector First 4 bytes of the inner calldata.
    /// @return True if the selector is a token-moving selector, false otherwise.
    /// Maps to: internal — SessionManager._checkTarget
    function _isTokenSelector(bytes4 selector) internal pure returns (bool) {
        return selector == ERC20_TRANSFER_SELECTOR ||
            selector == ERC20_APPROVE_SELECTOR ||
            selector == ERC20_TRANSFER_FROM_SELECTOR ||
            selector == ERC721_SAFE_TRANSFER_FROM_SELECTOR ||
            selector == ERC721_SAFE_TRANSFER_FROM_DATA_SELECTOR;
    }

    /// @notice Internal predicate: true only when the session has a non-empty allowlist containing the target.
    /// @dev An empty allowlist returns false — this is what makes token selectors deny-by-default. Callers must not read this as "target allowed when the list is empty"; that case is handled by the caller (`_checkTarget`).
    /// @param sessionId Session to check. @param target Address to look for.
    /// @return True if allowlisted, false otherwise (including an empty allowlist).
    /// Maps to: internal — SessionManager._checkTarget
    function _isAllowlisted(bytes32 sessionId, address target) internal view returns (bool) {
        address[] storage allowed = sessionTargets[sessionId];
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == target) return true;
        }
        return false;
    }

    /// @notice Internal fail-closed target gate, called by both validators before any spend is counted.
    /// @dev Denied unconditionally: zero address, the bound wallet itself (`msg.sender` — the calling wallet), this SessionManager, the CredentialRegistry, and the DelegationManager (if set). Token selectors require an allowlisted target (empty allowlist = deny) — this is what makes the session spend limit real for tokens, since token transfers carry ETH value 0 and would otherwise bypass `maxValue`. Other calls: a non-empty allowlist restricts; an empty allowlist allows.
    /// @param sessionId Session being validated. @param target Call target. @param data Inner calldata of the wallet `execute()` call (first 4 bytes decide the token-selector rule; < 4 bytes is treated as a non-token call).
    /// @dev Returns silently when the target is allowed.
    /// @dev Reverts with `TargetNotAllowed` on any denied target or non-allowlisted token selector.
    /// Maps to: internal — SessionManager.validateSession, validateLightweightSession
    /// @dev Side effects: none (view). Security: fail-closed; the wallet itself is denied via `msg.sender` comparison, so the check is correct only when the wallet is the caller.
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

    /// @notice Validates one spend under a standard session: checks binding, revocation, expiry, signer, target rules, and the cumulative cap, then books the spend.
    /// @dev Called by the AgentWallet (via `onlyWallet`) before execution; returning true means "execute it". NOTE (documented residual): credential revocation does NOT kill live sessions — this function never consults the CredentialRegistry's revoked root, so a session created before its credential was revoked keeps spending until its own expiry or an explicit `revokeSession`. Issuers cannot terminate sessions; only the session key or the wallet owner can. Mitigation: keep standard-session expiries short.
    /// @param sessionId Session to validate. @param signer Address that signed the transaction (must be the session key). @param value ETH value (wei) being spent in this transaction. @param target Target contract being called. @param data Inner calldata of the wallet `execute()` call (used for the token-selector rule).
    /// @return True if the session is valid and the spend is within limits (the only success outcome — failures revert, never return false).
    /// @dev Reverts with `NotBoundWallet` (session bound to a different wallet), `SessionIsRevoked`, `SessionExpired`, `InvalidSigner` (signer is not the session key), `TargetNotAllowed` (denied target / non-allowlisted token selector), `LimitExceeded` (cumulative spend would exceed `maxValue`, or exceed uint128 range), `EnforcedPause`, `NotAgentWallet` (caller is not a factory wallet).
    /// Maps to: contract AgentWallet._validateSession / validateUserOp; event SessionUsed
    /// @dev Side effects: increments `valueUsed` (stored as uint128 after the range check), emits `SessionUsed`. The booking happens during validation, before the wallet executes — if the target call then fails, the whole user-op reverts and the booking rolls back with it, so failed calls never consume budget. Security: wallet-only.
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

    /// @notice Revokes a standard session immediately; callable by the session key or the wallet owner.
    /// @dev The `wallet` parameter MUST equal the session's bound wallet — it is not trusted as a lookup key (previously any factory-wallet owner could revoke anyone's session by passing their own wallet). No pause guard: revocation is a kill-switch and must work while paused. Revocation is permanent; there is no un-revoke.
    /// @param sessionId Session to revoke. @param wallet AgentWallet the session belongs to (must equal the session's bound wallet).
    /// @dev Emits `SessionRevoked` on success.
    /// @dev Reverts with `SessionNotFound` (no standard session with this id), `SessionAlreadyRevoked`, `NotAuthorizedToRevoke` (wallet mismatch, or caller is neither the session key nor the wallet owner).
    /// Maps to: TS SDK session.ts revokeSession; event SessionRevoked
    /// @dev Side effects: sets `revoked = true`, emits `SessionRevoked`. Security: session-key-or-owner-only; no pause guard by design.
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

    /// @notice Internal daily-limit rollover for lightweight sessions: zeroes today's counters when the UTC day has changed.
    /// @dev A "day" is `block.timestamp / 1 days` (UTC day index). The reset is lazy — it happens on the next validation after midnight, not on a schedule — so a session idle for days resets exactly once, on first use. Emits only when a reset actually happens.
    /// @param sessionId Session being reset (used only for the event). @param s Storage reference to the lightweight session.
    /// @dev Emits `DailyLimitsReset` when the day rolled over.
    /// Maps to: internal — SessionManager.validateLightweightSession
    /// @dev Side effects: zeroes `dailySpendUsed`/`dailyTxUsed`, updates `lastResetDay`, may emit `DailyLimitsReset`.
    function _checkAndResetDaily(bytes32 sessionId, LightweightSession storage s) internal {
        uint64 currentDay = uint64(block.timestamp / 1 days);
        if (s.lastResetDay < currentDay) {
            s.dailySpendUsed = 0;
            s.dailyTxUsed = 0;
            s.lastResetDay = currentDay;
            emit DailyLimitsReset(sessionId, currentDay);
        }
    }

    /// @notice Creates a lightweight session from an owner ECDSA signature — no ZK proof needed.
    /// @dev Only a factory wallet may call it (`msg.sender` is the wallet). The owner authorizes the session off-chain by signing `keccak256(abi.encode(chainid, this, wallet, sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry, allowedTargets))` as an EIP-191 message; the recovered signer must be the wallet's owner. The signature binds the chain, this contract, and the wallet, so it cannot be replayed on another chain, contract, or wallet. The allowlist is stored only when non-empty (empty = any non-token target). Note the ordering quirk: the session record is written before the 100-session cap check, but a cap revert rolls the whole transaction back, so no partial state survives (see report).
    /// @param sessionId Caller-chosen unique id; must not collide with an existing standard or lightweight session. @param sessionKey Non-zero signer for this session; must not be the calling wallet itself. @param dailySpendLimit Max ETH (wei) spendable per UTC day (0 = nothing may be spent). @param dailyTxLimit Max transactions per UTC day (0 = nothing may execute). @param expiry Unix timestamp when the session expires; must be in the future. @param allowedTargets Addresses this session may call (max 32); empty allows any non-token target, but token selectors still need an allowlisted target. @param ownerSignature EIP-191 ECDSA signature from the wallet owner over the parameters above.
    /// @dev Emits `LightSessionCreated` on success.
    /// @dev Reverts with `NotAgentWallet` (caller is not a factory wallet), `InvalidSessionKey` (zero or equal to the caller), `InvalidExpiry` (expiry in the past), `SessionAlreadyExists` (id taken), `TooManyTargets` (> 32), `NotWalletOwner` (recovered signer is not the wallet owner), `TooManySessions` (wallet at 100 sessions), `EnforcedPause`. A malformed signature reverts inside `ECDSA.recover`.
    /// Maps to: TS `tools/session.ts` createLightweightSession; TS SDK session.ts createLightweightSession; event LightSessionCreated
    /// @dev Side effects: writes the LightweightSession record, stores the allowlist when non-empty, appends to `walletSessions`, emits `LightSessionCreated`. Security: factory-wallet-only + owner signature; signature is single-purpose (bound to chain/contract/wallet/session params).
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

    /// @notice Validates one spend under a lightweight session: checks binding, revocation, expiry, signer, target rules, and the daily spend/tx caps, then books the spend.
    /// @dev Called by the AgentWallet (via `onlyWallet`) before execution; returning true means "execute it". Daily counters roll over lazily via `_checkAndResetDaily` before the cap checks. Token selectors require an allowlisted target even when the session was created with an empty allowlist (which otherwise allows any non-token target) — see `_checkTarget`.
    /// @param sessionId Session to validate. @param signer Address that signed the transaction (must be the session key). @param value ETH value (wei) being spent in this transaction. @param target Target contract being called. @param data Inner calldata of the wallet `execute()` call (used for the token-selector rule).
    /// @return True if the session is valid and the daily limits are not exceeded (the only success outcome — failures revert, never return false).
    /// @dev Reverts with `NotBoundWallet` (session bound to a different wallet), `SessionNotFound` (no lightweight session with this id), `SessionIsRevoked`, `SessionExpired`, `InvalidSigner`, `TargetNotAllowed`, `DailySpendLimitExceeded`, `DailyTxLimitExceeded`, `EnforcedPause`, `NotAgentWallet`.
    /// Maps to: contract AgentWallet._validateSession / validateUserOp; event LightSessionUsed (+ DailyLimitsReset on day rollover)
    /// @dev Side effects: may reset daily counters, increments `dailySpendUsed` and `dailyTxUsed`, emits `LightSessionUsed` (and `DailyLimitsReset` on rollover). Like `validateSession`, a failed target call reverts the whole user-op, rolling the booking back. Security: wallet-only.
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

    /// @notice Revokes a lightweight session immediately; callable by the session key or the wallet owner.
    /// @dev The `wallet` parameter MUST equal the session's bound wallet — it is not trusted as a lookup key (see `revokeSession`). No pause guard: revocation is a kill-switch and must work while paused. Revocation is permanent; there is no un-revoke.
    /// @param sessionId Session to revoke. @param wallet AgentWallet the session belongs to (must equal the session's bound wallet).
    /// @dev Emits `LightSessionRevoked` on success.
    /// @dev Reverts with `SessionNotFound` (no lightweight session with this id), `SessionAlreadyRevoked`, `NotAuthorizedToRevoke` (wallet mismatch, or caller is neither the session key nor the wallet owner).
    /// Maps to: TS SDK session.ts revokeLightweightSession; event LightSessionRevoked
    /// @dev Side effects: sets `revoked = true`, emits `LightSessionRevoked`. Security: session-key-or-owner-only; no pause guard by design.
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

    /// @notice Returns all fields of a lightweight session in one call.
    /// @dev Read-only. For an unknown id it returns a zeroed tuple (zero wallet/key, 0 limits, `revoked` false) rather than reverting — check that the wallet is non-zero to distinguish "never created". `lastResetDay` is intentionally not returned.
    /// @param sessionId Session to query.
    /// @return sessionWallet Bound wallet. @return sessionKey Authorized signer. @return dailySpendLimit Daily spend cap (wei). @return dailyTxLimit Daily transaction cap. @return dailySpendUsed Spend used today. @return dailyTxUsed Transactions used today. @return expiry Expiry timestamp. @return revoked Whether revoked.
    /// Maps to: TS SDK session.ts getLightSession
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
    /// @dev Read-only; never reverts. The AgentWallet uses this to route validation — type 2 (not found) is treated as a validation failure there, never as a valid session.
    /// @param sessionId Session to query.
    /// @return 0 for a standard session, 1 for a lightweight session, 2 when no session exists with this id.
    /// Maps to: contract AgentWallet._validateSession (routing); TS SDK session.ts getSessionType
    function getSessionType(bytes32 sessionId) external view returns (uint8) {
        if (sessions[sessionId].sessionKey != address(0)) return 0;
        if (lightSessions[sessionId].sessionKey != address(0)) return 1;
        return 2;
    }

    /// @notice Returns every session id ever associated with a wallet (standard + lightweight, including expired/revoked ones).
    /// @dev Read-only. The list only shrinks via `pruneExpiredSessions`; it is capped at `MAX_SESSIONS_PER_WALLET` (100) entries by the creation guards, so the return stays bounded.
    /// @param wallet Wallet to look up.
    /// @return The array of session ids (possibly empty; never reverts for an unknown wallet).
    /// Maps to: TS SDK session.ts getWalletSessions
    function getWalletSessions(address wallet) external view returns (bytes32[] memory) {
        return walletSessions[wallet];
    }

    /// @notice Returns the allowed-target allowlist for a session (standard sessions set it via `setSessionTargets`; lightweight sessions at creation).
    /// @dev Read-only. An empty array means "no allowlist": non-token targets are unrestricted, but token selectors are still denied (see `_checkTarget`). There is no way to distinguish "never set" from "explicitly cleared" — both are empty.
    /// @param sessionId Session to query.
    /// @return The array of allowed target addresses (possibly empty; never reverts for an unknown session).
    /// Maps to: TS SDK session.ts getSessionTargets
    function getSessionTargets(bytes32 sessionId) external view returns (address[] memory) {
        return sessionTargets[sessionId];
    }

    /// @notice Removes expired or revoked sessions from a wallet's session list, freeing the 100-session cap (gas-efficient pruning).
    /// @dev Only the wallet itself may call it (`onlyWallet` + `wallet == msg.sender`). Iterates from the end of the list so swap-and-pop removal never skips an entry, and stops after `limit` removals — call repeatedly with a small limit for a long list. "Expired" here means past expiry OR revoked, for both standard and lightweight sessions. Pruning only affects the enumeration list: the session records themselves stay readable (and already-unusable) in storage.
    /// @param wallet Wallet whose list is pruned (must be `msg.sender`). @param limit Maximum number of sessions to remove in this call (0 removes nothing).
    /// @dev No event is emitted.
    /// @dev Reverts with `NotAgentWallet` (caller is not a factory wallet) or `NotBoundWallet` (wallet != caller).
    /// Maps to: TS SDK session.ts pruneExpiredSessions
    /// @dev Side effects: swap-and-pop removes pruned ids from `walletSessions[wallet]`. Security: wallet-only; pruning cannot revive or extend a session.
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

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrading changes session authorization for every wallet — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[49] private __gap;
}
