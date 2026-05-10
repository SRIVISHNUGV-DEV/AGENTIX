// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockVerifier
 * @dev Mock Groth16 verifier for testing purposes
 */
contract MockVerifier {
    bool public expectedResult = true;

    event ProofVerified(bool result, uint256[] publicSignals);

    function setResult(bool _result) external {
        expectedResult = _result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata publicSignals
    ) external view returns (bool) {
        return expectedResult;
    }
}
