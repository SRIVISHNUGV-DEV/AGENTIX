# Deployment Instructions

## Prerequisites
- Node.js >= 18.0.0
- npm or yarn
- Base Sepolia ETH for gas (if executing on-chain)

## Quick Start

```bash
cd agentix
npm install
npm run build
```

## Initialize Runtime

```bash
node dist/src/index.js init
```

This creates `~/.agentix/` with all required directories and SQLite database.

## Configure RPC

```bash
node dist/src/index.js config set rpcUrl https://sepolia.base.org
```

## Start Dashboard

```bash
# Terminal 1: API server
node dist/src/runtime/server.js

# Terminal 2: Next.js dashboard
cd apps/dashboard && npm install && npm run dev
```

Dashboard: http://localhost:3000
API: http://localhost:3001

## Start MCP Server (for IDE integration)

```bash
node dist/src/mcp/index.js add
```

## Verify Installation

```bash
node dist/src/index.js doctor
node dist/src/index.js diagnostics
```

## Production Deployment

For production, build the Next.js dashboard:

```bash
cd apps/dashboard
npm run build
npm start
```

The API server runs standalone without Next.js.

## Environment Variables

```bash
AGENTIX_PRIVATE_KEY=0x...       # Wallet private key (for on-chain operations)
AGENTIX_DASHBOARD_PORT=3001     # API server port (default: 3001)
```

## Data Location

All data is stored locally at `~/.agentix/`:

```
~/.agentix/
├── config/agentix.config.json   # Configuration
├── db/agentix.db                # SQLite database
├── backups/                     # Backup files
├── logs/                        # Application logs
├── trees/                       # Merkle tree snapshots
└── ...                          # Other directories
```
