# AgentIX Security Report

**Date:** 2026-06-22
**Scope:** All 6 production contracts + 1 mock
**Methodology:** Aggressive adversarial analysis — attacker perspective, compromised admin, faulty backend, production infrastructure
**Status:** 212 tests passing, 0 failing

---

## Executive Summary

6 contracts analyzed across 9 attack surfaces. 2 critical, 3 high, 4 medium, 3 low severity findings identified. No critical findings block V1 if mitigations are applied. The two critical findings relate to signature format inconsistency and missing validation in the session lifecycle.

---

## Critical Findings

### F-001: Lightweight Session Signature Omission — Wallet Address Not Signed

| Field | Value |
|-------|-------|
| **Finding #** | F-001 |
| **Title** | Lightweight session signature omits wallet address |
| **Severity** | CRITICAL |
| **Category** | Signature Malleability / Replay |
| **Affected Contracts** | `SessionManager.sol` (line 274-278) |
| **Root Cause** | `createLightweightSession` computes `messageHash = keccak256(abi.encode(block.chainid, address(this), sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry))` — the wallet address (`msg.sender`) is NOT included in the signed message. The wallet identity is inferred from `msg.sender` only. |
| **Attack Scenario** | If two different AgentWallet instances share the same owner, and the same SessionManager is used, a lightweight session signature created for Wallet A could theoretically be replayed if Wallet B calls `createLightweightSession` with the same parameters. However, `msg.sender` IS the wallet, so this requires Wallet B to be the one calling — meaning the owner of Wallet B must sign. **Mitigated by the wallet's `isAgentWallet` check.** |
| **Failure Scenario** | If the wallet factory is replaced or a fake wallet contract is deployed, the signature binding weakens. |
| **Blast Radius** | Session creation only — existing sessions are not affected. |
| **Exploitable Actor** | Wallet owner (signer) — must be a legitimate owner. |
| **Dependency Impact** | Relies entirely on `walletFactory.isAgentWallet()` for wallet identity. |
| **Proposed Fix** | Include `msg.sender` (wallet address) in the signed message: `abi.encode(block.chainid, address(this), msg.sender, sessionId, sessionKey, ...)` |
| **Priority** | **Short Term** — add wallet address to signature in next upgrade |

### F-002: Standard Session `createSession` — No Wallet Identity Binding

| Field | Value |
|-------|-------|
| **Finding #** | F-002 |
| **Title** | Standard session createSession has no wallet binding in proof |
| **Severity** | CRITICAL |
| **Category** | Authority Bypass |
| **Affected Contracts** | `SessionManager.sol` (line 162-201) |
| **Root Cause** | `createSession` accepts a `wallet` parameter from any caller. The ZK proof verifies credential ownership but does NOT bind the proof to a specific wallet address. The `wallet` parameter is stored directly in the session struct. |
| **Attack Scenario** | An attacker with a valid ZK proof (credential holder) could create a session bound to any wallet registered in the factory, not just their own. The proof verifies they own the credential, but doesn't prove they own the wallet. |
| **Failure Scenario** | Credential holder creates a session on another user's wallet, gaining spending authority under that wallet's balance. |
| **Blast Radius** | Any wallet in the factory — session creation grants spending authority up to `maxValue`. |
| **Exploitable Actor** | Any credential holder (anyone with a valid ZK proof). |
| **Dependency Impact** | Requires a valid credential + ZK proof, but the wallet binding is absent. |
| **Proposed Fix** | Include wallet address in publicSignals (e.g., publicSignals[5]) and verify it in the ZK proof, or add an off-chain check that the proof creator is the wallet owner. |
| **Priority** | **Immediate** — must be addressed before mainnet. Alternatively, restrict `createSession` callers to the wallet owner only. |

---

## High Findings

### F-003: `pruneExpiredSessions` Has No Access Control

