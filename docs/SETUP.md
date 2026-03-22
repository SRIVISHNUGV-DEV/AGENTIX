# Agentix Setup

## Required Environment

Backend environment file:

- `backend/.env`

Minimum values:

```env
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
PRIVATE_KEY=YOUR_SEPOLIA_DEPLOYER_PRIVATE_KEY
CHAIN_ID=11155111
NETWORK_NAME=sepolia
SESSION_MANAGER_ADDRESS=
CREDENTIAL_REGISTRY_ADDRESS=
AGENT_WALLET_FACTORY_ADDRESS=
AGENT_WALLET_IMPLEMENTATION_ADDRESS=
```

Frontend environment file:

- `frontend/.env.local`

```env
NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=http://127.0.0.1:3000
```

## Install

From the repo root:

```powershell
npm install --workspaces
```

## Start

Simplest:

```powershell
npm run dev
```

Manual:

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npx next dev --webpack --hostname 127.0.0.1 --port 3001
```

## Redeploy Contracts

When contracts or verifier change:

1. update `contracts/src/Verifier.sol` if the circuit verifier changed
2. rebuild contract artifacts
3. run:

```powershell
node contracts\scripts\deploy-ethers.js
```

4. copy the new addresses into `backend/.env`
5. restart the backend

## Validate

Check:

- `http://127.0.0.1:3000/orgs`
- `http://127.0.0.1:3001`
- `http://127.0.0.1:3001/dashboard`

For the complete flow, use `quickstart.md`.
