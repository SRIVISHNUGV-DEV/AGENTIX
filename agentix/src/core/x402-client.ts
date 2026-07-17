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

// AgentWallet execute ABI
const WALLET_EXECUTE_ABI = [
  "function execute(address target, uint256 value, bytes calldata data) external",
  "function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external",
];

// ── Policy Storage ───────────────────────────────────────────────────────────

export function getPaymentPolicy(): X402Policy {
  const row = runSingle<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    "x402_policy"
  );
  if (row) {
    try { return JSON.parse(row.value); } catch {}
  }
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

export function savePaymentPolicy(policy: X402Policy): void {
  runExecute(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('x402_policy', ?, unixepoch())`,
    JSON.stringify(policy)
  );
}

function getDailySpend(): number {
  const startOfDay = Math.floor(Date.now() / 86400000) * 86400;
  const row = runSingle<{ total: number }>(
    `SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total 
     FROM x402_payments WHERE created_at >= ?`,
    startOfDay
  );
  return row?.total || 0;
}

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

export function formatUsd(atomicUnits: number): string {
  return `$${(atomicUnits / 10 ** USDC_DECIMALS).toFixed(2)}`;
}

// ── ERC-4337 Payment Execution ───────────────────────────────────────────────

/**
 * Execute a USDC payment through the agent's ERC-4337 smart contract wallet.
 *
 * Flow:
 *   1. Route through compiler gateway for risk assessment
 *   2. If approved: encode USDC.transfer(payTo, amount) calldata
 *   3. Wrap in AgentWallet.execute(usdcAddress, 0, transferCalldata)
 *   4. Build UserOperation with the encoded callData
 *   5. Session key signs the UserOp hash
 *   6. Submit via local bundler (handleOps)
 *   7. Return tx hash as proof of payment
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
 * Wraps fetch to automatically handle HTTP 402 responses using ERC-4337 payments.
 * When the server responds with 402:
 *   1. Parse payment requirements
 *   2. Check policy (limits, domains)
 *   3. Execute USDC transfer via AgentWallet.execute() through the bundler
 *   4. Retry request with tx hash as proof of payment
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

export async function paidFetch(url: string, options?: RequestInit): Promise<Response> {
  const { response } = await fetchWithPayment(url, options);
  return response;
}

export async function paidFetchJSON<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await paidFetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

// ── Payment History ──────────────────────────────────────────────────────────

export function getPaymentHistory(limit: number = 50): any[] {
  return runQuery(
    "SELECT * FROM x402_payments ORDER BY created_at DESC LIMIT ?",
    limit
  );
}

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
 * Get the agent wallet's USDC balance.
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
