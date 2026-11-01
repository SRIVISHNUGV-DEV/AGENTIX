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
- **Dependency advisories.** The runtime's ZK proving path uses
  `snarkjs`, whose transitive dev-tooling dependencies carry published
  DoS-class advisories. Per the runtime README, those packages are not
  reachable from the proving path (`groth16.fullProve`), but `bun audit`
  will flag them until upstream updates.

## The local runtime's actual trust model

Security here does **not** rest on the gateway, the policy engine, or
the dashboard-only gate alone — each of those is bypassable from
another surface. It rests on exactly three things:

1. **Loopback binding.** The `agentix/` API binds to `127.0.0.1`.
   That is a network boundary, not authentication: any local process,
   and any browser tab pointed at the API's port, is inside it.
2. **The per-run localhost token.** Every state-changing REST call
   requires `X-Agentix-Token`, a fresh random token on each server
   start (printed once in the server log, written `0600` to
   `~/.agentix/.local-token`). CORS reflects only allowlisted
   dashboard origins (`http://localhost:3000`,
   `http://127.0.0.1:3000`, plus `AGENTIX_DASHBOARD_ORIGINS`) — never
   `*`. The token proves "local owner process", not "which human":
   any script on the dashboard origin and any local process that can
   read `~/.agentix` is inside the trust boundary. Never expose the
   API port to a network, and never run it on a shared machine as if
   it were authenticated. The one exemption is `POST /api/bundler/send`,
   which binds the relay to caller identity instead: a caller-supplied
   session key is proof of possession, and a stored-key relay requires
   the localhost token — a bare session id is rejected.
3. **The runtime signer key.** Every gateway-path fund movement
   executes as `AGENTIX_PRIVATE_KEY`. In the standard setup that key is
   the deployer/owner/issuer key, so it is the real root of trust —
   protected by nothing beyond loopback binding and the token above.
   On-chain session/owner checks are sound except for what session
   validation measures: ETH value is bounded by the session maxValue,
   and token moves are bounded by the session target allowlist (see
   below) — there is no per-token amount limit, and token amounts are
   never summed into the ETH limit.

What the gates do enforce, once the token boundary holds:

- Gateway intents run on the **normalised** action name (lowercase +
  alias map) at every gate, and the gateway re-checks the normalised
  name before executing — alias and case spellings of owner-only and
  authority actions cannot auto-execute.
- A state-changing gateway action with no wallet address is **denied**,
  and policy is checked unconditionally for non-free actions; the
  wallet scope comes from request params only, never from a
  caller-supplied context object.
- Policy changes require an owner signature verified against the
  wallet's registered owner; plan approval over MCP requires an owner
  attestation signature; plan approval over REST requires the
  localhost token. MCP bundler tools pass through the same risk/policy
  gate as the REST bundler relay.
- The x402 policy endpoint never returns the stored session key, and
  session preparation returns a private key only when `selfCustody`
  is explicit. Session keys for browser-generated agents are stored in
  sessionStorage (not localStorage) — but see the limitation below.

Known limitations, stated plainly rather than fixed by rewording:

- **Session token rule (contracts + runtime).** ETH value is bounded
  by the session maxValue, but token amounts are NOT summed into it.
  Instead, token selectors (ERC-20 transfer/approve/transferFrom,
  ERC-721 transferFrom/safeTransferFrom) are DENIED on-chain unless
  the token contract is in the session's target allowlist — an empty
  allowlist denies every token move (non-token targets are still
  allowed). The EntryPoint, the wallet itself, SessionManager, the
  CredentialRegistry, and the DelegationManager are denied as session
  targets unconditionally. Lightweight sessions take allowedTargets at
  creation; standard sessions need a wallet-signed setSessionTargets()
  after creation. A "bounded token spend" claim is true only as
  "bounded to allowlisted token contracts", never as a per-token
  amount cap. The off-chain policy and risk gates additionally decode
  token-transfer selectors and gate token moves by action and target
  allowlist.
- **Root changes are propose + accept (contracts).** Credential,
  delegation, and anchor roots change only via a propose transaction,
  a 2-day timelock, and an accept transaction (cancel instead to
  abandon a proposal; a pending proposal blocks any new one). Any
  wording that promises an instant root update is stale: a propose
  must be reported as "proposed", never "updated".
- **Browser-generated agent keys are transiently visible to the
  server.** A dashboard-generated agent key must be sent to the local
  API server when relaying through the bundler (the server does not
  hold those keys); it is used transiently and never persisted, but
  the old "no server sees it" claim was false and has been removed.
  Prefer the server-stored-key relay (token-gated) where possible.
- **Organisation-request approval has no signature verification.**
  The request schema carries no signature field, so there is no
  signature to verify at the REST boundary; the operation is covered
  by the localhost token instead. Inventing a signature scheme would
  be a rewrite, not a fix.
- **x402 defaults are permissive by design, not by accident:**
  auto-approve on, $0.10 auto-approve threshold, $10/day daily limit,
  all domains allowed until configured. Tighten them before any use
  beyond a local demo.
- **MCP is stdio-local, not token-gated.** The MCP server's trust
  boundary is the local process that spawns it; its bundler paths pass
  the risk gate, and its plan approvals require owner attestation,
  but it has no localhost-token concept. Do not expose the MCP server
  over a network transport without adding one.
- **Deployed contract addresses are not live-healthy.** Both the old
  config-default set and the deployment-JSON set have contracts
  deployed on Base Sepolia, and all 12 proxy addresses in both sets
  read an all-zero ERC1967 implementation slot. Live on-chain flows
  need a fresh verified deployment before any real-contract demo.

## What was removed and why

The 2026-10-24 cleanup deleted the contract "audit" reports rather than
keeping them with a corrected label, because keeping a file titled as a
professional audit — even with a disclaimer — invites exactly the
misreading that happened before. If a real audit happens, its report
belongs here under its auditor's name, with findings and fix status.
