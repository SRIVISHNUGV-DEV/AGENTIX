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

const toWei = (v: unknown): bigint => {
  if (v === undefined || v === null || v === "") return 0n;
  try { return BigInt(v as any); } catch { return 0n; }
};
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
    fn: "updateActiveRoot",
    args: [req(p, "root")],
  }),
  credential_revoke: (p) => ({
    contract: "CredentialRegistry",
    fn: "updateRevokedSecretRoot",
    args: [req(p, "root")],
  }),
  credential_update_root: (p) => ({
    contract: "CredentialRegistry",
    fn: "updateActiveRoot",
    args: [req(p, "root")],
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
    fn: "updateDelegationRoot",
    args: [req(p, "delegator"), req(p, "scopeHash"), req(p, "root"), req(p, "expiresAt")],
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

/** Is this action executable on-chain through the encoder? */
export function isEncodableAction(action: string): boolean {
  return action in ACTIONS;
}

// ── deployment validation (cached per address per process) ────────────────────
const _deployed = new Map<string, boolean>();

/**
 * Assert the target address has contract bytecode on the connected chain.
 * Prevents sending a transaction to an address that isn't actually deployed
 * (e.g. a stale/wrong-network config). Cached after first success.
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

/** For tests: clear the deployment cache. */
export function __resetDeploymentCache(): void {
  _deployed.clear();
}

/**
 * Encode an action+params into an address-validated, ABI-encoded transaction.
 * Does NOT check on-chain deployment (call assertDeployed separately when you
 * actually intend to send — keeps this function pure/synchronous for planning).
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
 * Encode + assert deployed, returning a ready-to-sign transaction request.
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
