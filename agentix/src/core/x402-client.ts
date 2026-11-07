/**
 * x402-client.ts — ERC-4337-compatible x402 payment client for AgentIX.
 *
 * The agent wallet is a SMART CONTRACT (ERC-4337), not an EOA. Payments flow:
 *   Agent wallet → UserOperation → Local Bundler → EntryPoint →
 *   AgentWallet.execute() → USDC transfer to merchant
 *
 * The proof-of-payment is the on-chain tx hash — the server verifies the
 * actual USDC transfer happened by checking the tx receipt.
 *
 * x402 protocol: https://docs.x402.org
 */

import { ethers } from "ethers";
import { logger } from "./logger";
import { loadConfig } from "./config";
import { runExecute, runSingle, runQuery } from "./database";

// ── Types ────────────────────────────────────────────────────────────────────

export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string; // Atomic units (USDC has 6 decimals)
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;             // Merchant's wallet address
  maxTimeoutSeconds: number;
}

export interface X402PaymentResult {
  success: boolean;
  txHash?: string;
  amount?: string;
  currency?: string;
  userOpHash?: string;
  blockNumber?: number;
  error?: string;
}

export interface X402Policy {
  maxPaymentPerRequest: string;  // Max atomic units per single request
  dailyLimit: string;            // Max atomic units per day
  allowedDomains: string[];      // Empty = all domains
  blockedDomains: string[];      // Domains to never pay
  autoApprove: boolean;          // Skip risk check for small payments
  autoApproveThreshold: string;  // Below this amount, auto-approve (atomic units)
  agentWalletAddress: string;    // The ERC-4337 smart wallet address to pay from
  sessionKey: string;            // The session key that signs UserOps
}

// ── Constants ────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;

// USDC addresses
const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  // Base Sepolia
  "eip155:8453":  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // Base Mainnet
};

// USDC transfer ABI (just what we need)
const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

/**
 * Pre-flight check: is the payment token in the session's on-chain target allowlist?
 * Token selectors are DENIED on-chain unless the token contract is allowlisted, so a payment session that omits its token is broken — this must say so BEFORE a doomed UserOp is built.
 * @param targets — the session's allowlisted targets (case-insensitive compare); `token` — the USDC address.
 * @returns Null when allowed; otherwise an explicit error naming the fix (setSessionTargets or recreate the session).
 * @throws Never throws.
 * Maps to: internal — executePaymentViaBundler (C-1 pre-flight before building the UserOp).
 */
export function checkTokenAllowlisted(targets: readonly string[], token: string): string | null {
  const want = token.toLowerCase();
  if (targets.some((t) => t.toLowerCase() === want)) return null;
  return (
    `x402 payment session does not allowlist the payment token ${token} ` +
    `(session targets: ${targets.length ? targets.join(", ") : "none"}). ` +
    `Since the C-1 fix, token transfers revert on-chain unless the token contract is in the session allowlist. ` +
    `Fix: the wallet owner must call setSessionTargets(sessionId, [..., ${token}]) for a standard session, ` +
    `or recreate the lightweight session with allowedTargets including ${token}.`
  );
}

// AgentWallet execute ABI
const WALLET_EXECUTE_ABI = [
  "function execute(address target, uint256 value, bytes calldata data) external",
  "function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external",
];

// ── Policy Storage ───────────────────────────────────────────────────────────

/**
 * Load the stored x402 payment policy, or the documented permissive dev defaults when none is stored.
 * The defaults are deliberately permissive (autoApprove, $0.10 auto-approve, $10/day, all domains, no wallet) — do not assume they are restrictive.
 * @returns The stored policy, or the default policy (max $1/request, $10/day, autoApprove true).
 * @throws Throws on DB failure.
 * Maps to: REST GET /api/x402/policy (stored policy; the public view is getPublicPaymentPolicy).
 * Security: the stored policy contains the session key in plaintext — never return it unsanitised (see getPublicPaymentPolicy).
 */
