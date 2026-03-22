# Quickstart

This document covers the shortest path to:

1. start the backend
2. start the frontend
3. start both together with one command
4. redeploy the smart contracts after contract or circuit changes
5. update the backend so the whole platform points at the new deployment

The repo structure assumed below:

- `backend/`
- `frontend/`
- `contracts/`
- `circuits/`
- `scripts/`

## 1. Prerequisites

You need:

- Node.js installed
- npm installed
- a funded Sepolia deployer key
- an Alchemy Sepolia RPC URL

Recommended versions:

- Node 20+ or 22+

## 2. Install Dependencies

From the repo root:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp"
npm install --workspaces
```

If you only want to install per package:

```powershell
cd backend
npm install

cd ..\frontend
npm install

cd ..\contracts
npm install
```

## 3. Start Everything With One Command

From the repo root:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp"
npm run dev
```

That starts:

- backend on `http://127.0.0.1:3000`
- frontend on `http://127.0.0.1:3001`

If one of them is already running, the launcher will reuse it instead of failing.

Direct shortcut:

```powershell
.\scripts\start-dev.cmd
```

Logs:

- `backend/.backend.out.log`
- `backend/.backend.err.log`
- `frontend/.frontend.out.log`
- `frontend/.frontend.err.log`

## 4. Environment Setup

The deploy script reads from `backend/.env`.

Minimum backend env values:

```env
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
PRIVATE_KEY=YOUR_DEPLOYER_PRIVATE_KEY
CHAIN_ID=11155111
NETWORK_NAME=sepolia

SESSION_MANAGER_ADDRESS=
CREDENTIAL_REGISTRY_ADDRESS=
AGENT_WALLET_FACTORY_ADDRESS=
AGENT_WALLET_IMPLEMENTATION_ADDRESS=
```

Frontend env:

File: `frontend/.env.local`

```env
NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=http://127.0.0.1:3000
```

## 5. Start The Backend Only

From the repo root:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\backend"
..\node_modules\.bin\tsx.cmd src\index.ts
```

Or:

```powershell
npm run start
```

Expected URL:

- `http://127.0.0.1:3000`

Useful backend checks:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3000/orgs" -Method Get
Invoke-WebRequest -Uri "http://127.0.0.1:3000/agents" -Method Get
```

## 6. Start The Frontend Only

From the repo root:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\frontend"
npx next dev --webpack --hostname 127.0.0.1 --port 3001
```

Expected URL:

- `http://127.0.0.1:3001`

The frontend is configured to call:

- `http://127.0.0.1:3000`

through `frontend/.env.local`.

## 7. How To Use The App

Minimal operator flow:

1. run `npm run dev`
2. open `http://127.0.0.1:3001`
3. click `Connect Wallet`
4. switch to Sepolia if needed
5. create an organization
6. add an agent
7. deploy org contracts
8. open the agent page
9. create credential, wallet, fund wallet, create session, or revoke credential

The UI now adds Sepolia Etherscan links anywhere a transaction hash is shown, so operators can check what happened on-chain immediately.

## 8. How The MVP Access Model Works

The current MVP path is wallet-based, not full org auth.

What that means:

- open the frontend
- click `Connect Wallet`
- switch to Sepolia if needed
- platform action buttons become enabled only when:
  - a wallet is connected
  - the wallet is on Sepolia

The connected wallet is the operator wallet for the organization.
Every on-chain action now requires a fresh wallet signature before the backend submits the transaction.

## 9. Redeploy Smart Contracts After Changes

Use this whenever you change:

- `contracts/src/*.sol`
- `circuits/build/verifier.sol`
- circuit proving artifacts that change the verifier

### 9.1 If The Circuit Changed

If you rebuilt the circuit and regenerated the verifier:

1. make sure these exist:
   - `circuits/build/credential_final.zkey`
   - `circuits/build/verification_key.json`
   - `circuits/build/verifier.sol`

2. copy the generated verifier into the contracts source:

```powershell
Copy-Item `
  "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\circuits\build\verifier.sol" `
  "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\contracts\src\Verifier.sol" `
  -Force
