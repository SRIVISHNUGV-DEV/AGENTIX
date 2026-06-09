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

## Known Issues
- `claude_desktop_config.json` path assumes Windows (`APPDATA/Claude/`)
- Env files ARE now in `.gitignore` — was fixed via `filter-branch`
- Pre-existing TS compilation errors in `audit.ts`, `delegation.ts`, `rateLimiter.ts` are unrelated

## Next Steps
- Run `npm run setup` to walk through the wizard
- Rotate compromised `PRIVATE_KEY` and API keys (old keys tracked in git before filter-branch purge)
- Run `git gc --prune=now` to fully remove dangling objects with secrets
- Deploy contracts and test on-chain proof verification on Base Sepolia
