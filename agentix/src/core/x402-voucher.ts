/**
 * x402-voucher.ts — Zero-latency payment vouchers for AI agents.
 *
 * Instead of waiting for on-chain confirmation per request, agents sign
 * EIP-712 payment vouchers that the server verifies locally (instant).
 * Vouchers are batch-settled later via a single executeBatch() UserOp.
 *
 * Flow:
 *   1. Agent has an active session on its AgentWallet with USDC
 *   2. For each paid request, agent signs a PaymentVoucher with session key
 *   3. Server verifies signature locally (0ms, no on-chain call)
 *   4. Server serves response immediately
 *   5. Background: server batches vouchers → single executeBatch() UserOp
 *
 * This gives agents ~0ms per-request payment latency instead of 3-5s.
 */

import { ethers } from "ethers";
import { logger } from "./logger";
import { loadConfig } from "./config";
import { runExecute, runSingle, runQuery } from "./database";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaymentVoucher {
  wallet: string;          // AgentWallet (smart contract) address
  payTo: string;           // Merchant receiving address
  amount: string;          // USDC atomic units (6 decimals)
  nonce: string;           // Unique per-voucher (bytes32)
  expiry: number;          // Unix timestamp — voucher expires after this
  resource: string;        // What the payment is for (URL or resource ID)
  sessionKey: string;      // The session key that signed this voucher
  signature: string;       // EIP-712 signature from the session key
}

export interface VoucherBatch {
  vouchers: PaymentVoucher[];
  totalAmount: string;
  uniquePayTos: string[];
}

export interface BatchSettlementResult {
  success: boolean;
  txHash?: string;
  userOpHash?: string;
  settledCount: number;
  totalAmount: string;
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const DEFAULT_VOUCHER_EXPIRY = 300; // 5 minutes
const MAX_BATCH_SIZE = 50;
const MAX_VOUCHER_AGE_MS = 5 * 60 * 1000; // 5 minutes

const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453":  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const WALLET_ABI = [
  "function execute(address target, uint256 value, bytes calldata data) external",
  "function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external",
];

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

// EIP-712 domain and types for payment vouchers
const VOUCHER_DOMAIN_NAME = "AgentIX-PaymentVoucher";
const VOUCHER_DOMAIN_VERSION = "1";

const VOUCHER_TYPES = {
  PaymentVoucher: [
    { name: "wallet", type: "address" },
    { name: "payTo", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "resource", type: "string" },
  ],
};

// ── Nonce Tracking (prevents replay) ─────────────────────────────────────────

const usedNonces = new Set<string>();

/**
 * Record a voucher nonce as used, in memory and in the DB (crash recovery).
 * Must run BEFORE serving the response: a voucher whose nonce is not yet marked could be replayed.
 * @param nonce — the voucher's bytes32 nonce; marking twice is a harmless no-op (INSERT OR IGNORE).
 * @returns Nothing.
 * @throws Throws on DB failure — callers in acceptVoucher let that propagate rather than serve an unmarked voucher.
 * Maps to: internal — acceptVoucher (replay protection).
 * Side effects: adds the nonce to the in-memory set and the x402_used_nonces table.
 */
function markNonceUsed(nonce: string): void {
  usedNonces.add(nonce);
  // Persist to DB for crash recovery
  runExecute(
    `INSERT OR IGNORE INTO x402_used_nonces (nonce, used_at) VALUES (?, ?)`,
    nonce,
    Math.floor(Date.now() / 1000)
  );
}

/**
 * Check whether a voucher nonce was already used (memory first, then the DB for pre-restart nonces).
 * The replay check: a used nonce means the voucher was already accepted once.
 * @param nonce — the voucher's bytes32 nonce.
 * @returns True when the nonce is known-used; false otherwise (unknown nonces are fresh).
 * @throws Throws on DB failure when the in-memory set misses (the DB lookup is not guarded).
 * Maps to: internal — verifyVoucher (step 2: replay check).
 * Side effects: warms the in-memory set from the DB on a hit.
 */
function isNonceUsed(nonce: string): boolean {
  if (usedNonces.has(nonce)) return true;
  // Check DB for nonces from before last restart
  const row = runSingle("SELECT nonce FROM x402_used_nonces WHERE nonce = ?", nonce);
  if (row) {
    usedNonces.add(nonce);
    return true;
  }
  return false;
}

