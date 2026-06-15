# AGENTS.md — Session Context

## Current Focus
ZK proof pipeline — eliminated all stub/simulated proofs. Real Groth16 proofs everywhere.

## Recent Changes
- Added `setup.mjs` — interactive wizard for configuring all .env files, AI provider API keys, Docker services, and MCP client
- Added `"setup": "node setup.mjs"` script to root `package.json`
- Added `.mcp.json` — project-scoped config for Claude Code (+ Cursor, Windsurf, VS Code)
- Added `opencode.json` — config for OpenCode with env var passing
- Updated `setup.mjs` step 7 to generate MCP configs for 7 platforms: Claude Desktop, Claude Code, OpenCode, Cursor, VS Code, Windsurf, JetBrains
- Generates `mcp-configs.json` reference file with all platform configs
- Updated server banner and help text to list all compatible clients
- **Fixed ZK proof pipeline** — removed all stub/simulated proofs from MCP server (`mcp-test/src/server.ts`), backend (`backend/src/services/externalAgent.ts`), and prover (`backend/src/services/prover.ts`, `backend/src/services/fastProver.ts`)
- **Added rapidsnark WSL prover** (`mcp-test/src/circuits.ts`, `backend/src/services/fastProver.ts`) — generates witness via WSL node then proves via rapidsnark; falls back to snarkjs
- **Fixed circuit path resolution** — checks `circuits/build/`, MCP-local `circuits/`, env vars
- **Fixed DB query** — `externalAgent.ts` now joins `agents` table to fetch `managed_secret`
- **Real proof verification** — `verify_proof` and `verifyAuthorizationProof` now use `groth16.verify()` with `verification_key.json`
- **Installed rapidsnark** in WSL at `/usr/local/bin/rapidsnark` (built from source at `/tmp/rapidsnark/`)
- **Fixed path quoting** — all WSL paths with spaces are double-quoted in execSync commands
- **Fixed rapidsnark detection** — uses `wsl command -v rapidsnark` (no `/dev/null` redirect)

## Base Sepolia Deployments (2026-06-15)

All contracts deployed and **36/36 on-chain tests passing**.

| Contract | Proxy | Implementation |
|----------|-------|----------------|
| Groth16Verifier | `0x6cBbB06df8Ddc8D28992F5149C755aAe0E0EB61f` | (same — non-upgradeable) |
| CredentialRegistry | `0x83e0e671c0D31a288B93B9F04B7c4e116a065F5c` | `0x6CF1D9a456aeD678a8057E49248aAe808B2fbeC8` |
| SessionManager | `0xcC0a3400397F8A54e54DA2c7A703bC5B27354C58` | `0x98aB9cb51B939E32F5a4831330a0eb6443B3B17f` |
| AgentWallet | — | `0x31448C7ca90c675F7f0631AF8A6a8627758E1e9A` |
| AgentWalletFactory | `0x6313d16266FB2e60c8Ef142274e317878ba71677` | `0xEE1AB568CFe99C9113eF4abABf6dE9314aF729F2` |
| CapabilityRegistry | `0xA5624939Fd99ed689Bc564FB2a09B3bc59198297` | `0xaf733b08541A6040A7704AB55340469498a83024` |
| DelegationManager | `0xa52e7C76811FAAC1514712eb0137d8f1631202DA` | `0x301f5a115f5EC84396875312Af0fB231EC7988aD` |

**Deployer:** `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`
**EntryPoint:** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (Base Sepolia 4337)

**Test accounts (from mnemonic):**
- Account 0 (Deployer): `0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC`
- Account 1 (Oracle): `0x0b5d818a2E17CD5d2c1c626778B7364b87c94E05`
- Account 2 (Client): `0xF9604702010B90d7Bac46f9854b338d036758f4A`
- Account 3 (Worker): `0x47b71B49552B16a58e2c4B796bF3bDB25eD9F2C4`
- Account 4 (Other): `0xBF0A116921abA3DA0D3296b9a4843e999D1F1243`

## Known Issues
- `claude_desktop_config.json` path assumes Windows (`APPDATA/Claude/`)
- Env files ARE now in `.gitignore` — was fixed via `filter-branch`
- Pre-existing TS compilation errors in `audit.ts`, `delegation.ts`, `rateLimiter.ts` are unrelated

## Next Steps
- Run `npm run setup` to walk through the wizard
- Rotate compromised `PRIVATE_KEY` and API keys (old keys tracked in git before filter-branch purge)
- Run `git gc --prune=now` to fully remove dangling objects with secrets
- Deploy contracts and test on-chain proof verification on Base Sepolia