export function getPaymentPolicy(): X402Policy {
  const row = runSingle<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    "x402_policy"
  );
  if (row) {
    try { return JSON.parse(row.value); } catch {}
  }
  // DEFAULT POLICY — a documented choice, not an accident (R-7). These
  // defaults are deliberately permissive for a local dev runtime and are
  // NOT silently tightened by the auth fixes: autoApprove: true, $0.10
  // auto-approve threshold (100000 atomic units), $10/day daily limit
  // (10000000 atomic units), allowedDomains: [] meaning ALL domains, and
  // an empty agentWalletAddress/sessionKey until configured. Tighten them
  // explicitly via POST /api/x402/policy (token-gated) if you want a
  // stricter posture; do not assume the defaults are restrictive.
  return {
    maxPaymentPerRequest: "1000000",   // $1.00
    dailyLimit: "10000000",            // $10.00
    allowedDomains: [],
    blockedDomains: [],
    autoApprove: true,
    autoApproveThreshold: "100000",    // $0.10
    agentWalletAddress: "",
    sessionKey: "",
  };
}

/**
 * Return the payment policy with the session private key removed (callers learn only whether one is stored).
 * The safe-to-expose view: the key at rest stays plaintext in the config table, so it must never cross this boundary.
 * @returns The policy minus sessionKey, plus sessionKeyPresent.
 * @throws Throws on DB failure (via getPaymentPolicy).
 * Maps to: REST GET /api/x402/policy (public view served to the dashboard).
 * Security: the session key is NEVER included in the return value.
 */
export function getPublicPaymentPolicy(): Omit<X402Policy, "sessionKey"> & { sessionKeyPresent: boolean } {
  const policy = getPaymentPolicy();
  const { sessionKey, ...rest } = policy;
  return { ...rest, sessionKeyPresent: !!sessionKey };
}

/**
 * Persist the x402 payment policy (upsert into the config table).
 * Only call from the token-gated policy endpoint: anyone who can write this can raise limits and point payments at their wallet.
 * @param policy — the full policy, including the session key when one is configured.
 * @returns Nothing.
 * @throws Throws on DB failure.
 * Maps to: REST POST /api/x402/policy (token-gated).
 * Side effects: upserts the x402_policy config row.
 * Security: writes the session key to the local DB in plaintext (bounded session key, not an owner key) — writes must stay token-gated.
 */
export function savePaymentPolicy(policy: X402Policy): void {
  runExecute(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('x402_policy', ?, unixepoch())`,
    JSON.stringify(policy)
  );
}

/**
 * Sum today's recorded x402 payments (UTC day, atomic USDC units).
 * The daily-limit ledger: checkPaymentPolicy and getPaymentStats both read through here.
 * @returns The atomic-unit total for today; 0 when nothing was spent.
 * @throws Throws on DB failure.
 * Maps to: internal — checkPaymentPolicy (daily-limit check) and getPaymentStats.
 */
function getDailySpend(): number {
  const startOfDay = Math.floor(Date.now() / 86400000) * 86400;
  const row = runSingle<{ total: number }>(
    `SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total 
     FROM x402_payments WHERE created_at >= ?`,
    startOfDay
  );
  return row?.total || 0;
}

/**
 * Record a completed x402 payment in the local ledger.
 * Only call after the retry proves the payment was accepted — recording a failed payment would inflate daily spend.
 * @param params — url, domain, amount (atomic units, string), payTo, txHash, userOpHash, scheme, network, walletAddress.
 * @returns Nothing.
 * @throws Throws on DB failure; callers swallow this (a missed ledger row must not fail the request).
 * Maps to: internal — fetchWithPayment (post-acceptance bookkeeping).
 * Side effects: inserts one row into x402_payments.
 */
function recordPayment(params: {
  url: string;
  domain: string;
  amount: string;
  payTo: string;
  txHash: string;
  userOpHash: string;
  scheme: string;
  network: string;
  walletAddress: string;
}): void {
  runExecute(
    `INSERT INTO x402_payments (url, domain, amount, pay_to, tx_hash, user_op_hash, scheme, network, wallet_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params.url,
    params.domain,
    params.amount,
    params.payTo,
    params.txHash,
    params.userOpHash,
    params.scheme,
    params.network,
    params.walletAddress,
    Math.floor(Date.now() / 1000)
  );
}

// ── Payment Header Parsing ───────────────────────────────────────────────────

/**
 * Extract x402 payment requirements from a 402 response's PAYMENT header.
 * Accepts base64-JSON ({ accepts } or a single requirement) and falls back to raw JSON; anything else is not a payable response.
 * @param response — the 402 response; a missing PAYMENT header returns null immediately.
 * @returns The requirement list, or null when the header is absent or unparseable.
 * @throws Never throws — parse failures return null.
 * Maps to: internal — fetchWithPayment (402 handling).
 */
function parse402Response(response: Response): X402PaymentRequirements[] | null {
  const paymentHeader = response.headers.get("PAYMENT") || response.headers.get("payment");
  if (!paymentHeader) return null;

  try {
    const decoded = JSON.parse(atob(paymentHeader));
    if (decoded.accepts && Array.isArray(decoded.accepts)) {
      return decoded.accepts;
    }
    if (decoded.scheme) {
      return [decoded];
    }
  } catch {
    try {
      const parsed = JSON.parse(paymentHeader);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.scheme) return [parsed];
    } catch {}
  }

  return null;
}