// ── Session Key Cache (avoids repeated on-chain lookups) ─────────────────────

interface SessionKeyInfo {
  walletAddress: string;
  sessionKey: string;
  sessionId: string;
  expiry: number;
  verifiedAt: number;
  dailySpendLimit: string;
  dailySpendUsed: string;
}

const sessionKeyCache = new Map<string, SessionKeyInfo>();

const SESSION_KEY_CACHE_TTL = 60_000; // 1 minute

/**
 * Verify that a session key is authorised for a wallet (local DB first, 1-minute cache).
 * The session-authorisation check behind voucher verification: only a live, unrevoked session's key may sign vouchers.
 * @param walletAddress — the AgentWallet; `sessionKey` — the claimed signer address.
 * @returns { valid, sessionInfo, error } — sessionInfo carries the session id, expiry, and daily spend limit/used.
 * @throws Never throws — DB/on-chain failures resolve to { valid: false }.
 * Maps to: internal — verifyVoucher (step 5: session authorisation).
 * Side effects: caches successful verifications for 60s (a revocation inside the window is still honoured after expiry).
 * Security: NOTE — the on-chain fallback in this function is a no-op (it builds the contract but never queries it); the local DB is the only real check. Do not rely on it for sessions unknown to this DB.
 */
export async function verifySessionKey(
  walletAddress: string,
  sessionKey: string
): Promise<{ valid: boolean; sessionInfo?: SessionKeyInfo; error?: string }> {
  const cacheKey = `${walletAddress.toLowerCase()}:${sessionKey.toLowerCase()}`;
  const cached = sessionKeyCache.get(cacheKey);
  if (cached && Date.now() - cached.verifiedAt < SESSION_KEY_CACHE_TTL) {
    return { valid: true, sessionInfo: cached };
  }

  // Check local DB for active sessions
  const session = runSingle<{
    session_id: string;
    expiry: number;
    daily_spend_limit: string;
    daily_tx_limit: number;
  }>(
    `SELECT session_id, expiry, daily_spend_limit, daily_tx_limit 
     FROM sessions 
     WHERE wallet_address = ? AND session_key = ? AND revoked = 0 AND expiry > unixepoch()`,
    walletAddress,
    sessionKey
  );

  if (session) {
    const info: SessionKeyInfo = {
      walletAddress,
      sessionKey,
      sessionId: session.session_id,
      expiry: session.expiry,
      verifiedAt: Date.now(),
      dailySpendLimit: session.daily_spend_limit,
      dailySpendUsed: "0",
    };
    sessionKeyCache.set(cacheKey, info);
    return { valid: true, sessionInfo: info };
  }

  // If not in DB, check on-chain
  try {
    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const smAbi = [
      "function getSessionType(bytes32) view returns (uint8)",
      "function getLightSession(bytes32) view returns (tuple(address sessionKey, address sessionWallet, uint256 dailySpendLimit, uint256 dailyTxLimit, uint256 dailySpendUsed, uint256 dailyTxUsed, uint64 expiry, bool revoked))",
    ];
    const sm = new ethers.Contract(config.contracts.sessionManager, smAbi, provider);

    // We'd need the session ID to look up on-chain. For now, trust the local DB.
    // In production, the voucher would include the sessionId.
  } catch {}

  return { valid: false, error: "Session key not found or expired" };
}

// ── Voucher Signing (Agent Side) ─────────────────────────────────────────────

/**
 * Build the EIP-712 domain for payment vouchers on one chain.
 * Domain separation is what stops a voucher signed for Sepolia being replayed on mainnet (and vice versa).
 * @param chainId — the chain the voucher is for.
 * @returns The domain { name: "AgentIX-PaymentVoucher", version: "1", chainId }.
 * @throws Never throws.
 * Maps to: internal — signVoucher / verifyVoucher (EIP-712 domain).
 */
export function getVoucherDomain(chainId: number): Record<string, any> {
  return {
    name: VOUCHER_DOMAIN_NAME,
    version: VOUCHER_DOMAIN_VERSION,
    chainId,
  };
}

