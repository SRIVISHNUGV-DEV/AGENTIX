# Setup

Prerequisites: Bun (the runtime's toolchain), Node 18+ for the
contracts tooling.

## Runtime

```bash
cd agentix
bun install
bun run build
bun x tsx src/index.ts init
bun run serve
```

- `init` is deliberately non-invasive: it sets up local storage and the
  database but does not modify external tool configuration.
- `serve` prints the URLs it picks (dashboard and API, defaulting to
  `127.0.0.1:3000` / `:3001`, falling back to the next free port).
- To wire AI harnesses (Claude Code, Cursor, …) into AgentIX, run
  `bun x tsx src/index.ts connect` — this edits their MCP configs, so
  it is opt-in only.
- Other useful commands (from `agentix/package.json`): `bun run test`
  (e2e + vitest), `bun run test:unit`, `bun run dev` (API + dashboard
  via `scripts/serve.ts`), `bun run doctor`, `bun run diagnostics`.

## Contracts

```bash
cd contracts
npx hardhat compile
```

Deployment scripts live in `contracts/scripts/`; the Base Sepolia
deployment record is `contracts/deployments/baseSepolia-84532.json`.
Contract tests are under `contracts/test/` (Foundry, fuzz, invariants,
adversarial, migration). Note the CI caveat: CI compiles the contracts
but does not run `hardhat test`, because the V1 certification suite has
stale cases asserting against changed interfaces — see the note in
`.github/workflows/ci.yml`. Do not claim the contract suite is green
until that suite is updated.

## Circuits

The circuit source is `circuits/credential_V1.circom`. Proving artifacts
(`.zkey`, `.wasm`, `.ptau`) are generated from source and are not
committed; regenerate them with the circuit's own tooling rather than
copying binaries from anywhere.
