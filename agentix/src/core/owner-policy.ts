import { runExecute, runQueryCamel, runSingleCamel } from './database';
import { getEventBus } from '../../packages/core/eventbus';
import { logger } from './logger';
import { ethers } from 'ethers';

export interface OwnerPolicy {
  id: string;
  walletAddress: string;
  dailyLimit: string;
  perTxLimit: string;
  allowedTargets: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  sessionExpiry: number;
  autoCreateSessions: boolean;
  signedBy: string;
  signature: string;
  createdAt: number;
  expiresAt: number;
}

export interface PolicyCheck {
  allowed: boolean;
  reason?: string;
  category: 'within_policy' | 'exceeds_limit' | 'forbidden_target' | 'forbidden_action' | 'no_policy';
}

// NOTE on the table: the owner_policies schema lives ONLY in
// src/core/database.ts (the central schema). An earlier duplicate
// CREATE TABLE here (initPolicySchema) was dead code — zero callers —
// and has been removed so there is exactly one definition to drift.

/**
 * Default forbidden actions, in GATEWAY action names. The pre-fix list used
 * dot/camel names (`changeOwner`, `upgradeImplementation`, …) that never
 * match a gateway action, so the default forbidden list never fired on the
 * gateway path (R-9). `upgradeImplementation`, `selfdestruct`, and
 * `setAdmin` have no gateway action at all — the gateway cannot execute
 * them, so there is nothing to forbid there — and are dropped rather than
 * kept as never-matching theater.
 */
const DEFAULT_FORBIDDEN = [
  'wallet_transfer_ownership', // changeOwner
  'wallet_withdraw', // withdrawDeposit
];

/**
 * Normalise an action name for policy comparison (lowercase, dots to underscores, trimmed).
 * Storage historically uses dot-names (wallet.execute) while the gateway uses underscores (wallet_execute); raw comparison denied actions it meant to allow.
 * @param action — any action spelling, e.g. "Wallet.Execute".
 * @returns The normalised name, e.g. "wallet_execute".
 * @throws Never throws.
 * Maps to: internal — checkPolicy (allowlist/forbidden matching).
 */
export function normalizePolicyAction(action: string): string {
  return action.toLowerCase().trim().replace(/\./g, '_');
}

/**
 * Parse a value into wei, failing closed on unparseable input.
 * Units rule: an integer string is wei (the on-chain/bundler unit); a decimal string is ETH (the human unit the default limits use).
 * @param v — bigint, integer-wei string, decimal-ETH string, or null/undefined (both become 0n); anything else throws.
 * @returns The value in wei.
 * @throws Throws `Unparseable value ...` when the input is neither integer wei nor decimal ETH — every caller treats a throw as DENY.
 * Maps to: policy rule — per-tx / daily spend-cap (limits are compared in wei).
 * Security: fail-closed by design — the old coerce-to-0 turned garbage into "free".
 */
export function parseValueToWei(v: unknown): bigint {
  if (v === undefined || v === null) return 0n;
  if (typeof v === 'bigint') return v;
  const s = String(v).trim();
  if (s === '') return 0n;
  try {
    return BigInt(s);
  } catch {
    // Not an integer (and not 0x hex, which BigInt handles) — try ETH decimal.
  }
  try {
    return ethers.parseEther(s);
  } catch {
    throw new Error(`Unparseable value "${s}": expected integer wei or decimal ETH`);
  }
}

// ── ERC-20 token-move decoding (R-6) ──────────────────────────────────────

const ERC20_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
]);

export interface TokenMove {
  kind: 'erc20_transfer' | 'erc20_approve' | 'erc20_transferFrom';
  /** The token contract being called (params.target). */
  token: string;
  /** The transfer recipient / approved spender. */
  to: string;
  amount: bigint;
}

/**
 * Decode an ERC-20 transfer/approve/transferFrom out of wallet_execute calldata, if it is one.
 * The policy check needs the effective token action, not the wallet_execute wrapper: a policy allowing wallet_execute does NOT authorise token moves.
 * @param target — the token contract (params.target); `data` — the calldata; anything non-hex/short returns null.
 * @returns The TokenMove { kind, token, to, amount }, or null for any other selector or undecodable data.
 * @throws Never throws — decode failures return null (unknown selectors fall back to the target allowlist).
 * Maps to: internal — checkPolicy (effective-action resolution).
 */