/**
 * Pick the payment requirement to satisfy: exact scheme on our chain first, then any exact EVM requirement, then the first listed.
 * Paying a requirement for the wrong chain would settle on a network the merchant never checks.
 * @param requirements — the server's accepts list; [] returns null.
 * @returns The chosen requirement, or null when the list is empty.
 * @throws Never throws.
 * Maps to: internal — fetchWithPayment (requirement selection).
 */
function selectBestRequirement(requirements: X402PaymentRequirements[]): X402PaymentRequirements | null {
  const config = loadConfig();
  const isTestnet = config.chainId === 84532;
  const targetNetwork = isTestnet ? "eip155:84532" : "eip155:8453";

  // Prefer exact scheme on our chain
  const baseReq = requirements.find(
    r => r.scheme === "exact" && r.network === targetNetwork
  );
  if (baseReq) return baseReq;

  // Any EVM network with exact scheme
  const evmReq = requirements.find(
    r => r.scheme === "exact" && r.network.startsWith("eip155:")
  );
  if (evmReq) return evmReq;

  return requirements[0] || null;
}

// ── Policy Check ─────────────────────────────────────────────────────────────

/**
 * Decide whether a payment may proceed under the stored x402 policy.
 * Checks, in order: per-request cap, daily cap, blocked/allowed domains, and that an agent wallet is configured.
 * @param requirement — the requirement to pay; `url` — the resource URL (its hostname is checked against the domain lists).
 * @returns { allowed, reason } — reason names the breached limit or the missing configuration.
 * @throws Never throws — a malformed URL simply skips the domain checks.
 * Maps to: internal — fetchWithPayment (pre-payment gate).
 * Security: this is the spend gate for autonomous payments — the defaults are permissive, so tighten the policy explicitly for production.
 */
function checkPaymentPolicy(
  requirement: X402PaymentRequirements,
  url: string
): { allowed: boolean; reason?: string } {
  const policy = getPaymentPolicy();
  const amount = parseInt(requirement.maxAmountRequired);
  const maxPerRequest = parseInt(policy.maxPaymentPerRequest);

  if (amount > maxPerRequest) {
    return {
      allowed: false,
      reason: `Payment ${formatUsd(amount)} exceeds per-request limit ${formatUsd(maxPerRequest)}`,
    };
  }

  const dailySpend = getDailySpend();
  const dailyLimit = parseInt(policy.dailyLimit);
  if (dailySpend + amount > dailyLimit) {
    return {
      allowed: false,
      reason: `Would exceed daily limit: spent ${formatUsd(dailySpend)} + ${formatUsd(amount)} > ${formatUsd(dailyLimit)}`,
    };
  }

  try {
    const domain = new URL(url).hostname;
    if (policy.blockedDomains.includes(domain)) {
      return { allowed: false, reason: `Domain ${domain} is blocked` };
    }
    if (policy.allowedDomains.length > 0 && !policy.allowedDomains.includes(domain)) {
      return { allowed: false, reason: `Domain ${domain} is not in allowed list` };
    }
  } catch {}

  // Check agent wallet is configured
  if (!policy.agentWalletAddress) {
    return { allowed: false, reason: "No agent wallet configured for x402 payments. Set agentWalletAddress in x402 policy." };
  }

  return { allowed: true };
}