/**
 * Sign one EIP-712 payment voucher with the session key (agent side).
 * Local and fast (~5ms): signing never touches the chain, which is what makes the zero-latency path possible.
 * @param params — wallet, payTo, amount (atomic USDC string), resource, sessionKeyWallet (the signer), chainId, expirySeconds (default 300s).
 * @returns The signed PaymentVoucher (fresh random bytes32 nonce, expiry, sessionKey = signer address).
 * @throws Throws when the wallet cannot sign (e.g. a bad signer) or the amount is not a valid uint256.
 * Maps to: internal — executeBatchPaid / signVoucherBatch (agent-side voucher creation).
 * Security: the signature authorises a real USDC transfer up to `amount` — only sign vouchers the session is meant to pay.
 */
export async function signVoucher(params: {
  wallet: string;
  payTo: string;
  amount: string;
  resource: string;
  sessionKeyWallet: ethers.Wallet;
  chainId: number;
  expirySeconds?: number;
}): Promise<PaymentVoucher> {
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const expiry = Math.floor(Date.now() / 1000) + (params.expirySeconds || DEFAULT_VOUCHER_EXPIRY);

  const domain = getVoucherDomain(params.chainId);
  const value = {
    wallet: params.wallet,
    payTo: params.payTo,
    amount: BigInt(params.amount),
    nonce,
    expiry: BigInt(expiry),
    resource: params.resource,
  };

  const signature = await params.sessionKeyWallet.signTypedData(
    domain,
    VOUCHER_TYPES,
    value
  );

  return {
    wallet: params.wallet,
    payTo: params.payTo,
    amount: params.amount,
    nonce,
    expiry,
    resource: params.resource,
    sessionKey: params.sessionKeyWallet.address,
    signature,
  };
}

/**
 * Sign many vouchers in parallel with one session key (different nonce per voucher).
 * The batch-signing primitive for executeBatchPaid: all payments for a batch are authorised in one local step.
 * @param params — wallet, payments[{ payTo, amount, resource }], sessionKeyWallet, chainId, expirySeconds.
 * @returns The signed vouchers in the same order as the payments.
 * @throws Throws when any single voucher fails to sign (Promise.all rejects on the first failure).
 * Maps to: internal — executeBatchPaid (step 4: sign all vouchers at once).
 */
export async function signVoucherBatch(params: {
  wallet: string;
  payments: Array<{ payTo: string; amount: string; resource: string }>;
  sessionKeyWallet: ethers.Wallet;
  chainId: number;
  expirySeconds?: number;
}): Promise<PaymentVoucher[]> {
  return Promise.all(
    params.payments.map(p =>
      signVoucher({
        wallet: params.wallet,
        payTo: p.payTo,
        amount: p.amount,
        resource: p.resource,
        sessionKeyWallet: params.sessionKeyWallet,
        chainId: params.chainId,
        expirySeconds: params.expirySeconds,
      })
    )
  );
}

// ── Voucher Verification (Server Side) ───────────────────────────────────────

/**
 * Verify a voucher without accepting it: expiry, nonce replay, EIP-712 signature, session key, and daily spend limit.
 * Pure verification — it never marks the nonce used, so a verified-but-unaccepted voucher can still be presented again.
 * @param voucher — the presented voucher; `chainId` — the chain the domain must match.
 * @returns { valid } or { valid: false, error } naming the failed check.
 * @throws Never throws — signature recovery failures are returned, not raised.
 * Maps to: internal — acceptVoucher (verification step before acceptance).
 * Security: the daily-limit check reads dailySpendUsed from the cached session info, which is initialised to "0" — treat the limit as advisory until spend tracking is wired through.
 */
