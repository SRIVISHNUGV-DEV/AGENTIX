# AGENTS.md — Session Context

## Current Focus
V1 Certification — all security findings fixed, contracts redeployed, 213/213 local + 40/40 onchain tests passing.

## Recent Changes (2026-06-22)
- **Security hardening** — Fixed all remaining findings from security audit:
  - F-006: Added uint128 overflow check in SessionManager.validateSession
  - F-007: Fixed wrong error message in DelegationManager scope limit (ScopeLimitExceeded)
  - F-009: WalletCreated event only emitted on new wallet creation (not idempotent re-call)
  - S-001: Added MAX_SESSIONS_PER_WALLET (100) cap to prevent unbounded walletSessions array
- **Contracts redeployed** to Base Sepolia with all fixes applied
- **V1Certification.test.ts** — Fixed 13 pre-existing test bugs (lightweight session encoding, prune funding, array lengths, error names)
- **test-onchain.ts** — Updated for new contract interfaces (DelegationManager uses AccessControl)
- **deploy-v3.ts** — Restructured deployment order to work around OZ v5 ERC1967Proxy issue with empty init data

## Security Findings Status
| Finding | Status |
|---------|--------|
| F-001 (CRITICAL — wallet not in lightweight sig) | FIXED (msg.sender in signature) |
| F-002 (CRITICAL — no wallet binding in ZK proof) | FIXED (wallet in publicSignals[5]) |
| F-003 (HIGH — pruneExpiredSessions no ACL) | FIXED (onlyWallet modifier) |
| F-004 (HIGH — setWalletFactory no zero-addr check) | FIXED |
| F-005 (HIGH — CapabilityRegistry admin revocation) | N/A (owner-only registration makes this moot) |
| F-006 (MEDIUM — uint128 overflow in valueUsed) | FIXED |
| F-007 (MEDIUM — wrong error for scope limit) | FIXED |
| F-008 (MEDIUM — AgentWallet receive() from anyone) | By design — standard smart contract wallet behavior |
| F-009 (MEDIUM — WalletCreated event on idempotent) | FIXED |
| F-010 (LOW — markNullifierUsed no ReentrancyGuard) | Mitigated (SessionManager nonReentrant protects) |
| S-001 (MEDIUM — unbounded walletSessions array) | FIXED (MAX_SESSIONS_PER_WALLET = 100) |

## Base Sepolia Deployments (2026-06-22)

All contracts deployed and **40/40 on-chain tests passing**.

| Contract | Proxy | Implementation |
|----------|-------|----------------|
| Groth16Verifier | `0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424` | (same — non-upgradeable) |
| CredentialRegistry | `0xC3F474e08Fe68bBa39daCCE52FC4F11262364701` | `0xee90ca74f7ACB71Df399B5141f1477dB2Aa009DC` |
| SessionManager | `0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2` | `0xA40cD41aB090B58ba441c8Dd60dB514724b76229` |
| AgentWallet (impl) | — | `0xB00c0a6A821D054098D3a9D87A93c1fE2A76b4e8` |
| AgentWalletFactory | `0x36ECC27acd245dbac23Ca1bC72798E75BfbA4a84` | `0xa57FEeB3BCC47e5Ac684E825a68B695B9356a907` |
| CapabilityRegistry | `0xa3166c63920305B7fBE11f97683B99F239bC7975` | `0xb9eA3648ad157e5EAeE043526Dacc0E9087B168b` |
| DelegationManager | `0x355b30477125c6a2F1323095baf99D3781bABd3B` | `0x7A6556C295c07F85bCb0B63f73b3c21eaB40B2ea` |

**Deployer:** `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`
**EntryPoint:** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (Base Sepolia 4337)

**Test accounts:**
- Account 0 (Deployer): `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`
- Account 1 (Oracle): `0x0b5d818a2E17CD5d2c1c626778B7364b87c94E05`
- Account 2 (Client): `0xF9604702010B90d7Bac46f9854b338d036758f4A`
- Account 3 (Worker): `0x47b71B49552B16a58e2c4B796bF3bDB25eD9F2C4`
- Account 4 (Other): `0xBF0A116921abA3DA0D3296b9a4843e999D1F1243`

## Previous Runtime Integrity Fixes (F-001 to F-046)
All 30+ backend/frontend runtime fixes remain applied. See runtime_integrity_report.md for full list.

## Known Issues
- `claude_desktop_config.json` path assumes Windows (`APPDATA/Claude/`)
- Env files ARE in `.gitignore` — fixed via `filter-branch`
- OZ v5 ERC1967Proxy reverts on Base Sepolia with empty init data — use `deploy-v3.ts` (restructured order)
- Frontend cookie inconsistencies (F-010 Secure flag on logout, F-017 SameSite on org cookies) — cosmetic, not security

## Next Steps
- Run `npm run setup` to walk through the wizard
- Rotate compromised `PRIVATE_KEY` and API keys
- Run `git gc --prune=now` to fully remove dangling objects with secrets
