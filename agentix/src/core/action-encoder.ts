/**
 * action-encoder.ts — Single source of truth for turning a compiler intent
 * (action + params) into correctly-encoded, address-validated calldata.
 *
 * WHY THIS EXISTS:
 *   The compiler's contract-resolver records which contract/function an action
 *   maps to, but not how to order the ABI arguments. The gateway previously sent
 *   `node.call.args[0]` raw — which was empty calldata for any action whose params
 *   weren't already hex. This module closes that gap: every executable action has
 *   an explicit arg-builder, calldata is produced via the ABI interface, and the
 *   target is verified to be a deployed proxy (has code on the connected chain)
 *   before anything is signed.
 *
 * SAFETY INVARIANTS:
 *   1. Target address always resolves through ProxyGuard (never an implementation).
 *   2. Target must have bytecode on the connected chain (assertDeployed).
 *   3. Unknown / unmapped actions throw — we never send a blind transaction.
 */

import { ethers } from "ethers";
import { getAbiByName } from "../contracts";
import { getProxyGuard } from "./proxy-guard";
import { loadConfig } from "./config";
import { getProvider } from "./provider";
import { logger } from "./logger";
import { parseValueToWei } from "./owner-policy";

export interface EncodedAction {
  to: string;
  data: string;
  value: bigint;
  contractName: string;
  functionName: string;
  chainId: number;
}

type ArgBuilder = (p: Record<string, any>) => {
  contract: string;                       // ABI + address source
  fn: string;                             // function name (may be canonical sig)
  args: any[];
  value?: bigint;
  /** When set, `to` is this per-instance address (e.g. a user's AgentWallet). */
  toAddress?: (p: Record<string, any>) => string;
};

// FAIL-CLOSED (R-9): unparseable values THROW instead of silently becoming
// 0n. The pre-fix `catch { return 0n; }` turned a malformed amount into a
// zero-value transaction — including the CLI's `--value <eth>` decimal
// inputs, which BigInt() rejects and which therefore all silently sent 0.
// Integer strings are wei; decimal strings are ETH (see parseValueToWei in
// core/owner-policy for the units rule); anything else throws, and the
// gateway reports an encoding error instead of sending.
/**
 * Convert a caller-supplied value to wei, failing closed on garbage (alias for parseValueToWei).
 * Integer strings are wei, decimal strings are ETH; anything unparseable throws instead of silently becoming 0.
 * @param v — bigint, integer-wei string, or decimal-ETH string; null/undefined become 0n.
 * @returns The value in wei.
 * @throws Throws on unparseable input (never coerces to 0 — a zero-value transaction must be explicit).
 * Maps to: internal — owner-policy parseValueToWei (units rule lives there).
 */
const toWei = (v: unknown): bigint => parseValueToWei(v);
/**
 * Fetch a required action param, failing fast when it is missing.
 * Every ACTIONS builder uses this so a malformed intent errors at encode time, never as a half-built transaction.
 * @param p — the action params; `k` — the required key.
 * @returns The param value (undefined/null/"" all throw).
 * @throws Throws `Missing required param "k"` when the value is undefined, null, or "".
 * Maps to: internal — ACTIONS builders (every entry's required args).
 */
const req = (p: Record<string, any>, k: string): any => {
  const v = p[k];
  if (v === undefined || v === null || v === "") throw new Error(`Missing required param "${k}"`);
  return v;
};

/**
 * Action registry. Each entry knows the contract, function, and exact ordered
 * ABI args for that action. Adding a new executable action = one entry here.
 */
