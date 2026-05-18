# SDK

The SDK is the self-hosted / direct integration surface for teams that do not want to use only the hosted-looking frontend.

Main source files:

- `src/AgentClient.ts`
- `src/SessionManager.ts`
- `src/types.ts`

## What It Does

The SDK can be used to:

- register and manage agents
- fetch proof bundles from the backend
- generate session proofs
- create sessions
- create wallets

## Example

See:

- `examples/create-session.ts`
- `examples/perform-action.ts`

## Install

From the repo root:

```powershell
npm install --workspaces
```

## Build

```powershell
cd sdk
npm run build
```

## Notes

The SDK still depends on the backend for:

- organization and agent state
- contract addresses
- Merkle and sparse-tree proof bundles
- blockchain submission paths
