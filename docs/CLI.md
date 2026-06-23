# AgentIX CLI Documentation

## Overview

The `atx` CLI provides command-line access to the AgentIX platform for agent provisioning, ZK proof generation, session management, and audit log querying.

## Installation

```bash
# From source
cd cli && npm install && npm run build

# Link globally
npm link

# Or run directly
npx tsx cli/src/index.ts
```

## Quick Start

```bash
# Initialize configuration
atx init

# Provision a new agent
atx provision --name "My Agent" --permissions 255

# Create a session (local proving)
atx session 1

# Create a session (remote proving)
atx session 1 --remote

# Generate a ZK proof
atx proof 1 --action "transfer" --file proof.json

# Verify a proof
atx verify -f proof.json

# Query audit logs
atx audit 1 --limit 10
```

## Commands

### `atx init`

Initialize `~/.agentix/config.json` with backend URL and chain config.

```bash
atx init
```

Interactive prompts for:
- Backend API URL
- RPC URL (Base Sepolia)
- Chain ID
- Credential Registry address
- Session Manager address

### `atx config`

Show current configuration.

```bash
atx config
```

Output includes backend URL, RPC URL, chain ID, contract addresses, and registered agents.

### `atx provision`

Register a new agent with the platform.

```bash
atx provision [options]

Options:
  -o, --org <id>          Existing org ID (creates new org if omitted)
  -n, --name <name>       Agent name (default: "cli-agent")
  -p, --permissions <val> Permissions bitmask (default: "1")
  -e, --expiry <seconds>  Credential expiry from now (default: "86400")
```

Example:
```bash
atx provision --name "Trading Bot" --permissions 255 --expiry 604800
```

### `atx state <agentId>`

Get agent on-chain state.

```bash
atx state 1
```

### `atx revoke <agentId>`

Revoke an agent's credential.

```bash
atx revoke 1
```

### `atx session <agentId>`

Create an on-chain session for an agent.

```bash
atx session <agentId> [options]

Options:
  -r, --remote                    Use remote proving
  -k, --session-key <address>     Existing session key address
  -a, --action <action>           Action string for remote proving
```

Examples:
```bash
# Local proving
atx session 1

# Remote proving
atx session 1 --remote

# Custom session key
atx session 1 --session-key 0x1234...
```

### `atx proof [agentId]`

Generate or verify ZK proofs.

```bash
atx proof [agentId] [options]

Options:
  -o, --org <id>           Org ID
  -a, --action <action>    Action string (default: "cli_action")
  -e, --expiry <seconds>   Proof expiry (default: "3600")
  -f, --file <path>        Proof JSON file path
  --verify                 Verify a proof file instead of generating
```

Examples:
```bash
# Generate proof
atx proof 1 --action "transfer" --file proof.json

# Verify proof
atx proof --verify -f proof.json
```

### `atx wallet [agentId]`

Create a smart wallet for an agent.

```bash
atx wallet [agentId] [options]

Options:
  -o, --owner <address>    Owner address (generates new if omitted)
```

Example:
```bash
atx wallet 1
```

### `atx circuit [command]`

Check circuit status or download verification key.

```bash
atx circuit [status|vk] [options]

Options:
  -o, --output <path>    Output file (default: "verification_key.json")
```

Examples:
```bash
# Check status
atx circuit

# Download verification key
atx circuit vk -o verification_key.json
```

### `atx audit [orgId]`

Query audit logs and statistics.

```bash
atx audit [orgId] [options]

Options:
  -s, --stats             Show statistics instead of logs
  -a, --action <action>   Filter by action
  -u, --user <id>         Filter by user ID
  -t, --type <type>       Filter by resource type
  -n, --limit <n>         Max results (default: "20")
  --search <query>        Search text
```

Examples:
```bash
# Show audit logs
atx audit 1 --limit 50

# Show statistics
atx audit 1 --stats

# Filter by action
atx audit --action "session.create.local"
```

### `atx env`

Interactive `.env` configuration wizard.

```bash
atx env
```

Walks through:
- RPC URL configuration
- Private key setup
- Contract address configuration
- Backend environment setup

### `atx query`

Query on-chain events.

```bash
atx query [options]

Options:
  -c, --contract <name>     Contract name (default: "credential")
  -i, --session-id <id>     Filter by session ID
  -w, --wallet <address>    Filter by wallet address
  -n, --limit <n>           Max results (default: "10")
```

### `atx wellknown`

Fetch the .well-known/agentix discovery document.

```bash
atx wellknown
```

### `atx verify`

Verify a proof via the standard verification endpoint.

```bash
atx verify -f <path> [options]

Options:
  -f, --file <path>           Proof JSON file (required)
  -s, --scope <scopes...>     Requested scopes to resolve
```

### `atx verify-demo`

Simulate a relying party verifying an agent proof end-to-end.

```bash
atx verify-demo
```

### `atx auth <agentId>`

Challenge-response authentication flow.

```bash
atx auth <agentId> [options]

Options:
  -s, --scope <scopes...>    Requested scopes
  -H, --header               Generate Authorization header value
  --remote                   Use remote proving
```

Examples:
```bash
# Full auth flow
atx auth 1 --scope agentix:scope:permissions

# Generate auth header only
atx auth 1 --header
```

### `atx serve`

Start a demo relying party server with Agentix auth middleware.

```bash
atx serve [options]

Options:
  -p, --port <port>    Port (default: "3456")
```

Example:
```bash
atx serve --port 8080
```

## Configuration File

Location: `~/.agentix/config.json`

```json
{
  "backendUrl": "http://127.0.0.1:3001",
  "rpcUrl": "https://base-sepolia.g.alchemy.com/v2/...",
  "chainId": 84532,
  "credentialRegistry": "0x83e0...",
  "sessionManager": "0xcC0a...",
  "agents": {
    "1": {
      "secret": "12345...",
      "orgId": 1
    }
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTIX_BACKEND_URL` | Backend API URL | http://127.0.0.1:3001 |

## Troubleshooting

### "No secret stored for agent"

Run `atx provision` first to register the agent and store the secret.

### "Invalid agent ID"

Ensure the agent ID is a valid number.

### "Circuit files not available"

Run `cd circuits && npm run build` to compile circuit files.

### "Backend not reachable"

Check that the backend is running:
```bash
curl http://localhost:3001/health
```

Update the backend URL:
```bash
atx init
```