const ACTIONS: Record<string, ArgBuilder> = {
  wallet_execute: (p) => ({
    contract: "AgentWallet",
    fn: "execute",
    args: [req(p, "target"), toWei(p.value), (p.data as string) || "0x"],
    toAddress: (pp) => req(pp, "walletAddress"),
  }),
  wallet_execute_batch: (p) => ({
    contract: "AgentWallet",
    fn: "executeBatch",
    args: [
      req(p, "targets"),
      (p.values as any[] | undefined)?.map(toWei) ?? [],
      (p.data as string[] | undefined) ?? [],
    ],
    toAddress: (pp) => req(pp, "walletAddress"),
  }),
  wallet_deposit: (p) => ({
    contract: "AgentWallet",
    fn: "addDeposit",
    args: [],
    value: toWei(p.amount ?? p.value),
    toAddress: (pp) => req(pp, "walletAddress"),
  }),
  wallet_withdraw: (p) => ({
    contract: "AgentWallet",
    fn: "withdrawDepositTo",
    args: [req(p, "recipient"), toWei(req(p, "amount"))],
    toAddress: (pp) => req(pp, "walletAddress"),
  }),
  wallet_transfer_ownership: (p) => ({
    contract: "AgentWallet",
    fn: "changeOwner",
    args: [req(p, "newOwner")],
    toAddress: (pp) => req(pp, "walletAddress"),
  }),
  session_revoke: (p) => ({
    contract: "SessionManager",
    fn: "revokeSession",
    args: [req(p, "sessionId"), req(p, "walletAddress")],
  }),
  credential_issue: (p) => ({
    contract: "CredentialRegistry",
    fn: "proposeActiveRoot",
    args: [req(p, "root")],
  }),
  credential_revoke: (p) => ({
    contract: "CredentialRegistry",
    fn: "proposeRevokedSecretRoot",
    args: [req(p, "root")],
  }),
  credential_update_root: (p) => ({
    contract: "CredentialRegistry",
    fn: "proposeActiveRoot",
    args: [req(p, "root")],
  }),
  // Root ACCEPT actions (C-5 timelock): complete a pending proposal after
  // the 2-day delay. Accepting before the delay reverts (TimelockNotReady).
  // Like the propose actions above, these are authority writes: the gateway
  // gates them to owner approval, never auto-execution.
  credential_accept_root: (p) => ({
    contract: "CredentialRegistry",
    fn: "acceptActiveRoot",
    args: [],
  }),
  credential_accept_revoked_root: (p) => ({
    contract: "CredentialRegistry",
    fn: "acceptRevokedSecretRoot",
    args: [],
  }),
  credential_cancel_root: (p) => ({
    contract: "CredentialRegistry",
    fn: "cancelActiveRoot",
    args: [],
  }),
  credential_cancel_revoked_root: (p) => ({
    contract: "CredentialRegistry",
    fn: "cancelRevokedSecretRoot",
    args: [],
  }),
  organization_register: (p) => ({
    contract: "OrganizationRegistry",
    fn: "registerOrganization",
    args: [req(p, "organizationId"), req(p, "name"), req(p, "ownerAddress")],
  }),
  organization_deactivate: (p) => ({
    contract: "OrganizationRegistry",
    fn: "deactivateOrganization",
    args: [req(p, "organizationId")],
  }),
  organization_reactivate: (p) => ({
    contract: "OrganizationRegistry",
    fn: "reactivateOrganization",
    args: [req(p, "organizationId")],
  }),
  capability_register: (p) => ({
    contract: "CapabilityRegistry",
    fn: "registerCapability",
    args: [req(p, "capabilityId"), req(p, "action"), req(p, "expiresAt")],
  }),
  capability_revoke: (p) => ({
    contract: "CapabilityRegistry",
    fn: "revokeCapability",
    args: [req(p, "capabilityId")],
  }),
  delegation_create: (p) => ({
    contract: "DelegationManager",
    fn: "proposeDelegationRoot",
    args: [req(p, "delegator"), req(p, "scopeHash"), req(p, "root"), req(p, "expiresAt")],
  }),
  delegation_accept_root: (p) => ({
    contract: "DelegationManager",
    fn: "acceptDelegationRoot",
    args: [req(p, "delegator"), req(p, "scopeHash")],
  }),
  delegation_cancel_root: (p) => ({
    contract: "DelegationManager",
    fn: "cancelDelegationRoot",
    args: [req(p, "delegator"), req(p, "scopeHash")],
  }),
  // Anchor root actions (C-5 timelock). Anchors are per-organization
  // instances, not the singleton proxy: the target comes from params, the
  // same per-instance pattern as wallet actions above.
  anchor_accept_root: (p) => ({
    contract: "OrganizationCredentialAnchor",
    fn: "acceptRoot",
    args: [],
    toAddress: (pp) => req(pp, "anchorAddress"),
  }),
  anchor_accept_revoked_root: (p) => ({
    contract: "OrganizationCredentialAnchor",
    fn: "acceptRevokedRoot",
    args: [],
    toAddress: (pp) => req(pp, "anchorAddress"),
  }),
  anchor_cancel_root: (p) => ({
    contract: "OrganizationCredentialAnchor",
    fn: "cancelRoot",
    args: [],
    toAddress: (pp) => req(pp, "anchorAddress"),
  }),
  anchor_cancel_revoked_root: (p) => ({
    contract: "OrganizationCredentialAnchor",
    fn: "cancelRevokedRoot",
    args: [],
    toAddress: (pp) => req(pp, "anchorAddress"),
  }),
  delegation_revoke: (p) => ({
    contract: "DelegationManager",
    fn: "revokeDelegation",
    args: [req(p, "delegationLeafHash"), req(p, "delegator")],
  }),
  identity_update_metadata: (p) => ({
    contract: "AgentIdentity",
    fn: "updateMetadata",
    args: [req(p, "identityId"), req(p, "metadataRoot")],
  }),
  identity_deactivate: (p) => ({
    contract: "AgentIdentity",
    fn: "deactivate",
    args: [req(p, "identityId")],
  }),
  identity_reactivate: (p) => ({
    contract: "AgentIdentity",
    fn: "reactivate",
    args: [req(p, "identityId")],
  }),
  identity_register: (p) => ({
    contract: "AgentIdentity",
    fn: "registerIdentity",
    args: [req(p, "walletAddress"), req(p, "metadataRoot") || "0x0000000000000000000000000000000000000000000000000000000000000000"],
  }),
};