/**
 * Format USDC atomic units as a dollar string (6 decimals, 2 shown).
 * Display-only: never use the rounded string for on-chain amounts or limit math.
 * @param atomicUnits — USDC atomic units (number; large values lose precision past 2^53).
 * @returns The amount as "$X.XX".
 * @throws Never throws.
 * Maps to: internal — x402-client logging and stats (payment display).
 */
export function formatUsd(atomicUnits: number): string {
  return `$${(atomicUnits / 10 ** USDC_DECIMALS).toFixed(2)}`;
}

// ── ERC-4337 Payment Execution ───────────────────────────────────────────────

/**
 * Pay a USDC x402 requirement through the agent's ERC-4337 wallet via the local bundler.
 * Flow: compiler-gateway risk check, USDC.transfer wrapped in AgentWallet.execute, session-key-signed UserOp, bundler submission; the tx hash is the proof of payment.
 * @param walletAddress — the AgentWallet to pay from; `payTo` — the merchant; `amount` — atomic USDC units (string).
 * @param network — the eip155 network id, e.g. "eip155:84532"; unknown networks return a failure result.
 * @returns { success, txHash, userOpHash, amount, currency } on success; { success: false, error } on any failure (never throws for payment failures).
 * @throws Never throws for payment failures — all are returned; only unexpected internal errors propagate.
 * Maps to: internal — fetchWithPayment (the payment executor).
 * Side effects: broadcasts a UserOp (value transfer) when the risk gate approves.
 * Security: the session key signs the UserOp; a missing key, an unallowlisted token, or a risk-gate denial all fail closed.
 */