export async function verifyVoucher(
  voucher: PaymentVoucher,
  chainId: number
): Promise<{ valid: boolean; error?: string }> {
  // 1. Check expiry
  if (voucher.expiry < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: "Voucher expired" };
  }

  // 2. Check nonce (prevent replay)
  if (isNonceUsed(voucher.nonce)) {
    return { valid: false, error: "Voucher nonce already used" };
  }

  // 3. Recover signer from EIP-712 signature
  const domain = getVoucherDomain(chainId);
  const value = {
    wallet: voucher.wallet,
    payTo: voucher.payTo,
    amount: BigInt(voucher.amount),
    nonce: voucher.nonce,
    expiry: BigInt(voucher.expiry),
    resource: voucher.resource,
  };

  let recoveredAddress: string;
  try {
    recoveredAddress = ethers.verifyTypedData(domain, VOUCHER_TYPES, value, voucher.signature);
  } catch (e: any) {
    return { valid: false, error: `Invalid signature: ${e.message}` };
  }

  // 4. Verify the recovered address matches the claimed session key
  if (recoveredAddress.toLowerCase() !== voucher.sessionKey.toLowerCase()) {
    return { valid: false, error: "Signature does not match session key" };
  }

  // 5. Verify the session key is authorized for this wallet
  const sessionCheck = await verifySessionKey(voucher.wallet, voucher.sessionKey);
  if (!sessionCheck.valid) {
    return { valid: false, error: sessionCheck.error };
  }

  // 6. Check daily spend limit
  if (sessionCheck.sessionInfo) {
    const dailyUsed = BigInt(sessionCheck.sessionInfo.dailySpendUsed || "0");
    const dailyLimit = BigInt(sessionCheck.sessionInfo.dailySpendLimit || "0");
    const voucherAmount = BigInt(voucher.amount);

    if (dailyLimit > 0n && dailyUsed + voucherAmount > dailyLimit) {
      return { valid: false, error: "Would exceed daily spend limit" };
    }
  }

  return { valid: true };
}

/**
 * Assess a verified voucher against the shared bundler risk gate WITHOUT executing anything.
 * The voucher amount is presented as ERC-20 transfer calldata, so the gate's token decoding sees it as a token move and the owner policy's token-action/target allowlists apply.
 * @param voucher — the verified voucher; only its wallet, payTo, and amount are assessed.
 * @returns { allowed, reason } from the risk gate.
 * @throws Throws when the risk gate itself errors — acceptVoucher treats that as a rejection, not an approval.
 * Maps to: internal — acceptVoucher (risk assessment) and runtime bundler-risk-gate.
 * Security: assessment never sends a transaction and never touches a signer.
 */
export async function assessVoucherPayment(
  voucher: PaymentVoucher
): Promise<{ allowed: boolean; reason: string }> {
  const { assessBundlerOp } = await import("../runtime/bundler-risk-gate");
  const transferCalldata = new ethers.Interface([
    "function transfer(address to, uint256 amount) returns (bool)",
  ]).encodeFunctionData("transfer", [voucher.payTo, voucher.amount]);
  const gate = await assessBundlerOp({
    sender: voucher.wallet,
    target: voucher.payTo,
    value: "0",
    calldata: transferCalldata,
  });
  return { allowed: gate.allowed, reason: gate.reason };
}

/**
 * Verify a voucher, risk-assess it, then mark its nonce used and record it for batch settlement.
 * The server-side acceptance entry point: fail-closed at every step (a risk-gate error rejects, it never accepts on signature alone).
 * @param voucher — the presented voucher; `chainId` — the chain the domain must match.
 * @returns { accepted: true } or { accepted: false, error }.
 * @throws Never throws for verification/assessment failures — they are returned; DB failures from markNonceUsed/recordVoucher propagate.
 * Maps to: REST — voucher acceptance in x402-seller verifyVoucherPayment.
 * Side effects: marks the nonce used and inserts a 'pending' row in x402_vouchers.
 * Security: the nonce is marked BEFORE the response is served, so a voucher cannot be double-spent in flight.
 */
export async function acceptVoucher(
  voucher: PaymentVoucher,
  chainId: number
): Promise<{ accepted: boolean; error?: string }> {
  const check = await verifyVoucher(voucher, chainId);
  if (!check.valid) return { accepted: false, error: check.error };

  // Non-executing risk assessment. The pre-fix code called
  // gateway.executeIntent("wallet_execute", …) as a "risk check" — which
  // EXECUTED a real wallet.execute transaction as a side effect — and on
  // any gateway exception accepted the voucher on signature alone
  // (fail-open). Both are gone: assessment never executes, and any
  // assessment failure or error REJECTS the voucher.
  try {
    const assessment = await assessVoucherPayment(voucher);
    if (!assessment.allowed) {
      return { accepted: false, error: `Voucher blocked by risk gate: ${assessment.reason}` };
    }
  } catch (e: any) {
    logger.warn("x402-voucher", `Risk assessment failed, rejecting voucher: ${e.message}`);
    return { accepted: false, error: `Voucher risk assessment failed: ${e.message}` };
  }

  // Mark nonce as used BEFORE serving the response (prevent double-spend)
  markNonceUsed(voucher.nonce);

  // Record the voucher for batch settlement
  recordVoucher(voucher);

  return { accepted: true };
}

