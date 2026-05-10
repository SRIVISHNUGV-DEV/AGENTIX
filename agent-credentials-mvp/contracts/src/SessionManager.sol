// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

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

contract SessionManager is ReentrancyGuard {

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

    mapping(bytes32 => Session) public sessions;

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

}