async function executePaymentViaBundler(
  walletAddress: string,
  payTo: string,
  amount: string,
  network: string,
): Promise<X402PaymentResult> {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Get USDC address for this network
  const usdcAddress = USDC_ADDRESSES[network];
  if (!usdcAddress) {
    return { success: false, error: `No USDC address for network ${network}` };
  }

  // 1. Route through compiler gateway for risk assessment
  try {
    const { getCompilerGateway } = await import("../compiler-gateway");
    const gateway = getCompilerGateway();
    const riskResult = await gateway.executeIntent("wallet_execute", {
      walletAddress,
      target: usdcAddress,
      value: "0",
      data: "0x", // Will be overridden by actual calldata
      amount: amount,
      recipient: payTo,
      paymentType: "x402",
    }, "mcp", { walletAddress });

    if (!riskResult.success && riskResult.requiresApproval) {
      return {
        success: false,
        error: `x402 payment requires approval: ${riskResult.explanation || "Risk engine flagged this payment"}`,
      };
    }

    if (!riskResult.success) {
      return {
        success: false,
        error: `x402 payment blocked by risk engine: ${riskResult.errors?.join("; ") || "Unknown reason"}`,
      };
    }

    logger.info("x402", `Compiler approved payment: risk=${riskResult.warnings?.length || 0} warnings`);
  } catch (e: any) {
    // If compiler gateway is unavailable, fall through to direct execution
    // This ensures payments still work if the compiler package isn't loaded
    logger.warn("x402", `Compiler gateway unavailable, proceeding with direct execution: ${e.message}`);
  }

  // 1. Encode USDC.transfer(payTo, amount)
  const usdcIface = new ethers.Interface(USDC_ABI);
  const transferCalldata = usdcIface.encodeFunctionData("transfer", [payTo, amount]);

  // 2. Wrap in AgentWallet.execute(usdcAddress, 0, transferCalldata)
  const walletIface = new ethers.Interface(WALLET_EXECUTE_ABI);
  const executeCalldata = walletIface.encodeFunctionData("execute", [
    usdcAddress,
    0,
    transferCalldata,
  ]);

  // 3. Check USDC balance before attempting payment
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, provider);
  try {
    const balance: bigint = await usdc.balanceOf(walletAddress);
    if (balance < BigInt(amount)) {
      return {
        success: false,
        error: `Insufficient USDC: wallet has ${formatUsd(Number(balance))}, need ${formatUsd(Number(amount))}`,
      };
    }
  } catch (e: any) {
    logger.warn("x402", `Balance check failed: ${e.message} — proceeding anyway`);
  }

  // 4. Build UserOperation with the execute calldata
  const { buildSessionUserOp, bundleUserOp, computeUserOpHash } = await import("../runtime/bundler");

  // Get the session key from policy or use the agent key
  const policy = getPaymentPolicy();
  const sessionKey = policy.sessionKey || process.env.AGENT_PRIVATE_KEY || "";

  if (!sessionKey) {
    return { success: false, error: "No session key available for signing UserOperation" };
  }

  // Look up the session ID for this wallet
  const sessionRow = runSingle<{ session_id: string }>(
    "SELECT session_id FROM sessions WHERE wallet_address = ? AND revoked = 0 AND expiry > unixepoch() ORDER BY created_at DESC LIMIT 1",
    walletAddress
  );
  const sessionId = sessionRow?.session_id || ethers.hexlify(ethers.randomBytes(32));

  // ── C-1 pre-flight: fail explicitly, not on-chain-opaque ──────────
  // Only when a real session was found (the random-id fallback below keeps
  // its existing behavior and fails on-chain with a session error).
  // If the allowlist read itself fails (no RPC, session not on-chain),
  // warn and proceed: the on-chain validator will deny a non-allowlisted
  // payment with a revert, which is explicit, not silent.
  if (sessionRow) {
    try {
      const { getAbiByName } = await import("../contracts");
      const sm = new ethers.Contract(config.contracts.sessionManager, getAbiByName("SessionManager"), provider);
      const targets: string[] = await sm.getSessionTargets(sessionId);
      const allowErr = checkTokenAllowlisted(targets, usdcAddress);
      if (allowErr) return { success: false, error: allowErr };
    } catch (e: any) {
      logger.warn("x402", `Session allowlist pre-flight unreadable, proceeding: ${e.message}`);
    }
  }

  let userOp;
  try {
    userOp = await buildSessionUserOp(
      walletAddress,
      executeCalldata,
      sessionId,
      sessionKey,
    );
  } catch (e: any) {
    return { success: false, error: `Failed to build UserOp: ${e.message}` };
  }

  // 5. Compute the UserOp hash for reference
  const userOpHash = await computeUserOpHash(userOp);

  // 6. Submit via local bundler
  logger.info("x402", `Submitting payment UserOp: wallet=${walletAddress.slice(0, 10)}... → ${payTo.slice(0, 10)}... amount=${formatUsd(Number(amount))}`);

  const result = await bundleUserOp(userOp);

  if (!result.success) {
    return { success: false, error: `Bundler rejected UserOp: ${result.error}`, userOpHash };
  }

  logger.info("x402", `Payment settled: tx=${result.txHash} amount=${formatUsd(Number(amount))}`);

  return {
    success: true,
    txHash: result.txHash,
    userOpHash,
    amount,
    currency: "USDC",
  };
}

// ── Core: Fetch with Payment ─────────────────────────────────────────────────

/**
 * Fetch a URL, automatically paying any 402 it returns and retrying with the payment proof.
 * The agent-side x402 flow: first attempt unpaid, parse requirements, policy-check, pay via the bundler, retry with PAYMENT-TX-HASH + standard x402 headers.
 * @param url — the resource; `options` — fetch options passed through to both attempts.
 * @param opts — autoPay (default true), maxRetries (default 1), walletAddress override, onPaymentRequest veto callback.
 * @returns { response, payment? } — response is the final fetch result; payment is present only when a 402 was handled.
 * @throws Throws only on network failure of the first fetch; payment failures are returned in `payment.error`.
 * Maps to: internal — paidFetch / paidFetchJSON (convenience wrappers) and agent HTTP calls.
 * Side effects: may broadcast a USDC payment (value transfer) and records it in the ledger on acceptance.
 */
