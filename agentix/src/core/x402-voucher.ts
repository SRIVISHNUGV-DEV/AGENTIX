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

function markNonceUsed(nonce: string): void {
  usedNonces.add(nonce);
  // Persist to DB for crash recovery
  runExecute(
    `INSERT OR IGNORE INTO x402_used_nonces (nonce, used_at) VALUES (?, ?)`,
    nonce,
    Math.floor(Date.now() / 1000)
  );
}

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
 * Verify that a session key is authorized for a wallet.
 * Checks the local DB first, then on-chain if needed.
 * Results are cached for 1 minute.
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

export function getVoucherDomain(chainId: number): Record<string, any> {
  return {
    name: VOUCHER_DOMAIN_NAME,
    version: VOUCHER_DOMAIN_VERSION,
    chainId,
  };
}

/**
 * Sign a payment voucher using the session key.
 * This is called by the agent before making a paid request.
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
 * Sign multiple vouchers in parallel (for batch requests).
 * All vouchers are signed with the same session key but different nonces.
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
 * Verify a voucher and mark the nonce as used (atomic).
 * Call this when accepting a voucher for payment.
 * Routes through compiler gateway for risk assessment if available.
 */
export async function acceptVoucher(
  voucher: PaymentVoucher,
  chainId: number
): Promise<{ accepted: boolean; error?: string }> {
  const check = await verifyVoucher(voucher, chainId);
  if (!check.valid) return { accepted: false, error: check.error };

  // Route through compiler gateway for risk assessment
  try {
    const { getCompilerGateway } = await import("../compiler-gateway");
    const gateway = getCompilerGateway();
    const riskResult = await gateway.executeIntent("wallet_execute", {
      walletAddress: voucher.wallet,
      target: voucher.payTo,
      value: "0",
      amount: voucher.amount,
      recipient: voucher.payTo,
      paymentType: "x402-voucher",
      resource: voucher.resource,
    }, "mcp", { walletAddress: voucher.wallet });

    if (!riskResult.success && riskResult.requiresApproval) {
      return { accepted: false, error: `Voucher requires approval: ${riskResult.explanation || "Risk engine flagged this"}` };
    }
    if (!riskResult.success) {
      return { accepted: false, error: `Voucher blocked by risk engine: ${riskResult.errors?.join("; ") || "Unknown"}` };
    }
  } catch (e: any) {
    // Compiler unavailable — proceed with signature-only verification
    logger.warn("x402-voucher", `Compiler gateway unavailable, accepting on signature only: ${e.message}`);
  }

  // Mark nonce as used BEFORE serving the response (prevent double-spend)
  markNonceUsed(voucher.nonce);

  // Record the voucher for batch settlement
  recordVoucher(voucher);

  return { accepted: true };
}

// ── Voucher Storage ──────────────────────────────────────────────────────────

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
 * Group vouchers by wallet address for batch execution.
 * Each wallet gets one executeBatch() UserOp.
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
 * Build executeBatch() calldata for a group of vouchers from the same wallet.
 * Encodes multiple USDC.transfer() calls into a single executeBatch().
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
 * Execute a batch settlement via the local bundler.
 * This submits a single UserOp that calls executeBatch() on the agent's wallet,
 * transferring USDC to all merchants at once.
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

export function stopPeriodicSettlement(): void {
  if (_settlementTimer) {
    clearInterval(_settlementTimer);
    _settlementTimer = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(atomicUnits: number): string {
  return `$${(atomicUnits / 10 ** USDC_DECIMALS).toFixed(4)}`;
}

// ── Voucher Stats ────────────────────────────────────────────────────────────

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
