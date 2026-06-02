// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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

contract SessionManager is ReentrancyGuard {
    using ECDSA for bytes32;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event SessionCreated(
        bytes32 indexed sessionId,
        address indexed sessionKey,
        uint64 expiry,
        uint128 maxValue
    );

    event SessionUsed(
        bytes32 indexed sessionId,
        uint256 value,
        uint256 totalUsed
    );

    event SessionRevoked(bytes32 indexed sessionId);

    event LightSessionCreated(
        bytes32 indexed sessionId,
        address indexed sessionKey,
        uint256 dailySpendLimit,
        uint256 dailyTxLimit,
        uint64 expiry
    );
    event LightSessionUsed(
        bytes32 indexed sessionId,
        uint256 value,
        uint256 newDailySpend
    );
    event LightSessionRevoked(bytes32 indexed sessionId);
    event DailyLimitsReset(bytes32 indexed sessionId, uint64 newDay);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    struct Session {
        address sessionKey;
        uint256 valueUsed;
        uint256 maxValue;
        uint64 expiry;
        bool revoked;
    }

    // New struct for lightweight session with daily limits
    struct LightweightSession {
        address sessionKey;           // Session public key
        uint256 dailySpendLimit;      // Max wei spend per day
        uint256 dailyTxLimit;         // Max transactions per day
        uint256 dailySpendUsed;       // Wei spent today
        uint256 dailyTxUsed;          // Transactions today
        uint64 lastResetDay;          // Unix day for reset tracking
        uint64 expiry;                // Session expiration timestamp
        bool revoked;                 // Revocation flag
    }

    mapping(bytes32 => Session) public sessions;
    mapping(bytes32 => LightweightSession) public lightSessions;
    mapping(address => bytes32[]) public walletSessions;

    IVerifier public verifier;
    ICredentialRegistry public registry;

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _verifier, address _registry) {
        verifier = IVerifier(_verifier);
        registry = ICredentialRegistry(_registry);
    }

    /*//////////////////////////////////////////////////////////////
                        SESSION CREATION
    //////////////////////////////////////////////////////////////*/

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
    ) external nonReentrant {

        require(sessionKey != address(0), "Invalid key");
        require(expiry > block.timestamp, "Invalid expiry");
        require(sessions[sessionId].sessionKey == address(0), "Session exists");
        require(uint256(nullifier) == publicSignals[0], "Nullifier mismatch");
        require(uint256(registry.activeRoot()) == publicSignals[1], "Root mismatch");
        require(uint256(registry.revokedSecretRoot()) == publicSignals[2], "Revoked root mismatch");
        require(uint256(maxValue) == publicSignals[3], "Max value mismatch");
        require(uint256(expiry) == publicSignals[4], "Expiry mismatch");

        require(!registry.isNullifierUsed(nullifier), "Nullifier used");

        bool valid = verifier.verifyProof(a,b,c,publicSignals);
        require(valid, "Invalid proof");

        registry.markNullifierUsed(nullifier);

        Session storage s = sessions[sessionId];

        s.sessionKey = sessionKey;
        s.maxValue = maxValue;
        s.valueUsed = 0;
        s.expiry = expiry;
        s.revoked = false;

        emit SessionCreated(
            sessionId,
            sessionKey,
            expiry,
            maxValue
        );
    }

    /*//////////////////////////////////////////////////////////////
                        SESSION VALIDATION
    //////////////////////////////////////////////////////////////*/

    function validateSession(
        bytes32 sessionId,
        address signer,
        uint256 value
    ) external returns (bool) {

        Session storage s = sessions[sessionId];

        require(!s.revoked, "Revoked");
        require(block.timestamp <= s.expiry, "Session Expired");
        require(s.sessionKey == signer, "Invalid signer");

        uint256 newValue = s.valueUsed + value;

        require(newValue <= s.maxValue, "Limit exceeded");

        s.valueUsed = uint128(newValue);

        emit SessionUsed(sessionId,value,newValue);

        return true;
    }

    /*//////////////////////////////////////////////////////////////
                        SESSION REVOCATION
    //////////////////////////////////////////////////////////////*/

    function revokeSession(bytes32 sessionId) external {

        Session storage s = sessions[sessionId];

        require(s.sessionKey != address(0), "Unknown session");
        require(!s.revoked,"Already revoked");
        require(msg.sender == s.sessionKey, "Only session key");

        s.revoked = true;

        emit SessionRevoked(sessionId);
    }

    /*//////////////////////////////////////////////////////////////
                    LIGHTWEIGHT SESSION HELPERS
    //////////////////////////////////////////////////////////////*/

    function _checkAndResetDaily(LightweightSession storage s) internal {
        uint64 currentDay = uint64(block.timestamp / 1 days);
        if (s.lastResetDay < currentDay) {
            s.dailySpendUsed = 0;
            s.dailyTxUsed = 0;
            s.lastResetDay = currentDay;
            emit DailyLimitsReset(keccak256(abi.encode(s.sessionKey, s.expiry)), currentDay);
        }
    }

    /*//////////////////////////////////////////////////////////////
                    LIGHTWEIGHT SESSION MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a lightweight session with owner signature
     * @dev Called by backend on behalf of wallet owner through wallet contract
     * @param sessionId Unique session identifier
     * @param sessionKey Public key of session (signer address)
     * @param dailySpendLimit Maximum wei spendable per day
     * @param dailyTxLimit Maximum transactions per day
     * @param expiry Unix timestamp when session expires
     * @param ownerSignature EIP-191 signature from wallet owner
     */
    function createLightweightSession(
        bytes32 sessionId,
        address sessionKey,
        uint256 dailySpendLimit,
        uint256 dailyTxLimit,
        uint64 expiry,
        bytes calldata ownerSignature
    ) external {
        require(sessionKey != address(0), "Invalid session key");
        require(expiry > block.timestamp, "Invalid expiry");
        require(lightSessions[sessionId].sessionKey == address(0), "Session exists");

        // Verify owner signature over session params
        bytes32 messageHash = keccak256(abi.encode(
            sessionId,
            sessionKey,
            dailySpendLimit,
            dailyTxLimit,
            expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));
        address signer = ECDSA.recover(digest, ownerSignature);

        // Verify signer is the wallet owner (msg.sender is the wallet contract)
        require(IAgentWallet(msg.sender).owner() == signer, "Not wallet owner");

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

        emit LightSessionCreated(
            sessionId,
            sessionKey,
            dailySpendLimit,
            dailyTxLimit,
            expiry
        );
    }

    /**
     * @notice Validate a lightweight session for UserOperation execution
     * @param sessionId Session to validate
     * @param signer Address that signed the UserOperation
     * @param value Value being transferred in this transaction
     * @return valid True if session is valid and limits not exceeded
     */
    function validateLightweightSession(
        bytes32 sessionId,
        address signer,
        uint256 value
    ) external returns (bool) {
        LightweightSession storage s = lightSessions[sessionId];

        require(s.sessionKey != address(0), "Session not found");
        require(!s.revoked, "Session revoked");
        require(block.timestamp <= s.expiry, "Session expired");
        require(s.sessionKey == signer, "Invalid session signer");

        _checkAndResetDaily(s);

        uint256 newSpend = s.dailySpendUsed + value;
        require(newSpend <= s.dailySpendLimit, "Daily spend limit exceeded");
        require(s.dailyTxUsed + 1 <= s.dailyTxLimit, "Daily tx limit exceeded");

        s.dailySpendUsed = newSpend;
        s.dailyTxUsed++;

        emit LightSessionUsed(sessionId, value, s.dailySpendUsed);

        return true;
    }

    /**
     * @notice Revoke a lightweight session
     * @dev Only wallet owner or session key holder can revoke
     * @param sessionId Session to revoke
     */
    function revokeLightweightSession(bytes32 sessionId) external {
        LightweightSession storage s = lightSessions[sessionId];

        require(s.sessionKey != address(0), "Session not found");
        require(!s.revoked, "Already revoked");

        // Verify caller is wallet owner or session key
        // Check session key first to avoid abi.decode revert on EOA caller
        require(
            s.sessionKey == msg.sender ||
            IAgentWallet(msg.sender).owner() == msg.sender,
            "Not authorized to revoke"
        );

        s.revoked = true;

        emit LightSessionRevoked(sessionId);
    }

    /**
     * @notice Get session details
     * @param sessionId Session to query
     */
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
            s.sessionKey,
            s.dailySpendLimit,
            s.dailyTxLimit,
            s.dailySpendUsed,
            s.dailyTxUsed,
            s.expiry,
            s.revoked
        );
    }

    /**
     * @notice Get all sessions for a wallet
     * @param wallet Wallet address
     */
    function getWalletSessions(address wallet) external view returns (bytes32[] memory) {
        return walletSessions[wallet];
    }

}