export function decodeTokenMove(target: string, data: unknown): TokenMove | null {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  try {
    if (selector === '0xa9059cbb') {
      const [to, amount] = ERC20_IFACE.decodeFunctionData('transfer', data);
      return { kind: 'erc20_transfer', token: target, to, amount };
    }
    if (selector === '0x095ea7b3') {
      const [to, amount] = ERC20_IFACE.decodeFunctionData('approve', data);
      return { kind: 'erc20_approve', token: target, to, amount };
    }
    if (selector === '0x23b872dd') {
      const [, to, amount] = ERC20_IFACE.decodeFunctionData('transferFrom', data);
      return { kind: 'erc20_transferFrom', token: target, to, amount };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Store (replacing any existing) the owner policy for one wallet.
 * The caller must have verified the owner's signature first: this function itself is trusted-internal and performs no auth.
 * @param params — the full policy: walletAddress, daily/per-tx limits (integer-wei or decimal-ETH strings), allowlists, sessionExpiry, autoCreateSessions, signedBy, signature.
 * @returns The freshly stored policy as read back from the DB.
 * @throws Throws on DB failure; also throws (via the non-null assertion) if the read-back finds nothing.
 * Maps to: REST POST /api/policy (after EIP-191 signature verification).
 * Side effects: deletes the wallet's prior policy, inserts the new one (DEFAULT_FORBIDDEN always appended), emits PolicyUpdated on the event bus.
 * Security: no signature check here — only call from the verified REST handler, the local-owner CLI, or the dashboard-gated MCP path.
 */
export async function setOwnerPolicy(params: {
  walletAddress: string;
  dailyLimit: string;
  perTxLimit: string;
  allowedTargets: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  sessionExpiry: number;
  autoCreateSessions: boolean;
  signedBy: string;
  signature: string;
}): Promise<OwnerPolicy> {
  const id = `policy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1000);

  // Deactivate existing policy for this wallet
  runExecute(
    'DELETE FROM owner_policies WHERE wallet_address = ?',
    params.walletAddress
  );

  runExecute(
    `INSERT INTO owner_policies
     (id, wallet_address, daily_limit, per_tx_limit, allowed_targets, allowed_actions,
      forbidden_actions, session_expiry, auto_create_sessions, signed_by, signature, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    id,
    params.walletAddress,
    params.dailyLimit,
    params.perTxLimit,
    JSON.stringify(params.allowedTargets),
    JSON.stringify(params.allowedActions),
    JSON.stringify([...DEFAULT_FORBIDDEN, ...params.forbiddenActions]),
    params.sessionExpiry,
    params.autoCreateSessions ? 1 : 0,
    params.signedBy,
    params.signature,
    now
  );

  await getEventBus().emit({ type: "PolicyUpdated", data: { walletAddress: params.walletAddress, policyId: id } });

  return getOwnerPolicy(params.walletAddress)!;
}

/**
 * Load the latest owner policy for a wallet.
 * The read side of the policy store; checkPolicy calls this on every state-changing action.
 * @param walletAddress — the wallet to look up; unknown wallets return null (which checkPolicy treats as deny).
 * @returns The policy with its JSON list fields parsed, or null when no policy exists.
 * @throws Throws on DB failure or corrupt stored JSON (JSON.parse is unguarded).
 * Maps to: REST GET /api/policy/:walletAddress.
 */
export function getOwnerPolicy(walletAddress: string): OwnerPolicy | null {
  const row = runSingleCamel<any>(
    'SELECT * FROM owner_policies WHERE wallet_address = ? ORDER BY created_at DESC LIMIT 1',
    walletAddress
  );
  if (!row) return null;

  return {
    id: row.id,
    walletAddress: row.walletAddress,
    dailyLimit: row.dailyLimit,
    perTxLimit: row.perTxLimit,
    allowedTargets: JSON.parse(row.allowedTargets || '[]'),
    allowedActions: JSON.parse(row.allowedActions || '[]'),
    forbiddenActions: JSON.parse(row.forbiddenActions || '[]'),
    sessionExpiry: row.sessionExpiry,
    autoCreateSessions: row.autoCreateSessions === 1,
    signedBy: row.signedBy,
    signature: row.signature,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Decide whether a state-changing action may run under the wallet's owner policy.
 * Fail-closed throughout: no policy, empty allowlist, unparseable value/limit, or any limit breach all deny — and token moves need their token action explicitly allowed.
 * @param walletAddress — the wallet whose policy applies; `action` — the gateway action name.
 * @param params — target/recipient/data/value; `params.value` is parsed as wei-or-ETH (see parseValueToWei).
 * @returns { allowed, reason, category } — category is within_policy, exceeds_limit, forbidden_target, forbidden_action, or no_policy.
 * @throws Never throws — limit parse failures are returned as denies, not raised.
 * Maps to: policy rule — spend-cap / allowlist enforcement (REST POST /api/policy/check; bundler-risk-gate).
 * Security: token amounts are deliberately NOT summed into the ETH daily limit — different assets must not be conflated; token moves are gated by action + target allowlists instead.
 */
export function checkPolicy(walletAddress: string, action: string, params: Record<string, unknown>): PolicyCheck {
  const policy = getOwnerPolicy(walletAddress);

  if (!policy) {
    return { allowed: false, reason: 'No owner policy set. Owner must configure policy first.', category: 'no_policy' };
  }

  const normalized = normalizePolicyAction(action);

  // Token moves: the effective action for allowlist purposes is the token
  // action (erc20_transfer / erc20_approve / erc20_transferFrom), not the
  // generic wallet_execute wrapper. A policy that allows wallet_execute
  // but never mentions token actions does NOT allow token moves — the
  // allowlist below requires the token action to be explicitly present
  // (unless the raw action itself is listed AND the move is not a token
  // move; see the check below).
  const target = (params.target || params.recipient || params.delegatee || '') as string;
  const tokenMove = target ? decodeTokenMove(target, params.data) : null;
  const effectiveAction = tokenMove ? tokenMove.kind : normalized;

  const forbidden = policy.forbiddenActions.map(normalizePolicyAction);
  if (forbidden.includes(normalized) || forbidden.includes(effectiveAction)) {
    return { allowed: false, reason: `Action "${action}" is forbidden by owner policy.`, category: 'forbidden_action' };
  }

  // Empty allowlist means deny-all. The pre-fix code skipped the allowlist
  // check when the list was empty, turning "no actions configured" into
  // "all actions allowed". checkPolicy is only called for state-changing
  // actions (gateway non-free actions, bundler relay), so deny-all here
  // cannot block a read.
  const allowedList = policy.allowedActions.map(normalizePolicyAction);
  if (allowedList.length === 0) {
    return { allowed: false, reason: 'Owner policy allows no actions.', category: 'forbidden_action' };
  }
  // A token move passes the action check only via its token action; a
  // plain (non-token) action passes via its own name. A policy listing
  // only `wallet_execute` therefore does NOT authorise token transfers.
  if (!allowedList.includes(effectiveAction)) {
    return { allowed: false, reason: `Action "${effectiveAction}" is not in the allowed actions list.`, category: 'forbidden_action' };
  }

  // Check target allowlist. For a token move the target is the token
  // contract itself — a token move to a non-allowlisted token contract is
  // denied here (R-6 minimum). When no target allowlist is configured
  // (empty list), this check is skipped, as before.
  if (target && policy.allowedTargets.length > 0) {
    const targetLower = target.toLowerCase();
    const allowed = policy.allowedTargets.some((t) => t.toLowerCase() === targetLower);
    if (!allowed) {
      return { allowed: false, reason: `Target "${target}" is not in the allowed targets list.`, category: 'forbidden_target' };
    }
  }

  // Check per-tx limit. FAIL-CLOSED: an unparseable value OR an
  // unparseable configured limit denies — the pre-fix empty catch skipped
  // the check entirely, which also meant the default decimal limits
  // ("0.1"/"0.05") NEVER enforced anything (BigInt("0.1") throws).
  let valueWei: bigint;
  let perTxWei: bigint;
  try {
    valueWei = parseValueToWei(params.value ?? '0');
    perTxWei = parseValueToWei(policy.perTxLimit);
  } catch (e: any) {
    return { allowed: false, reason: `Value/limit parse failure: ${e.message}`, category: 'exceeds_limit' };
  }
  if (valueWei > perTxWei) {
    return {
      allowed: false,
      reason: `Value ${valueWei} wei exceeds per-tx limit of ${perTxWei} wei.`,
      category: 'exceeds_limit',
    };
  }

  // Check daily limit. The sum reads metadata.value, which the gateway
  // stores as wei-normalised strings (see compiler-gateway _logAction).
  // Token amounts are deliberately NOT summed into this ETH-denominated
  // daily limit — different assets must not be conflated. Token moves are
  // gated above by action + target allowlists instead; that limitation is
  // documented, not hidden.
  let usedWei: bigint;
  let dailyWei: bigint;
  try {
    const todayStart = Math.floor(Date.now() / 1000) - (Math.floor(Date.now() / 1000) % 86400);
    const row = runSingleCamel<{ totalUsed: string }>(
      `SELECT COALESCE(SUM(CAST(metadata->>'$.value' AS INTEGER)), 0) as total_used
       FROM agent_actions
       WHERE wallet_address = ? AND timestamp > ? AND success = 1`,
      walletAddress, todayStart
    );
    usedWei = BigInt(row?.totalUsed || '0');
    dailyWei = parseValueToWei(policy.dailyLimit);
  } catch (e: any) {
    return { allowed: false, reason: `Daily-limit parse failure: ${e.message}`, category: 'exceeds_limit' };
  }
  if (usedWei + valueWei > dailyWei) {
    return {
      allowed: false,
      reason: `Daily limit exceeded. Used: ${usedWei}, Requested: ${valueWei}, Limit: ${dailyWei}.`,
      category: 'exceeds_limit',
    };
  }

  return { allowed: true, category: 'within_policy' };
}

/**
 * Delete the owner policy for a wallet.
 * After deletion checkPolicy denies everything for the wallet (no_policy) until a new policy is set.
 * @param walletAddress — the wallet whose policy to remove; unknown wallets are a silent no-op.
 * @returns Nothing.
 * @throws Throws on DB failure.
 * Maps to: internal — REST policy handlers (policy removal).
 * Side effects: deletes the wallet's row(s) from owner_policies.
 */
export function deleteOwnerPolicy(walletAddress: string): void {
  runExecute('DELETE FROM owner_policies WHERE wallet_address = ?', walletAddress);
}

// ── Policy-set signature verification (R-3) ────────────────────────────────

/**
 * Build the canonical string an owner signs (EIP-191) to authorise a policy set.
 * Array order is normalised (sorted) so the dashboard and the server construct identical payloads regardless of UI ordering.
 * @param policy — the policy fields; arrays are sorted before joining, so input order does not change the payload.
 * @returns The colon-joined payload starting with "agentix-policy".
 * @throws Never throws.
 * Maps to: internal — verifyPolicySignature (the payload that is verified).
 */
export function buildPolicySignaturePayload(policy: {
  walletAddress: string;
  dailyLimit: string;
  perTxLimit: string;
  allowedTargets: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  sessionExpiry: number;
  autoCreateSessions: boolean;
}): string {
  /**
   * Serialise a string list in sorted order so the signed payload is order-independent.
   * The copy-then-sort keeps the caller's array untouched.
   * @param xs — the list to normalise.
   * @returns The JSON array string of the sorted copy.
   * @throws Never throws.
   * Maps to: internal — buildPolicySignaturePayload (canonical payload construction).
   */
  const sorted = (xs: string[]) => JSON.stringify([...xs].sort());
  return [
    'agentix-policy',
    policy.walletAddress,
    policy.dailyLimit,
    policy.perTxLimit,
    sorted(policy.allowedTargets),
    sorted(policy.allowedActions),
    sorted(policy.forbiddenActions),
    String(policy.sessionExpiry),
    policy.autoCreateSessions ? '1' : '0',
  ].join(':');
}

/**
 * Verify an EIP-191 signature over the canonical policy payload by the expected signer.
 * Empty, placeholder ('0x'), and malformed signatures all fail — a stored-but-never-verified signature would be theater.
 * @param policy — the policy fields (must match what was signed); `signature` — the EIP-191 signature.
 * @param expectedSigner — the wallet's registered owner; the recovered address must equal it (case-insensitive).
 * @returns True only when the signature recovers to the expected signer; false otherwise.
 * @throws Never throws — recovery failures return false.
 * Maps to: REST POST /api/policy (verified before setOwnerPolicy is called).
 * Security: this is the auth boundary for policy changes — a false positive here lets anyone rewrite a wallet's limits.
 */
export function verifyPolicySignature(
  policy: {
    walletAddress: string;
    dailyLimit: string;
    perTxLimit: string;
    allowedTargets: string[];
    allowedActions: string[];
    forbiddenActions: string[];
    sessionExpiry: number;
    autoCreateSessions: boolean;
  },
  signature: string,
  expectedSigner: string,
): boolean {
  try {
    if (!signature || signature === '0x') return false;
    const recovered = ethers.verifyMessage(buildPolicySignaturePayload(policy), signature);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}
