// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockVerifier
/// @notice Mock Groth16 verifier for testing. Always returns a configurable boolean
///         instead of performing actual cryptographic verification.
/// @dev Use only in tests. The `expectedResult` can be toggled via `setResult`.
contract MockVerifier {
    /// @notice The boolean value returned by verifyProof.
    bool public expectedResult = true;

    /// @notice Sets the return value for future verifyProof calls.
    /// @dev Test-only control: flip the mock between "proofs valid" and "proofs invalid" to exercise both branches of `SessionManager.createSession`. Takes effect immediately for the next call; no event is emitted.
    /// @param _result True to simulate valid proofs, false to simulate invalid ones.
    /// @return Nothing.
    /// Maps to: contract SessionManager.createSession (test double for `IVerifier`); test helper — `contracts/test/*.test.ts` deploy it as the verifier
    /// @dev Side effects: sets `expectedResult`. Security: test-only mock — never deploy as a production verifier; it "verifies" nothing.
    function setResult(bool _result) external {
        expectedResult = _result;
    }

    /// @notice Returns the stored expectedResult without performing any actual proof verification.
    /// @dev Test double for `Groth16Verifier.verifyProof`: all four inputs are ignored, so ANY proof — including garbage — "verifies" when `expectedResult` is true. `SessionManager.createSession` reverts with `InvalidProof` when this returns false.
    /// @return The configured boolean (`expectedResult`); true by default.
    /// Maps to: contract Groth16Verifier.verifyProof (mocked); contract SessionManager.createSession (caller); test helper — `contracts/test/*.test.ts`
    /// @dev Side effects: none (view). Security: test-only — returns a canned answer, never cryptographic verification.
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[7] calldata
    ) external view returns (bool) {
        return expectedResult;
    }
}