// ── Voucher Storage ──────────────────────────────────────────────────────────

/**
 * Store an accepted voucher as 'pending' for later batch settlement.
 * The settlement queue: getPendingVouchers reads these rows, and settleVoucherBatch flips them to settled.
 * @param voucher — the accepted voucher; all eight fields are stored (signature included for audit).
 * @returns Nothing.
 * @throws Throws on DB failure — callers in acceptVoucher let that propagate rather than serve an unrecorded voucher.
 * Maps to: internal — acceptVoucher (settlement bookkeeping).
 * Side effects: inserts one 'pending' row into x402_vouchers.
 */
function recordVoucher(voucher: PaymentVoucher): void {
  runExecute(
    `INSERT INTO x402_vouchers 
     (wallet, pay_to, amount, nonce, expiry, resource, session_key, signature, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    voucher.wallet,
    voucher.payTo,
    voucher.amount,
    voucher.nonce,
    voucher.expiry,
    voucher.resource,
    voucher.sessionKey,
    voucher.signature,
    Math.floor(Date.now() / 1000)
  );
}

/**
 * List accepted-but-unsettled vouchers, oldest first, excluding expired ones.
 * The settlement queue read: the periodic settler and the manual settle endpoint both drain through here.
 * @param limit — max vouchers (default 50, MAX_BATCH_SIZE).
 * @returns The pending vouchers as PaymentVouchers; [] when the queue is empty.
 * @throws Throws on DB failure.
 * Maps to: REST — pending-voucher endpoints (src/runtime/server.ts) and startPeriodicSettlement.
 */
export function getPendingVouchers(limit: number = MAX_BATCH_SIZE): PaymentVoucher[] {
  const rows = runQuery(
    `SELECT * FROM x402_vouchers 
     WHERE status = 'pending' AND expiry > unixepoch()
     ORDER BY created_at ASC 
     LIMIT ?`,
    limit
  );
  return rows.map((r: any) => ({
    wallet: r.wallet,
    payTo: r.pay_to,
    amount: r.amount,
    nonce: r.nonce,
    expiry: r.expiry,
    resource: r.resource,
    sessionKey: r.session_key,
    signature: r.signature,
  }));
}

/**
 * Flip vouchers to 'settled' with the settlement transaction hash.
 * One UPDATE per nonce: a partially-settled batch leaves the failed vouchers pending for the next run.
 * @param nonces — the settled vouchers' nonces; `txHash` — the batch settlement tx ("" when unknown).
 * @returns Nothing.
 * @throws Throws on DB failure part-way through (earlier nonces are already settled — the batch is not atomic).
 * Maps to: internal — settleVoucherBatch (post-settlement bookkeeping).
 * Side effects: updates x402_vouchers rows to status 'settled'.
 */
function markVouchersSettled(nonces: string[], txHash: string): void {
  for (const nonce of nonces) {
    runExecute(
      `UPDATE x402_vouchers SET status = 'settled', settled_at = ?, settlement_tx = ? WHERE nonce = ?`,
      Math.floor(Date.now() / 1000),
      txHash,
      nonce
    );
  }
}

// ── Batch Settlement (Server Side) ───────────────────────────────────────────

/**
 * Group vouchers by wallet address so each wallet gets one executeBatch() UserOp.
 * Batch settlement is per-wallet: one wallet's UserOp cannot spend another wallet's funds.
 * @param vouchers — the vouchers to settle; grouping is case-insensitive on the wallet address.
 * @returns A map from lowercased wallet address to its vouchers (empty map for empty input).
 * @throws Never throws.
 * Maps to: internal — settleVoucherBatch (per-wallet settlement).
 */
export function groupVouchersByWallet(vouchers: PaymentVoucher[]): Map<string, PaymentVoucher[]> {
  const groups = new Map<string, PaymentVoucher[]>();
  for (const v of vouchers) {
    const key = v.wallet.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }
  return groups;
}

/**
 * Build the executeBatch() arguments (targets, values, data) that settle one wallet's vouchers.
 * Every voucher becomes one USDC.transfer(payTo, amount) with zero native value, all to the chain's USDC contract.
 * @param vouchers — one wallet's vouchers (mixing wallets would build a batch no single wallet can execute).
 * @returns { targets, values, data } — parallel arrays for AgentWallet.executeBatch.
 * @throws Throws when a voucher amount is not a valid uint256 (ABI encoding failure).
 * Maps to: contract AgentWallet.executeBatch (batch settlement calldata).
 */
export function buildBatchCalldata(vouchers: PaymentVoucher[]): {
  targets: string[];
  values: string[];
  data: string[];
} {
  const config = loadConfig();
  const isTestnet = config.chainId === 84532;
  const usdcAddress = USDC_ADDRESSES[isTestnet ? "eip155:84532" : "eip155:8453"];

  const usdcIface = new ethers.Interface(USDC_ABI);

  const targets: string[] = [];
  const values: string[] = [];
  const data: string[] = [];

  for (const v of vouchers) {
    targets.push(usdcAddress);
    values.push("0");
    data.push(usdcIface.encodeFunctionData("transfer", [v.payTo, v.amount]));
  }

  return { targets, values, data };
}

/**
 * Settle a batch of accepted vouchers on-chain: one executeBatch() UserOp per wallet via the local bundler.
 * The delayed half of the zero-latency flow: servers serve instantly on vouchers and settle later, in bulk.
 * @param vouchers — the vouchers to settle; [] returns success with settledCount 0.
 * @param bundlerPrivateKey — overrides the signing key (defaults to the first voucher's session key per wallet).
 * @returns { success, txHash, userOpHash, settledCount, totalAmount, error } — success is false when any wallet's batch failed.
 * @throws Never throws for per-wallet failures (they are collected); unexpected errors inside a wallet's attempt are caught per wallet.
 * Maps to: REST — manual settle endpoint (src/runtime/server.ts) and startPeriodicSettlement.
 * Side effects: broadcasts one UserOp per wallet (USDC transfers) and marks settled vouchers in the DB.
 * Security: settlement spends real USDC from the agent wallets — only run with vouchers that passed acceptVoucher.
 */
export async function settleVoucherBatch(
  vouchers: PaymentVoucher[],
  bundlerPrivateKey?: string
): Promise<BatchSettlementResult> {
  if (vouchers.length === 0) {
    return { success: true, settledCount: 0, totalAmount: "0" };
  }

  // Group by wallet
  const groups = groupVouchersByWallet(vouchers);
  const results: Array<{ success: boolean; txHash?: string; error?: string; count: number }> = [];

  for (const [walletAddress, walletVouchers] of groups) {
    const { targets, values, data } = buildBatchCalldata(walletVouchers);
    const totalAmount = walletVouchers.reduce((sum, v) => sum + BigInt(v.amount), 0n);

    logger.info("x402-settle", `Settling ${walletVouchers.length} vouchers for wallet ${walletAddress.slice(0, 10)}... total=${formatUsd(Number(totalAmount))}`);

    try {
      // Build the executeBatch() calldata
      const walletIface = new ethers.Interface(WALLET_ABI);
      const executeBatchCalldata = walletIface.encodeFunctionData("executeBatch", [targets, values, data]);

      // Submit via bundler
      const { buildSessionUserOp, bundleUserOp } = await import("../runtime/bundler");

      // Use the first voucher's session key for signing
      const sessionKey = walletVouchers[0].sessionKey;
      const sessionRow = runSingle<{ session_id: string }>(
        `SELECT session_id FROM sessions WHERE wallet_address = ? AND session_key = ? AND revoked = 0 LIMIT 1`,
        walletAddress,
        sessionKey
      );
      const sessionId = sessionRow?.session_id || ethers.hexlify(ethers.randomBytes(32));

      const userOp = await buildSessionUserOp(
        walletAddress,
        executeBatchCalldata,
        sessionId,
        bundlerPrivateKey || sessionKey, // In production, the bundler has the session key
      );

      const result = await bundleUserOp(userOp);

      if (result.success) {
        markVouchersSettled(walletVouchers.map(v => v.nonce), result.txHash || "");
        results.push({ success: true, txHash: result.txHash, count: walletVouchers.length });
      } else {
        results.push({ success: false, error: result.error, count: walletVouchers.length });
      }
    } catch (e: any) {
      logger.error("x402-settle", `Batch settlement failed: ${e.message}`);
      results.push({ success: false, error: e.message, count: walletVouchers.length });
    }
  }

  const settledCount = results.filter(r => r.success).reduce((s, r) => s + r.count, 0);
  const failedCount = results.filter(r => !r.success).reduce((s, r) => s + r.count, 0);
  const totalAmount = vouchers.reduce((sum, v) => sum + BigInt(v.amount), 0n);

  return {
    success: failedCount === 0,
    txHash: results.find(r => r.success)?.txHash,
    settledCount,
    totalAmount: totalAmount.toString(),
    error: failedCount > 0 ? `${failedCount} vouchers failed to settle` : undefined,
  };
}

// ── Periodic Settlement Timer ─────────────────────────────────────────────────

let _settlementTimer: NodeJS.Timeout | null = null;
const SETTLEMENT_INTERVAL_MS = 30_000; // Settle every 30 seconds

/**
 * Start the background timer that settles pending vouchers on a schedule.
 * Idempotent — a second call while the timer exists does nothing; each tick settles whatever is pending at that moment.
 * @param intervalMs — the tick interval (default 30,000ms).
 * @returns Nothing.
 * @throws Never throws — per-tick settlement failures are logged, not raised.
 * Maps to: internal — server startup (background settlement loop).
 * Side effects: starts a repeating timer that reads the queue and broadcasts settlement UserOps.
 */
export function startPeriodicSettlement(intervalMs?: number): void {
  if (_settlementTimer) return;

  const interval = intervalMs || SETTLEMENT_INTERVAL_MS;
  logger.info("x402-settle", `Starting periodic settlement (every ${interval / 1000}s)`);

  _settlementTimer = setInterval(async () => {
    const pending = getPendingVouchers();
    if (pending.length === 0) return;

    logger.info("x402-settle", `Found ${pending.length} pending vouchers, settling...`);
    const result = await settleVoucherBatch(pending);
    logger.info("x402-settle", `Settlement complete: ${result.settledCount} settled, total=${formatUsd(Number(result.totalAmount))}`);
  }, interval);
}

/**
 * Stop the background settlement timer (a settlement already in flight runs to completion).
 * Call at graceful shutdown so the process can exit.
 * @returns Nothing; a no-op when the timer was never started.
 * @throws Never throws.
 * Maps to: internal — graceful shutdown (counterpart of startPeriodicSettlement).
 * Side effects: clears the interval timer.
 */
export function stopPeriodicSettlement(): void {
  if (_settlementTimer) {
    clearInterval(_settlementTimer);
    _settlementTimer = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format USDC atomic units as a dollar string (6 decimals, 4 shown).
 * Display-only: never use the rounded string for on-chain amounts or limit math.
 * @param atomicUnits — USDC atomic units (number; large values lose precision past 2^53).
 * @returns The amount as "$X.XXXX".
 * @throws Never throws.
 * Maps to: internal — x402-voucher logging and stats (voucher display).
 */
function formatUsd(atomicUnits: number): string {
  return `$${(atomicUnits / 10 ** USDC_DECIMALS).toFixed(4)}`;
}

// ── Voucher Stats ────────────────────────────────────────────────────────────

/**
 * Summarise the voucher queue: pending/settled counts and amounts.
 * Amounts are formatted dollars; counts are raw numbers; an empty store returns zeros, not an error.
 * @returns { pending, settled, pendingAmount, settledAmount }.
 * @throws Throws on DB failure.
 * Maps to: REST — voucher stats endpoint (src/runtime/server.ts).
 */
export function getVoucherStats(): {
  pending: number;
  settled: number;
  pendingAmount: string;
  settledAmount: string;
} {
  const pending = runSingle<{ count: number; total: number }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM x402_vouchers WHERE status = 'pending'`
  );
  const settled = runSingle<{ count: number; total: number }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM x402_vouchers WHERE status = 'settled'`
  );

  return {
    pending: pending?.count || 0,
    settled: settled?.count || 0,
    pendingAmount: formatUsd(pending?.total || 0),
    settledAmount: formatUsd(settled?.total || 0),
  };
}
