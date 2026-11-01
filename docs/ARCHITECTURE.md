# Architecture

AGENTIX is one system with two layers: a local-first runtime and the
on-chain protocol it talks to. There used to be a third layer — a hosted
control plane (Express backend, PostgreSQL, Redis, Next.js frontend) —
but it was superseded by the runtime, stopped compiling, and was deleted
in the 2026-10-24 cleanup. Do not reconstruct it from memory.

## Runtime — `agentix/`

Local-first. No server, no cloud, no PostgreSQL, no Redis. State lives
in local storage (SQLite) on the machine running it.

| Part | Contents |
|---|---|
| `agentix/src/` | `core/` (event bus, services wiring), `mcp/` (MCP server), `runtime/` (server, bundler + risk gate), `tools/`, `sdk/`, `blockchain/`, `compiler-gateway.ts`, `trees/`, `types.d.ts`, `utils/` |
| `agentix/packages/` | `shared/`, `core/`, `services/`, `compiler/`, `scheduler/`, `merkle-tree/`, `agent-manifest/` |
| `agentix/apps/dashboard/` | Local dashboard (Next.js), served by the runtime |
| `agentix/bin/` | CLI entry points (`agentix`, `agentix-mcp`) |
| `agentix/tests/` | Vitest suites + e2e, run sequentially (suites share one SQLite file) |

Flow for an agent action: validate against credentials and capabilities
→ check session and time bounds → check budgets and limits → simulate
and risk-score → explain the outcome → only then touch the chain.
The runtime API binds to `127.0.0.1` and has no authentication: it
trusts every local caller.

## Protocol — `contracts/` + `circuits/`

| Contract | Role |
|---|---|
| `CredentialRegistry` | Merkle roots for active and revoked credential trees, nullifier tracking |
| `SessionManager` | ZK + lightweight sessions, spend limits |
| `CapabilityRegistry` | Capability definitions and grants |
| `DelegationManager` | Delegation chains |
| `OrganizationRegistry` / `OrganizationCredentialAnchor` | Organisation onboarding and per-org trust domains |
| `AgentWallet` / `AgentWalletFactory` | ERC-4337 smart account, deterministic deployment |
| `CredentialVerifierV1` | Groth16 verifier generated from the circuit |
| `AgentIdentity` | On-chain agent identity |

The circuit is `circuits/credential_V1.circom` (Groth16, BN128, Merkle
depth 20, 7 public signals: active root, revoked root, max value,
session expiry, wallet, credential version, nullifier). The verifier
contract and proving artifacts are generated from it — see
`circuits/artifacts.manifest.json` for the circuit's parameters.

Trust assumptions, including the centralised organisation administrator,
are in `docs/PROTOCOL_ASSUMPTIONS.md` and `contracts/PROTOCOL_ASSUMPTIONS.md`.