| Field | Value |
|-------|-------|
| **Finding #** | F-003 |
| **Title** | Anyone can prune any wallet's session list |
| **Severity** | HIGH |
| **Category** | Access Control |
| **Affected Contracts** | `SessionManager.sol` (line 383-403) |
| **Root Cause** | `pruneExpiredSessions` has no modifier — it's a public function callable by anyone for any wallet. |
| **Attack Scenario** | Attacker calls `pruneExpiredSessions(victimWallet, 1000)` to remove expired session records from `walletSessions[victimWallet]`. This is a gas griefing vector (attacker pays gas) but also removes the on-chain audit trail for expired sessions. |
| **Failure Scenario** | Loss of session audit trail. No direct fund loss, but compliance/audit systems that rely on `walletSessions` data lose records. |
| **Blast Radius** | Audit trail only — no session validation is affected (expired sessions can't validate anyway). |
| **Exploitable Actor** | Any address (low-skill attacker). |
| **Dependency Impact** | None. |
| **Proposed Fix** | Add `onlyWallet` modifier, or at minimum restrict to wallet owner. |
| **Priority** | **Short Term** — add access control in next upgrade. |

### F-004: `setWalletFactory` Missing Zero-Address Check

| Field | Value |
|-------|-------|
| **Finding #** | F-004 |
| **Title** | Owner can brick all session creation by setting walletFactory to address(0) |
| **Severity** | HIGH |
| **Category** | State Corruption |
| **Affected Contracts** | `SessionManager.sol` (line 147-149) |
| **Root Cause** | `setWalletFactory` does not validate `walletFactory_ != address(0)`. Setting it to address(0) makes `walletFactory.isAgentWallet()` call to a non-contract, which returns false for all addresses, permanently blocking all session creation and validation. |
| **Attack Scenario** | Compromised owner or fat-fingered admin call: `sessionManager.setWalletFactory(address(0))`. All `isAgentWallet` calls revert, all session operations revert. |
| **Failure Scenario** | Complete session subsystem failure. No new sessions can be created, no existing sessions can be validated. |
| **Blast Radius** | All wallets, all sessions, entire session management layer. |
| **Exploitable Actor** | Owner (compromised or accidental). |
| **Dependency Impact** | Blocks ALL session-related functionality including AgentWallet `execute` via sessions. |
| **Proposed Fix** | Add `if (walletFactory_ == address(0)) revert InvalidSessionManagerError();` |
| **Priority** | **Immediate** — trivial fix, high blast radius. |

### F-005: `CapabilityRegistry.revokeCapability` — Incomplete Access Control

| Field | Value |
|-------|-------|
| **Finding #** | F-005 |
| **Title** | Non-registrar/non-owner cannot revoke; but owner cannot transfer registrar rights |
| **Severity** | HIGH |
| **Category** | Access Control Design Flaw |
| **Affected Contracts** | `CapabilityRegistry.sol` (line 71-86) |
| **Root Cause** | `revokeCapability` requires `cap.registrar == msg.sender || msg.sender == owner()`. If the registrar key is compromised and the owner is a multisig that hasn't added itself as owner, revocation is impossible. There's no way to transfer registrar rights. |
| **Attack Scenario** | Registrar key compromised → attacker registers malicious capabilities. Owner cannot revoke them because the owner is different from the registrar. |
| **Failure Scenario** | Malicious capabilities persist indefinitely until the contract is upgraded. |
| **Blast Radius** | All capabilities registered by the compromised registrar. |
| **Exploitable Actor** | Compromised registrar key. |
| **Dependency Impact** | Depends on owner being the registrar OR having an upgrade path. |
| **Proposed Fix** | Allow `revokeCapability` when called by any role with `DEFAULT_ADMIN_ROLE` equivalent, or add a `transferRegistrar` function. |
| **Priority** | **Short Term** — add admin revocation capability. |

---

## Medium Findings

### F-006: SessionManager `validateSession` — Value Accumulation Overflow Risk

| Field | Value |
|-------|-------|
| **Finding #** | F-006 |
| **Title** | `valueUsed` is uint128 but `newValue` is computed as uint256 |
| **Severity** | MEDIUM |
| **Category** | Integer Overflow |
| **Affected Contracts** | `SessionManager.sol` (line 220-223) |
| **Root Cause** | `uint256 newValue = s.valueUsed + value` — if `s.valueUsed + value > type(uint128).max`, the assignment `s.valueUsed = uint128(newValue)` silently truncates, resetting the cumulative spend to a lower value. |
| **Attack Scenario** | Session with high maxValue. Attacker sends many small transactions until `valueUsed` approaches `type(uint128).max`, then a final transaction causes overflow, resetting `valueUsed` to a small number, allowing the session to continue spending. |
| **Failure Scenario** | Session exceeds its intended `maxValue` limit by ~2^128 minus the actual spend. |
| **Blast Radius** | Single session — bounded by `maxValue` which is also uint128 in the struct. |
| **Exploitable Actor** | Session key holder (legitimate or compromised). |
| **Dependency Impact** | Requires session key compromise. |
| **Proposed Fix** | Add `require(newValue <= type(uint128).max)` or use `unchecked` with overflow check. Since `maxValue` is uint128, this can't overflow if `maxValue` is properly bounded — add a check: `if (newValue > type(uint128).max) revert LimitExceeded();` |
| **Priority** | **Long Term** — bounded by maxValue being uint128, but defensive check is good practice. |

### F-007: `DelegationManager` — 32-Scope Limit Reuses Wrong Error

| Field | Value |
|-------|-------|
| **Finding #** | F-007 |
| **Title** | 32-scope limit reuses `DelegatorHasBeenRevoked` error |
| **Severity** | MEDIUM |
| **Category** | Incorrect Error Reporting |
| **Affected Contracts** | `DelegationManager.sol` (line 132) |
| **Root Cause** | When a delegator exceeds 32 scopes, the contract reverts with `DelegatorHasBeenRevoked()` — a semantically wrong error that implies the delegator was revoked rather than hitting a scope limit. |
| **Attack Scenario** | N/A — not exploitable, but misleading for integrators. |
| **Failure Scenario** | Integrator debugging a scope-limit issue sees "revoked" error and wastes time checking revocation status. |
| **Blast Radius** | Debugging/integration only. |
| **Exploitable Actor** | N/A. |
| **Dependency Impact** | External integrators building on the delegation system. |
| **Proposed Fix** | Add a new error: `error ScopeLimitExceeded();` and use it instead. |
| **Priority** | **Short Term** — fix in next upgrade. |

### F-008: AgentWallet `receive()` Accepts ETH From Anyone

| Field | Value |
|-------|-------|
| **Finding #** | F-008 |
| **Title** | Any address can send ETH to the wallet, potentially inflating balance tracking |
| **Severity** | MEDIUM |
| **Category** | Unexpected State |
| **Affected Contracts** | `AgentWallet.sol` (line 236) |
| **Root Cause** | `receive() external payable {}` accepts ETH from anyone. Combined with `checkBalance()` returning `address(this).balance`, the wallet balance includes unsolicited ETH. |
| **Attack Scenario** | Dust attack: attacker sends tiny amounts to many wallets to pollute balance tracking or trigger accounting errors in off-chain systems. |
| **Failure Scenario** | Off-chain accounting systems see unexpected balance increases. |
| **Blast Radius** | Off-chain systems only — on-chain execution is unaffected. |
| **Exploitable Actor** | Any address (low-skill attacker). |
| **Dependency Impact** | Backend/indexer systems that track wallet balances. |
| **Proposed Fix** | Optional: add a `receive()` guard or ignore ETH from non-whitelisted senders. Not critical for V1. |
| **Priority** | **Long Term** — cosmetic for V1. |

### F-009: `AgentWalletFactory` — `createWallet` Emit Event on Idempotent Re-call

| Field | Value |
|-------|-------|
| **Finding #** | F-009 |
| **Title** | WalletCreated event emitted even when wallet already exists |
| **Severity** | MEDIUM |
| **Category** | Event Misrepresentation |
| **Affected Contracts** | `AgentWalletFactory.sol` (line 131) |
| **Root Cause** | `_createWallet` emits `WalletCreated` even when the wallet already exists (the idempotent path at line 127-129). |
| **Attack Scenario** | Off-chain indexers see duplicate `WalletCreated` events and may create duplicate records. |
| **Failure Scenario** | Off-chain database inconsistency. |
| **Blast Radius** | Off-chain indexing only. |
| **Exploitable Actor** | Anyone who calls `createWallet` with an existing owner+salt. |
| **Dependency Impact** | Backend event listeners. |
| **Proposed Fix** | Only emit `WalletCreated` in the `wallet.code.length == 0` branch (line 123-126). |
| **Priority** | **Long Term** — off-chain concern only. |

---

## Low Findings

### F-010: `CredentialRegistry.markNullifierUsed` — No Reentrancy Guard

| Field | Value |
|-------|-------|
| **Finding #** | F-010 |
| **Title** | markNullifierUsed has no reentrancy protection |
| **Severity** | LOW |
| **Category** | Reentrancy |
| **Affected Contracts** | `CredentialRegistry.sol` (line 60-64) |
| **Root Cause** | `markNullifierUsed` modifies state (`usedNullifiers[nullifier] = true`) after an external call path (called by SessionManager which is an external contract). However, since `markNullifierUsed` is called from `createSession` which uses `nonReentrant`, the reentrancy is prevented at the caller level. |
| **Attack Scenario** | Theoretically impossible due to SessionManager's `nonReentrant` modifier. But if a new caller is added to `sessionManagers` mapping that doesn't have reentrancy protection, this becomes exploitable. |
| **Failure Scenario** | Double-spending of a nullifier (same credential used twice). |
| **Blast Radius** | Single nullifier / credential. |
| **Exploitable Actor** | Must control a malicious session manager contract. |
| **Dependency Impact** | Only if `setSessionManager` is called with a malicious contract. |
| **Proposed Fix** | Add `ReentrancyGuardUpgradeable` to `CredentialRegistry` or add a check: `require(!usedNullifiers[nullifier])` before the external call pattern (already present, so low risk). |
| **Priority** | **Long Term** — defense in depth. |

### F-011: `AgentWallet` — Constructor Sets `initialized = true` Prevents Clone Testing

| Field | Value |
|-------|-------|
| **Finding #** | F-011 |
| **Title** | Implementation contract cannot be used for testing initialize() validations |
| **Severity** | LOW |
| **Category** | Test Coverage |
| **Affected Contracts** | `AgentWallet.sol` (line 91-93) |
| **Root Cause** | Constructor sets `initialized = true` to prevent self-destruct attacks on the implementation. This means `initialize()` on a bare impl always reverts with `AlreadyInitializedError`, preventing unit testing of zero-address validation paths. |
| **Attack Scenario** | N/A — this is a security feature, not a vulnerability. |
| **Failure Scenario** | Test coverage gap — zero-address validation in `initialize` is only testable through proxy deployment failure. |
| **Blast Radius** | Test coverage only. |
| **Exploitable Actor** | N/A. |
| **Dependency Impact** | N/A. |
| **Proposed Fix** | Test via factory creation with zero-address (which already tests this path through the factory's `_createWallet` → `IAgentWallet.initialize`). |
| **Priority** | **Long Term** — documentation only. |

### F-012: `SessionManager.prunExpiredSessions` — Gas Unbounded

| Field | Value |
|-------|-------|
| **Finding #** | F-012 |
| **Title** | pruneExpiredSessions iterates from end but limit parameter controls gas |
| **Severity** | LOW |
| **Category** | Gas DoS |
| **Affected Contracts** | `SessionManager.sol` (line 383-403) |
| **Root Cause** | The `limit` parameter controls how many sessions are pruned per call, preventing gas DoS. However, if `limit` is set to `type(uint256).max`, all sessions are pruned in one transaction. |
| **Attack Scenario** | Attacker calls with high limit on a wallet with many sessions — but attacker pays gas, so this is self-DOS, not an attack on others. |
| **Failure Scenario** | Transaction reverts due to gas limit if too many sessions. |
| **Blast Radius** | Single transaction. |
| **Exploitable Actor** | Self-DoS only. |
| **Dependency Impact** | N/A. |
| **Proposed Fix** | Consider capping `limit` to a reasonable maximum (e.g., 100) in the function. |
| **Priority** | **Long Term** — self-DoS is not exploitable against others. |

---

## Summary Table

| # | Title | Severity | Status |
|---|-------|----------|--------|
| F-001 | Lightweight session signature omits wallet address | CRITICAL | Fix in next upgrade |
| F-002 | Standard session has no wallet binding in proof | CRITICAL | Fix before mainnet |
| F-003 | pruneExpiredSessions no access control | HIGH | Fix in next upgrade |
| F-004 | setWalletFactory missing zero-address check | HIGH | Fix immediately |
| F-005 | revokeCapability incomplete access control | HIGH | Fix in next upgrade |
| F-006 | valueUsed uint128 overflow risk | MEDIUM | Long term |
| F-007 | 32-scope limit wrong error | MEDIUM | Short term |
| F-008 | receive() accepts ETH from anyone | MEDIUM | Long term |
| F-009 | WalletCreated event on idempotent re-call | MEDIUM | Long term |
| F-010 | markNullifierUsed no reentrancy guard | LOW | Long term |
| F-011 | Constructor prevents impl testing | LOW | Documentation |
| F-012 | pruneExpiredSessions gas unbounded | LOW | Long term |

---

## Attack Surface Coverage

| Surface | Tests | Status |
|---------|-------|--------|
| Access Control | 45+ | Covered |
| Signature Verification | 20+ | Covered |
| State Transitions | 35+ | Covered |
| Boundary Conditions | 25+ | Covered |
| Reentrancy | 10+ | Covered |
| Upgrade Safety | 12+ | Covered |
| Cross-Contract | 15+ | Covered |
| Gas/DoS | 8+ | Covered |