/**
 * Check whether an action name has an encoder entry in the ACTIONS registry.
 * The admissibility test the gateway runs before attempting to encode: unknown actions are never sent blind.
 * @param action — the gateway action name, e.g. "wallet_execute".
 * @returns True when the action is registered; false otherwise.
 * @throws Never throws.
 * Maps to: internal — encodeAction (guards the same registry).
 */
export function isEncodableAction(action: string): boolean {
  return action in ACTIONS;
}

// ── deployment validation (cached per address per process) ────────────────────
const _deployed = new Map<string, boolean>();

/**
 * Assert the target address has contract bytecode on the connected chain.
 * Prevents sending to a stale or wrong-network address; successes are cached per address per process.
 * @param address — the target; compared lowercased for the cache key.
 * @returns Nothing on success (including cached successes, which skip the RPC call).
 * @throws Throws when the address has no code on this chain; an RPC failure is treated as "no code" and also throws.
 * Maps to: internal — encodeAndValidate (the send-intent path that must check deployment).
 * Side effects: one eth_getCode RPC call per uncached address; caches successes.
 */
export async function assertDeployed(address: string): Promise<void> {
  const key = address.toLowerCase();
  if (_deployed.get(key)) return;
  const code = await getProvider().getCode(address).catch(() => "0x");
  if (!code || code === "0x") {
    throw new Error(
      `Target ${address} has no contract code on the connected chain — refusing to send. ` +
      `The address is not deployed on this network (check config.contracts / chainId).`
    );
  }
  _deployed.set(key, true);
}

/**
 * Clear the deployment cache (test hook).
 * Tests that switch chains or redeploy must call this or assertDeployed will trust a stale "deployed" entry.
 * @returns Nothing.
 * @throws Never throws.
 * Maps to: internal — tests (counterpart of assertDeployed's cache).
 * Side effects: clears the module-level _deployed cache.
 */
export function __resetDeploymentCache(): void {
  _deployed.clear();
}

/**
 * Encode an action + params into an address-validated, ABI-encoded transaction (no signing, no sending).
 * Deliberately synchronous and deployment-unchecked so planning can use it; call encodeAndValidate (or assertDeployed) before sending.
 * @param action — a registered action name; unknown names throw.
 * @param params — the action's params; missing required params throw from the builder.
 * @returns An EncodedAction { to, data, value, contractName, functionName, chainId }.
 * @throws Throws on unknown actions, missing params, unparseable values, or a ProxyGuard rejection (implementation / wrong proxy).
 * Maps to: contract — the ACTIONS registry entry's contract function (e.g. AgentWallet.execute).
 * Security: the target always resolves through ProxyGuard — never an implementation address.
 */
export function encodeAction(action: string, params: Record<string, any>): EncodedAction {
  const builder = ACTIONS[action];
  if (!builder) {
    throw new Error(`Action "${action}" is not an encodable on-chain action`);
  }

  const spec = builder(params || {});
  const guard = getProxyGuard();
  const config = loadConfig();

  // Resolve + validate the target address.
  let to: string;
  if (spec.toAddress) {
    to = spec.toAddress(params);
    const v = guard.validate(to); // blocks known implementation addresses
    if (!v.valid) throw new Error(v.error);
  } else {
    to = guard.getProxyAddress(spec.contract);
    const v = guard.validate(to, spec.contract);
    if (!v.valid) throw new Error(v.error);
  }

  const iface = new ethers.Interface(getAbiByName(spec.contract));
  const data = iface.encodeFunctionData(spec.fn, spec.args);

  return {
    to,
    data,
    value: spec.value ?? 0n,
    contractName: spec.contract,
    functionName: spec.fn,
    chainId: config.chainId,
  };
}

/**
 * Encode an action and assert its target is deployed, returning a ready-to-sign transaction.
 * The send-intent entry point: encodeAction plus the on-chain deployment check, in one call.
 * @param action — a registered action name; `params` — the action's params.
 * @returns The validated EncodedAction.
 * @throws Throws on any encodeAction failure or when the target has no bytecode on the connected chain.
 * Maps to: contract — the ACTIONS registry entry's contract function (validated send intent).
 * Side effects: one eth_getCode RPC call per uncached target; logs the encoding.
 */
export async function encodeAndValidate(
  action: string,
  params: Record<string, any>
): Promise<EncodedAction> {
  const encoded = encodeAction(action, params);
  await assertDeployed(encoded.to);
  logger.info("action-encoder", `Encoded ${action} → ${encoded.contractName}.${encoded.functionName} @ ${encoded.to}`);
  return encoded;
}
