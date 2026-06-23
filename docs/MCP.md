# AgentIX MCP Server Documentation

## Overview

The AgentIX MCP (Model Context Protocol) server provides AI assistants with tools to manage agent credentials, generate ZK proofs, and query on-chain state.

**Compatible with:** Claude Desktop, Claude Code, OpenCode, Cursor, VS Code, Windsurf, JetBrains, Cline

## Installation

```bash
# From npm
npx @agentix/mcp

# From source
git clone https://github.com/your-org/agentix
cd agentix/mcp-test
npm install
npm run build
```

## Quick Start

```bash
# Stdio mode (for Claude Desktop)
npx @agentix/mcp start

# HTTP mode (for web clients)
npx @agentix/mcp start --http --port 3100

# Install for Claude Desktop
npx @agentix/mcp add claude
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Ethereum RPC URL | Alchemy demo |
| `PRIVATE_KEY` | Wallet private key | — |
| `CHAIN_ID` | Chain ID | 84532 (Base Sepolia) |
| `NETWORK_NAME` | Network name | sepolia |
| `VERIFIER_ADDRESS` | Groth16Verifier address | Deployed address |
| `CREDENTIAL_REGISTRY_ADDRESS` | CredentialRegistry address | Deployed address |
| `SESSION_MANAGER_ADDRESS` | SessionManager address | Deployed address |
| `CAPABILITY_REGISTRY_ADDRESS` | CapabilityRegistry address | Deployed address |
| `DELEGATION_MANAGER_ADDRESS` | DelegationManager address | Deployed address |
| `AGENT_WALLET_FACTORY_ADDRESS` | AgentWalletFactory address | Deployed address |
| `ENTRY_POINT_ADDRESS` | ERC-4337 EntryPoint address | Deployed address |

### MCP Client Configuration

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentix": {
      "command": "npx",
      "args": ["@agentix/mcp", "start"]
    }
  }
}
```

#### Cursor / VS Code

Add to `.vscode/settings.json` or Cursor settings:

```json
{
  "mcp.servers": {
    "agentix": {
      "command": "npx",
      "args": ["@agentix/mcp", "start"]
    }
  }
}
```

## Available Tools

### Agent Management

| Tool | Description |
|------|-------------|
| `register_agent` | Register a new AI agent with an organization |
| `list_agents` | List all agents for an organization |
| `get_agent_state` | Get agent state including credentials |
| `revoke_agent` | Revoke an agent's credentials |

### Capability Management

| Tool | Description |
|------|-------------|
| `create_capability` | Create a named capability (permission) |
| `list_capabilities` | List all capabilities for an org |
| `grant_capability` | Grant a capability to an agent |
| `revoke_grant` | Revoke a capability grant |
| `check_capability` | Check if agent has a capability |
| `list_agent_grants` | List grants for an agent |

### Delegation Management

| Tool | Description |
|------|-------------|
| `create_delegation` | Create a delegation chain |
| `revoke_delegation` | Revoke a delegation |
| `check_delegation` | Check delegation permission |
| `get_delegation_chain` | Trace full delegation chain |

### ZK Proofs

| Tool | Description |
|------|-------------|
| `generate_proof` | Generate Groth16 ZK proof |
| `verify_proof` | Verify a ZK proof |

### Chain Discovery

| Tool | Description |
|------|-------------|
| `get_chains` | List configured chains |
| `get_chain_contracts` | Get deployed contract addresses |

### Agent Liveness

| Tool | Description |
|------|-------------|
| `heartbeat` | Update agent heartbeat timestamp |

## Usage Examples

### Register an Agent

```json
{
  "tool": "register_agent",
  "arguments": {
    "orgId": 1,
    "agentType": "langchain",
    "name": "My Trading Bot"
  }
}
```

### Generate a ZK Proof

```json
{
  "tool": "generate_proof",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "action": "transfer",
    "expirySeconds": 3600
  }
}
```

### Check Capability

```json
{
  "tool": "check_capability",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "action": "transfer"
  }
}
```

### Create Delegation

```json
{
  "tool": "create_delegation",
  "arguments": {
    "orgId": 1,
    "delegatorAgentId": 1,
    "delegateAgentId": 2,
    "scope": { "action": "transfer", "maxValue": "1000000000000000000" },
    "expiresAt": 1735689600,
    "maxDepth": 3
  }
}
```

## Prover Backends

The MCP server supports two ZK prover backends:

1. **rapidsnark (WSL)** — ~10x faster, requires WSL with rapidsnark installed
2. **snarkjs** — Pure JavaScript fallback, slower but works everywhere

Circuit files must be in `circuits/build/`:
- `credential.wasm` — Circuit WASM
- `*.zkey` — Proving key
- `verification_key.json` — Verification key

## Health Check

```bash
curl http://localhost:3100/health
```

Returns:
```json
{
  "status": "ok",
  "prover": {
    "available": true,
    "rapidsnarkAvailable": false,
    "snarkjsAvailable": true
  }
}
```

## Troubleshooting

### "No circuit files found"

Ensure circuit files exist in `circuits/build/`. Run:
```bash
cd circuits && npm run build
```

### "rapidsnark not available"

Install rapidsnark in WSL:
```bash
wsl sudo apt-get install -y rapidsnark
```

Or use snarkjs fallback (slower but works).

### MCP server won't start

Check that port is not in use:
```bash
lsof -i :3100
```

Use a different port:
```bash
npx @agentix/mcp start --http --port 3200
```
