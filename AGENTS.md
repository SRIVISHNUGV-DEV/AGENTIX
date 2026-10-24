# AGENTS.md — working rules for this repo

## What this repo is

- The project is `agentix/`: a local-first AI agent credential protocol
  runtime (wallets, credentials, sessions, risk-bound execution).
- `contracts/` + `circuits/` are the protocol layer it talks to
  (Base Sepolia, testnet only, unaudited — see `docs/SECURITY.md`).
- There is no hosted platform in this repo anymore. The legacy
  backend/frontend tree was deleted in the 2026-10-24 cleanup; do not
  re-add it, and do not describe the project as a hosted platform.

## Rules for agents working here

1. **One component, one directory.** Do not create a parallel
   implementation of something that already exists in `agentix/`,
   `contracts/`, or `circuits/`. Edit the existing one. The pre-cleanup
   sprawl happened exactly this way (three overlapping TypeScript
   implementations of the same system).
2. **Pull requests only, never direct to `main`.** Agent work goes on a
   `muse/*` branch for human review and merge.
3. **Never commit build artifacts.** `node_modules/`, `dist/`,
   `*.tsbuildinfo`, `typechain-types/`, `circuits/build/`, `*.zkey`,
   `*.wasm`, `*.ptau`, `*.tgz` are all gitignored and must stay out.
   If a file is generated from source, it is regenerated, not committed.
4. **No report documents.** Do not write audit reports, change logs,
   freeze reports, "final" summaries, or session chronicles into the
   repo. Put durable substance in `docs/` or the component README, and
   keep it short. A document that describes a single session's work
   belongs in the chat, not the tree.
5. **No machine-specific paths.** No absolute paths to a developer's
   machine, no committed client configs with local paths or keys.
6. **Never claim a check passed without running it.** The CI pipeline
   (`.github/workflows/ci.yml`) runs the `agentix/` typecheck, tests,
   and build, plus `contracts/` compilation. Contract tests are
   deliberately not in CI (see the note in `ci.yml` about stale
   certification cases) — do not claim the contract suite is green.
7. **Honest status only.** This repo is stale (last upstream commit
   July 2026), testnet-only, and unaudited. Do not write marketing
   copy, deployment claims, or audit claims that contradict that.
