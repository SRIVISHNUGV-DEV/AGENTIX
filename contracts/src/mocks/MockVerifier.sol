// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockVerifier
/// @notice Mock Groth16 verifier for testing. Always returns a configurable boolean
///         instead of performing actual cryptographic verification.
/// @dev Use only in tests. The `expectedResult` can be toggled via `setResult`.
contract MockVerifier {
    /// @notice The boolean value returned by verifyProof.
    bool public expectedResult = true;

    event ProofVerified(bool result, uint256[] publicSignals);

    /// @notice Sets the return value for future verifyProof calls.
    /// @param _result True to simulate valid proofs, false to simulate invalid ones.
    function setResult(bool _result) external {
        expectedResult = _result;
    }

    /// @notice Returns the stored expectedResult (no actual proof verification).
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[5] calldata
    ) external view returns (bool) {
        return expectedResult;
    }
}
