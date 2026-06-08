# agentix-mcp-test

**Standalone MCP server** for the Agentix platform — provides tools for agent lifecycle management, capability/authorization control, delegation chains, chain discovery, and ZK proof generation.

Compatible with all MCP clients: Claude Desktop, Claude Code, OpenCode, Cursor, VS Code, Windsurf, JetBrains, Cline, Continue.dev.

## Quick Start

```bash
# Run directly (stdio mode)
npx agentix-mcp-test

# Or using the short alias (requires global install)
amt

# Auto-detect and install for all MCP clients on your machine
npx agentix-mcp-test add
# or: amt add

# Install for a specific client
npx agentix-mcp-test add claude-code
# or: amt add claude-code
amt add project   # .mcp.json in current dir
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `amt` (or `agentix-mcp-test`) | Start server in stdio mode (default) |
| `amt add [platform]` | Install the MCP server for detected platforms |
| `amt remove` | Remove from all platforms |
| `amt status` | Check installation status |
| `amt start` | Start the MCP server |
| `amt --http` | Start in HTTP mode |
| `amt --http --port 8080` | Custom HTTP port |

### Auto-detected platforms

`add` without arguments detects and installs to:
- Claude Code
- OpenClaude
- Cursor
- Cline
- Windsurf/Codeium
- VS Code
- JetBrains
- Project `.mcp.json`

## Usage

### Stdio transport (default)

```bash
amt
# or: npx agentix-mcp-test
```

### HTTP transport

```bash
amt --http
amt --http --port 8080
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAIN_ID` | `84532` | Ethereum chain ID (Base Sepolia) |
| `NETWORK_NAME` | `sepolia` | Network label |
| `RPC_URL` | `https://base-sepolia.g.alchemy.com/v2/demo` | JSON-RPC endpoint |
| `VERIFIER_ADDRESS` | *(hardcoded Base Sepolia)* | Verifier contract |
| `CREDENTIAL_REGISTRY_ADDRESS` | *(hardcoded Base Sepolia)* | Credential registry |
| `SESSION_MANAGER_ADDRESS` | *(hardcoded Base Sepolia)* | Session manager |
| `CAPABILITY_REGISTRY_ADDRESS` | *(hardcoded Base Sepolia)* | Capability registry |
| `DELEGATION_MANAGER_ADDRESS` | *(hardcoded Base Sepolia)* | Delegation manager |
| `AGENT_WALLET_FACTORY_ADDRESS` | *(hardcoded Base Sepolia)* | Agent wallet factory |
| `ENTRY_POINT_ADDRESS` | *(hardcoded Base Sepolia)* | ERC-4337 entry point |
| `PORT` | `3100` | HTTP server port |
| `CIRCUIT_DIR` | *(built-in)* | Override path to ZK circuit files |

All contract addresses have hardcoded Base Sepolia defaults — you only need to set them if you deployed your own contracts.

## ZK Proofs

**Groth16 proofs work out of the box.** The package bundles `credential.wasm` (~2.9 MB) and `credential_final.zkey` (~7.2 MB). No setup needed.

To use your own circuits, set `CIRCUIT_DIR` to a directory with a `.wasm` and `.zkey` file.

## Tools

| Tool | Description |
|------|-------------|
| `register_agent` | Register a new test agent |
| `list_agents` | List agents for an organization |
| `get_agent_state` | Get agent state |
| `revoke_agent` | Delete an agent |
| `create_capability` | Create a capability definition |
| `list_capabilities` | List capability definitions |
| `grant_capability` | Grant a capability to an agent |
| `revoke_grant` | Revoke a capability grant |
| `check_capability` | Check if an agent has a capability |
| `list_agent_grants` | List grants for an agent |
| `create_delegation` | Create a delegation |
| `revoke_delegation` | Revoke a delegation |
| `check_delegation` | Check delegation permission |
| `get_delegation_chain` | Trace delegation chain |
| `get_chains` | List blockchain chains |
| `get_chain_contracts` | Get contract addresses |
| `generate_proof` | Generate a ZK proof |
| `verify_proof` | Verify a ZK proof |
| `heartbeat` | Update agent heartbeat |

## Standalone Package

This folder is fully self-contained — no dependencies on files outside `mcp-test/`. You can publish it directly to npm:

```bash
cd mcp-test
npm publish
```

Users install with one command: `npx agentix-mcp-test` (or `amt` if installed globally)

## Development

```bash
cd mcp-test
npm install
npm run build
npm start
```

## License

MIT