export async function fetchWithPayment(
  url: string,
  options: RequestInit = {},
  opts: {
    autoPay?: boolean;
    maxRetries?: number;
    walletAddress?: string;    // Override the agent wallet to pay from
    onPaymentRequest?: (requirements: X402PaymentRequirements[]) => boolean;
  } = {}
): Promise<{ response: Response; payment?: X402PaymentResult }> {
  const { autoPay = true, maxRetries = 1, onPaymentRequest } = opts;

  // First attempt — no payment
  let response = await fetch(url, options);

  if (response.status !== 402) {
    return { response };
  }

  if (!autoPay) {
    return { response, payment: { success: false, error: "Payment required but autoPay is disabled" } };
  }

  // Parse payment requirements
  const requirements = parse402Response(response);
  if (!requirements || requirements.length === 0) {
    return { response, payment: { success: false, error: "402 response missing payment requirements" } };
  }

  if (onPaymentRequest && !onPaymentRequest(requirements)) {
    return { response, payment: { success: false, error: "Payment rejected by caller" } };
  }

  const requirement = selectBestRequirement(requirements);
  if (!requirement) {
    return { response, payment: { success: false, error: "No compatible payment requirement found" } };
  }

  // Check policy
  const policyCheck = checkPaymentPolicy(requirement, url);
  if (!policyCheck.allowed) {
    logger.warn("x402", `Payment blocked: ${policyCheck.reason}`);
    return { response, payment: { success: false, error: policyCheck.reason } };
  }

  // Get wallet address (from opts, policy, or DB)
  const policy = getPaymentPolicy();
  const walletAddress = opts.walletAddress || policy.agentWalletAddress;

  if (!walletAddress) {
    return { response, payment: { success: false, error: "No agent wallet address configured" } };
  }

  // Execute the payment through the ERC-4337 bundler
  const paymentResult = await executePaymentViaBundler(
    walletAddress,
    requirement.payTo,
    requirement.maxAmountRequired,
    requirement.network,
  );

  if (!paymentResult.success) {
    return { response, payment: paymentResult };
  }

  // Retry with payment proof (tx hash + wallet address)
  const retryHeaders: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
    "PAYMENT-TX-HASH": paymentResult.txHash!,
    "PAYMENT-WALLET": walletAddress,
    "PAYMENT-AMOUNT": requirement.maxAmountRequired,
    "PAYMENT-NETWORK": requirement.network,
    // Also send the standard x402 header for compatibility
    "PAYMENT": btoa(JSON.stringify({
      x402Version: 1,
      scheme: requirement.scheme,
      network: requirement.network,
      from: walletAddress,
      to: requirement.payTo,
      value: requirement.maxAmountRequired,
      txHash: paymentResult.txHash,
      resource: url,
    })),
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      response = await fetch(url, { ...options, headers: retryHeaders });

      if (response.status !== 402) {
        // Payment accepted
        try {
          const domain = new URL(url).hostname;
          recordPayment({
            url,
            domain,
            amount: requirement.maxAmountRequired,
            payTo: requirement.payTo,
            txHash: paymentResult.txHash!,
            userOpHash: paymentResult.userOpHash || "",
            scheme: requirement.scheme,
            network: requirement.network,
            walletAddress,
          });
        } catch {}

        return { response, payment: paymentResult };
      }
    } catch (e: any) {
      logger.error("x402", `Payment retry failed: ${e.message}`);
      return { response, payment: { success: false, error: `Retry failed: ${e.message}` } };
    }
  }

  return { response, payment: { success: false, error: "Max retries exceeded" } };
}

// ── Convenience ──────────────────────────────────────────────────────────────

