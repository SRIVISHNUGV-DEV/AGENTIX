// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
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

interface IVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata publicSignals
    ) external view returns (bool);
}

interface ICredentialRegistry {
    function activeRoot() external view returns (bytes32);
    function revokedSecretRoot() external view returns (bytes32);
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
    function markNullifierUsed(bytes32 nullifier) external;
}

interface IAgentWallet {
    function owner() external view returns (address);
}

contract SessionManager is Initializable, ReentrancyGuardUpgradeable, PausableUpgradeable, UUPSUpgradeable, OwnableUpgradeable {
    using ECDSA for bytes32;

    event SessionCreated(bytes32 indexed sessionId, address indexed sessionKey, uint64 expiry, uint128 maxValue);
    event SessionUsed(bytes32 indexed sessionId, uint256 value, uint256 totalUsed);
    event SessionRevoked(bytes32 indexed sessionId);
    event LightSessionCreated(bytes32 indexed sessionId, address indexed sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry);
    event LightSessionUsed(bytes32 indexed sessionId, uint256 value, uint256 newDailySpend);
    event LightSessionRevoked(bytes32 indexed sessionId);
    event DailyLimitsReset(bytes32 indexed sessionId, uint64 newDay);

    struct Session {
        address sessionKey;
        uint256 valueUsed;
        uint256 maxValue;
        uint64 expiry;
        bool revoked;
    }

    struct LightweightSession {
        address sessionKey;
        uint256 dailySpendLimit;
        uint256 dailyTxLimit;
        uint256 dailySpendUsed;
        uint256 dailyTxUsed;
        uint64 lastResetDay;
        uint64 expiry;
        bool revoked;
    }

    mapping(bytes32 => Session) public sessions;
    mapping(bytes32 => LightweightSession) public lightSessions;
    mapping(address => bytes32[]) public walletSessions;

    IVerifier public verifier;
    ICredentialRegistry public registry;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address verifier_, address registry_) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        verifier = IVerifier(verifier_);
        registry = ICredentialRegistry(registry_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createSession(
        bytes32 sessionId,
        address sessionKey,
        uint128 maxValue,
        uint64 expiry,
        bytes32 nullifier,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata publicSignals
    ) external nonReentrant whenNotPaused {
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (sessions[sessionId].sessionKey != address(0)) revert SessionAlreadyExists();
        if (uint256(nullifier) != publicSignals[0]) revert NullifierMismatch();
        if (uint256(registry.activeRoot()) != publicSignals[1]) revert RootMismatch();
        if (uint256(registry.revokedSecretRoot()) != publicSignals[2]) revert RevokedRootMismatch();
        if (uint256(maxValue) != publicSignals[3]) revert MaxValueMismatch();
        if (uint256(expiry) != publicSignals[4]) revert ExpiryMismatch();
        if (registry.isNullifierUsed(nullifier)) revert NullifierAlreadyUsed();

        bool valid = verifier.verifyProof(a, b, c, publicSignals);
        if (!valid) revert InvalidProof();

        registry.markNullifierUsed(nullifier);

        Session storage s = sessions[sessionId];
        s.sessionKey = sessionKey;
        s.maxValue = maxValue;
        s.valueUsed = 0;
        s.expiry = expiry;
        s.revoked = false;

        emit SessionCreated(sessionId, sessionKey, expiry, maxValue);
    }

    function validateSession(
        bytes32 sessionId,
        address signer,
        uint256 value
    ) external returns (bool) {
        Session storage s = sessions[sessionId];

        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (s.sessionKey != signer) revert InvalidSigner();

        uint256 newValue = s.valueUsed + value;
        if (newValue > s.maxValue) revert LimitExceeded();

        s.valueUsed = uint128(newValue);
        emit SessionUsed(sessionId, value, newValue);
        return true;
    }

    function revokeSession(bytes32 sessionId, address wallet) external {
        Session storage s = sessions[sessionId];
        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (s.revoked) revert SessionAlreadyRevoked();
        if (msg.sender != s.sessionKey && (wallet.code.length == 0 || IAgentWallet(wallet).owner() != msg.sender)) {
            revert NotAuthorizedToRevoke();
        }
        s.revoked = true;
        emit SessionRevoked(sessionId);
    }

    function _checkAndResetDaily(bytes32 sessionId, LightweightSession storage s) internal {
        uint64 currentDay = uint64(block.timestamp / 1 days);
        if (s.lastResetDay < currentDay) {
            s.dailySpendUsed = 0;
            s.dailyTxUsed = 0;
            s.lastResetDay = currentDay;
            emit DailyLimitsReset(sessionId, currentDay);
        }
    }

    function createLightweightSession(
        bytes32 sessionId,
        address sessionKey,
        uint256 dailySpendLimit,
        uint256 dailyTxLimit,
        uint64 expiry,
        bytes calldata ownerSignature
    ) external whenNotPaused {
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (lightSessions[sessionId].sessionKey != address(0)) revert SessionAlreadyExists();

        bytes32 messageHash = keccak256(abi.encode(
            sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", messageHash
        ));
        address signer = ECDSA.recover(digest, ownerSignature);

        if (IAgentWallet(msg.sender).owner() != signer) revert NotWalletOwner();

        lightSessions[sessionId] = LightweightSession({
            sessionKey: sessionKey,
            dailySpendLimit: dailySpendLimit,
            dailyTxLimit: dailyTxLimit,
            dailySpendUsed: 0,
            dailyTxUsed: 0,
            lastResetDay: uint64(block.timestamp / 1 days),
            expiry: expiry,
            revoked: false
        });

        walletSessions[msg.sender].push(sessionId);
        emit LightSessionCreated(sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry);
    }

    function validateLightweightSession(
        bytes32 sessionId,
        address signer,
        uint256 value
    ) external returns (bool) {
        LightweightSession storage s = lightSessions[sessionId];

        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (s.sessionKey != signer) revert InvalidSigner();

        _checkAndResetDaily(sessionId, s);

        uint256 newSpend = s.dailySpendUsed + value;
        if (newSpend > s.dailySpendLimit) revert DailySpendLimitExceeded();
        if (s.dailyTxUsed + 1 > s.dailyTxLimit) revert DailyTxLimitExceeded();

        s.dailySpendUsed = newSpend;
        s.dailyTxUsed++;

        emit LightSessionUsed(sessionId, value, s.dailySpendUsed);
        return true;
    }

    function revokeLightweightSession(bytes32 sessionId, address wallet) external {
        LightweightSession storage s = lightSessions[sessionId];
        if (s.sessionKey == address(0)) revert SessionNotFound();
        if (s.revoked) revert SessionAlreadyRevoked();

        if (s.sessionKey != msg.sender && (wallet.code.length == 0 || IAgentWallet(wallet).owner() != msg.sender)) {
            revert NotAuthorizedToRevoke();
        }

        s.revoked = true;
        emit LightSessionRevoked(sessionId);
    }

    function getLightSession(bytes32 sessionId) external view returns (
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
            s.sessionKey, s.dailySpendLimit, s.dailyTxLimit,
            s.dailySpendUsed, s.dailyTxUsed, s.expiry, s.revoked
        );
    }

    function getWalletSessions(address wallet) external view returns (bytes32[] memory) {
        return walletSessions[wallet];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
