# Security — honest status

## No independent professional audit

The contracts in `contracts/src/` have **no independent professional
security audit**. An earlier file in this repo presented itself as a
"Professional Smart Contract Audit Report" (MiMoCode, 2026-06-29). That
file was agent-produced, not an independent audit, and it was removed in
the 2026-10-24 cleanup precisely because the label was misleading.

What that internal review did record, at the time, was 2 HIGH and 5
MEDIUM findings listed as open, with 0 marked fixed. That is a stale
internal note, not a current verdict — later hardening work may have
addressed some of it, and nothing here verifies that. Treat the
contracts as unaudited until a real audit is done and its findings are
closed.

## Do not put value near this code

- **Testnet only.** Base Sepolia. No mainnet deployment, no real funds.
- **Unaudited + upgradeable.** Most contracts are UUPS-upgradeable,
  which means an upgrade-key compromise can replace the logic.
- **Centralised administration.** `OrganizationRegistry` is owned by a
  single administrator who registers/deactivates organisations and
  proposes credential-anchor updates (see
  `docs/PROTOCOL_ASSUMPTIONS.md`). Compromise of that key compromises
  organisation lifecycle management.
- **Local runtime trusts local callers.** The `agentix/` API binds to
  `127.0.0.1` and has no authentication. Never expose its port to a
  network, and never run it on a shared machine as if it were
  authenticated.
- **Dependency advisories.** The runtime's ZK proving path uses
  `snarkjs`, whose transitive dev-tooling dependencies carry published
  DoS-class advisories. Per the runtime README, those packages are not
  reachable from the proving path (`groth16.fullProve`), but `bun audit`
  will flag them until upstream updates.

## What was removed and why

The 2026-10-24 cleanup deleted the contract "audit" reports rather than
keeping them with a corrected label, because keeping a file titled as a
professional audit — even with a disclaimer — invites exactly the
misreading that happened before. If a real audit happens, its report
belongs here under its auditor's name, with findings and fix status.