/**
 * Fetch a URL with automatic x402 payment, returning just the response.
 * Convenience wrapper over fetchWithPayment for callers that do not need the payment detail.
 * @param url — the resource; `options` — fetch options.
 * @returns The final response (possibly still a 402 when payment failed — check response.status).
 * @throws Throws only on network failure of the first fetch.
 * Maps to: internal — fetchWithPayment (same flow, response only).
 */
export async function paidFetch(url: string, options?: RequestInit): Promise<Response> {
  const { response } = await fetchWithPayment(url, options);
  return response;
}

/**
 * Fetch a URL with automatic x402 payment and parse the response as JSON.
 * Convenience wrapper over paidFetch for JSON APIs; a non-OK final response throws with the status and body.
 * @param url — the resource; `options` — fetch options.
 * @returns The parsed JSON body as T.
 * @throws Throws on a non-OK final response (HTTP status + body) or on JSON parse failure.
 * Maps to: internal — paidFetch (JSON convenience wrapper).
 */
export async function paidFetchJSON<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await paidFetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

// ── Payment History ──────────────────────────────────────────────────────────

/**
 * List recorded x402 payments, newest first.
 * The audit trail for autonomous spending: every accepted payment lands here via recordPayment.
 * @param limit — max rows (default 50); 0 returns [].
 * @returns The payment rows (raw DB rows) in created_at descending order.
 * @throws Throws on DB failure.
 * Maps to: REST — x402 payment history endpoint (src/runtime/server.ts).
 */
export function getPaymentHistory(limit: number = 50): any[] {
  return runQuery(
    "SELECT * FROM x402_payments ORDER BY created_at DESC LIMIT ?",
    limit
  );
}

/**
 * Summarise x402 spending: lifetime total, transaction count, today's spend, and top domains.
 * Amounts are formatted dollars; counts are raw numbers; an empty ledger returns zeros, not an error.
 * @returns { totalSpent, totalTransactions, dailySpend, topDomains[{ domain, total, count }] } (top 10 domains).
 * @throws Throws on DB failure.
 * Maps to: REST — x402 payment stats endpoint (src/runtime/server.ts).
 */
export function getPaymentStats(): {
  totalSpent: string;
  totalTransactions: number;
  dailySpend: string;
  topDomains: Array<{ domain: string; total: string; count: number }>;
} {
  const total = runSingle<{ total: number; count: number }>(
    "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total, COUNT(*) as count FROM x402_payments"
  );
  const daily = getDailySpend();
  const domains = runQuery<{ domain: string; total: number; count: number }>(
    `SELECT domain, SUM(CAST(amount AS INTEGER)) as total, COUNT(*) as count 
     FROM x402_payments GROUP BY domain ORDER BY total DESC LIMIT 10`
  );

  return {
    totalSpent: formatUsd(total?.total || 0),
    totalTransactions: total?.count || 0,
    dailySpend: formatUsd(daily),
    topDomains: domains.map(d => ({
      domain: d.domain,
      total: formatUsd(d.total),
      count: d.count,
    })),
  };
}

/**
 * Return an agent wallet's USDC balance as a formatted dollar string.
 * A read-only balance check for display and pre-flight; it never moves funds.
 * @param walletAddress — the wallet to check; `network` — the eip155 id (defaults to the configured chain).
 * @returns The balance as "$X.XX"; "0" for unknown networks or any read failure.
 * @throws Never throws — read failures return "0".
 * Maps to: REST — wallet USDC balance endpoint (src/runtime/server.ts).
 * Side effects: one balanceOf eth_call (network I/O).
 */
export async function getUsdcBalance(walletAddress: string, network?: string): Promise<string> {
  const config = loadConfig();
  const isTestnet = config.chainId === 84532;
  const net = network || (isTestnet ? "eip155:84532" : "eip155:8453");
  const usdcAddress = USDC_ADDRESSES[net];
  if (!usdcAddress) return "0";

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, provider);
  try {
    const balance: bigint = await usdc.balanceOf(walletAddress);
    return formatUsd(Number(balance));
  } catch {
    return "0";
  }
}

export { USDC_ADDRESSES, USDC_DECIMALS };
