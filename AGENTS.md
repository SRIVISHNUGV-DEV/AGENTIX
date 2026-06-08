# AGENTS.md — Session Context

## Current Focus
Setup wizard for first-time users. Created `setup.mjs` interactive CLI.

## Recent Changes
- Added `setup.mjs` — interactive wizard for configuring all .env files, AI provider API keys, Docker services, and MCP client
- Added `"setup": "node setup.mjs"` script to root `package.json`
- Added `.mcp.json` — project-scoped config for Claude Code (+ Cursor, Windsurf, VS Code)
- Added `opencode.json` — config for OpenCode with env var passing
- Updated `setup.mjs` step 7 to generate MCP configs for 7 platforms: Claude Desktop, Claude Code, OpenCode, Cursor, VS Code, Windsurf, JetBrains
- Generates `mcp-configs.json` reference file with all platform configs
- Updated server banner and help text to list all compatible clients

## Known Issues
- `claude_desktop_config.json` path assumes Windows (`APPDATA/Claude/`)
- Circuit files (`circuits/build/credential.wasm`, `.zkey`) not included — prover runs in simulated mode
- Env files ARE now in `.gitignore` — was fixed via `filter-branch`

## Next Steps
- Run `npm run setup` to walk through the wizard
- Rotate compromised `PRIVATE_KEY` and API keys (old keys tracked in git before filter-branch purge)
- Run `git gc --prune=now` to fully remove dangling objects with secrets
