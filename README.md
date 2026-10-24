# AGENTIX — Local-first credential runtime for AI agents

AGENTIX gives AI agents smart wallets, credentials, sessions, and
risk-bound execution — without exposing private keys, without a central
server, and without trusting the agent. Every action is validated,
simulated, risk-scored, and explained before it touches the chain.

It answers, for any agent action:

- **WHO** can act? → credentials and identity
- **WHAT** can they do? → capabilities and permissions
- **WHEN** can they do it? → sessions and expiry
- **HOW MUCH** can they spend? → budgets and limits
- **FOR HOW LONG** can they operate? → time bounds
- **UNDER WHAT CONSTRAINTS** can they execute? → policies and scope

## Status — read this first

- **Stale, not production.** The last upstream commit is July 2026. This
  repository is being kept neat and findable; it is not a maintained
  product, and nothing here should be presented as one.
- **Testnet only.** The contracts live on Base Sepolia. Deployed addresses
  are recorded in `contracts/deployments/baseSepolia-84532.json`.
- **Unaudited.** The contracts have no independent professional security
  audit. See `docs/SECURITY.md` before putting anything of value near them.
- **Local-first.** The runtime binds to `127.0.0.1` and has no
  authentication — it trusts every local caller. Do not expose it to a
  network.

## Layout

| Path | What it is |
|---|---|
| `agentix/` | The runtime. This is the project. `src/` (core, MCP server, runtime, tools, SDK, blockchain, compiler gateway), `packages/` (shared, core, services, compiler, indexer, scheduler, merkle-tree, agent-manifest), `apps/dashboard/` (local dashboard), `tests/`, `bin/` (CLI entry points). Its own README is `agentix/README.md`. |
| `contracts/` | The protocol contracts (Solidity): credential registry, session manager, capability registry, delegation manager, organisation registry, agent wallet + factory, Groth16 verifier. Tests under `contracts/test/`, deployment scripts under `contracts/scripts/`. |
| `circuits/` | The ZK circuit: `credential_V1.circom` (Groth16, BN128, Merkle depth 20). Build artifacts are generated from source and are not committed. |
| `docs/` | `ARCHITECTURE.md`, `SETUP.md`, `SECURITY.md`, `PROTOCOL_ASSUMPTIONS.md`. That is the whole documentation set — if a doc is not here, it does not exist. |

One rule for the whole tree: **one component, one directory, one README
at most.** Report-style documents (audits of audits, change logs,
"final" summaries) do not live in this repo.

## Quick start

```bash
cd agentix
bun install
bun run build
bun x tsx src/index.ts init
bun run serve
```

`serve` prints the URLs it picks (dashboard and API, defaulting to
`127.0.0.1:3000` / `:3001`, falling back to the next free port).
Full setup is in `docs/SETUP.md`.

Contracts:

```bash
cd contracts
npx hardhat compile
```

## Cleanup (2026-10-24, branch `muse/agentix-cleanup`)

This tree is the result of a cleanup of the July 2026 state, which had
grown to 2,051 files across three overlapping TypeScript
implementations of the same system (`backend/`, `orchestrator/`, and
`agentix/`), plus committed `node_modules`, generated ZK artifacts,
packaged tarballs, and dozens of agent-written report files at the root.

What was removed from this branch (all of it still exists in git history
and in the pull request diff — nothing on `main` changed until the PR is
merged):

- The legacy hosted-platform tree (`backend/`, `frontend/`, `sdk/`,
  `cli/`, `orchestrator/`, `mcp-test/`, `runtime-local/`, root
  `scripts/`, Docker Compose files). The repo's own CI had already
  stopped building it: it had not compiled in weeks and was superseded
  by `agentix/`.
- Committed build artifacts: `node_modules/` trees, `*.tsbuildinfo`,
  generated `typechain-types/`, `circuits/build/`, `*.zkey` / `*.wasm` /
  `*.tgz` files, stale root lockfiles.
- Agent report sprawl: root audit/change-log/freeze-report files,
  `docs/` pages describing the deleted legacy tree, and contract
  "audit" reports that were agent-produced files presented as a
  professional audit (see `docs/SECURITY.md`).
- Machine-specific config: MCP client configs pointing at Windows
  absolute paths on a previous developer machine.

What was kept: the `agentix/` runtime untouched in structure, the
contracts and circuit sources, the deployed-address record, and the
substance docs (protocol assumptions, user model, runtime README).