```

### 9.2 Rebuild Solidity Artifacts

This repo has both Hardhat sources and direct ABI/BIN artifacts used by the deploy script.

If you are using the current deploy flow, the important outputs are the `.abi` and `.bin` files in `contracts/`.

If Hardhat works on your machine:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\contracts"
npm install
npm run compile
```

If you are using the existing direct artifact path, make sure the current contract ABIs/BINs in `contracts/` are regenerated before deployment.

The deploy script currently resolves either:

- `contracts_<name>.abi/.bin`
- or `src_<name>.abi/.bin`

and prefers the `contracts_*.abi/.bin` form when present.

### 9.3 Deploy To Sepolia

From the repo root:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp"
node contracts\scripts\deploy-ethers.js
```

That script:

- reads `backend/.env`
- deploys:
  - `Verifier`
  - `CredentialRegistry`
  - `SessionManager`
  - `AgentWallet`
  - `AgentWalletFactory`
- wires `CredentialRegistry.setSessionManager(...)`

Expected output shape:

```json
{
  "deployer": "0x...",
  "verifier": "0x...",
  "credentialRegistry": "0x...",
  "sessionManager": "0x...",
  "agentWalletImplementation": "0x...",
  "agentWalletFactory": "0x..."
}
```

## 10. Update Backend After Redeploy

Write the newly deployed addresses into `backend/.env`:

```env
SESSION_MANAGER_ADDRESS=0x...
CREDENTIAL_REGISTRY_ADDRESS=0x...
AGENT_WALLET_FACTORY_ADDRESS=0x...
AGENT_WALLET_IMPLEMENTATION_ADDRESS=0x...
```

Then restart the backend.

## 11. Verify End-To-End After Redeploy

### Backend checks

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3000/orgs" -Method Get
Invoke-WebRequest -Uri "http://127.0.0.1:3000/agents" -Method Get
Invoke-WebRequest -Uri "http://127.0.0.1:3000/events?limit=5" -Method Get
```

### Frontend checks

Open:

- `http://127.0.0.1:3001`
- `http://127.0.0.1:3001/dashboard`
- `http://127.0.0.1:3001/agents`
- `http://127.0.0.1:3001/events`

### Full platform flow

1. connect wallet in the frontend
2. create or open an organization
3. deploy org contracts
4. create or connect an agent
5. create credential
6. create wallet
7. create session
8. fund org or fund single agent
9. revoke credential if needed
10. verify events appear in the dashboard

## 12. Useful Dev Commands

Backend typecheck:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\backend"
..\node_modules\.bin\tsc.cmd -p tsconfig.json
```

Frontend typecheck:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\frontend"
.\node_modules\.bin\tsc.cmd --noEmit
```

Frontend production build:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\frontend"
.\node_modules\.bin\next.cmd build
```

Backend dev:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\backend"
npm run dev
```

Frontend dev:

```powershell
cd "d:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp\frontend"
npx next dev --webpack --hostname 127.0.0.1 --port 3001
```

## 13. Common Failure Modes

### `Invalid proof`

Usually means one of:

- `contracts/src/Verifier.sol` does not match `circuits/build/credential_final.zkey`
- old ABI/BIN artifacts were deployed instead of fresh ones
- backend is still pointing at old contract addresses

### `Invalid expiry`

Usually means:

- local machine time assumptions differ from chain time
- session expiry is too close to the current block time

Use a comfortably future timestamp.

### Frontend shows data but actions fail

Check:

- wallet connected
- Sepolia selected
- backend running on `3000`
- `frontend/.env.local` points to `http://127.0.0.1:3000`

### Backend starts but chain actions fail

Check:

- `RPC_URL`
- `PRIVATE_KEY`
- deployer wallet funded on Sepolia
- contract addresses in `backend/.env`

## 14. Recommended Redeploy Sequence

If you change both circuits and contracts, use this order:

1. rebuild circuit
2. regenerate verifier
3. copy `circuits/build/verifier.sol` to `contracts/src/Verifier.sol`
4. regenerate contract artifacts
5. deploy with `node contracts\scripts\deploy-ethers.js`
6. update `backend/.env`
7. restart backend
8. restart frontend
9. run the platform flow again
