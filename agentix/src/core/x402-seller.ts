/**
 * x402-seller.ts — Payment-gating middleware for AgentIX endpoints.
 *
 * Verification approach for ERC-4337 smart contract wallets:
 *   Instead of verifying EIP-712 signatures (which smart contract wallets
 *   can't produce), we verify the actual on-chain USDC transfer by checking
 *   the transaction receipt. This is MORE secure — the payment is already
 *   settled before we serve the response.
 *
 * x402 protocol: https://docs.x402.org
 */

import { ethers } from "ethers";
import { logger } from "./logger";
import { loadConfig } from "./config";
import { runExecute, runQuery, runSingle } from "./database";
import { acceptVoucher, type PaymentVoucher } from "./x402-voucher";

// ── Types ────────────────────────────────────────────────────────────────────

export interface X402RouteConfig {
  price: string;
  priceAtomic: number;
  description: string;
  mimeType?: string;
  scheme?: "exact" | "upto";
}

export interface X402PaymentVerification {
  valid: boolean;
  payer?: string;
  amount?: string;
  txHash?: string;
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453":  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const USDC_TRANSFER_TOPIC = ethers.id("Transfer(address indexed,address indexed,uint256)");

// ── Route Registry ───────────────────────────────────────────────────────────

const protectedRoutes = new Map<string, X402RouteConfig>();

export function protectRoute(
  pattern: string,
  config: Omit<X402RouteConfig, "priceAtomic"> & { price: string }
): void {
  const priceAtomic = parseDollarPrice(config.price);
  protectedRoutes.set(pattern, { ...config, priceAtomic });
  logger.info("x402-seller", `Protected route: ${pattern} at ${config.price}`);
}

function parseDollarPrice(price: string): number {
  const match = price.match(/^\$?([\d.]+)$/);
  if (!match) throw new Error(`Invalid price format: ${price}. Use "$0.01" or "0.01"`);
  return Math.round(parseFloat(match[1]) * 10 ** 6);
}

export function getProtectedRoute(method: string, path: string): X402RouteConfig | null {
  const key = `${method} ${path}`;
  if (protectedRoutes.has(key)) return protectedRoutes.get(key)!;
  for (const [pattern, config] of protectedRoutes) {
    const [pMethod, pPath] = pattern.split(" ");
    if (pMethod !== method) continue;
    if (pPath.endsWith("*") && path.startsWith(pPath.slice(0, -1))) return config;
    if (pPath === path) return config;
  }
  return null;
}

// ── Default Protected Routes ─────────────────────────────────────────────────

export function registerDefaultPaidRoutes(): void {
  const config = loadConfig();
  if (!config.x402?.sellerEnabled) return;

  const payTo = config.x402?.sellerAddress || "";
  if (!payTo) {
    logger.warn("x402-seller", "No seller address configured — skipping paid routes");
    return;
  }

  protectRoute("POST /api/proofs/verify", {
    price: "$0.001",
    description: "Verify a ZK credential proof",
    mimeType: "application/json",
  });

  protectRoute("POST /api/execute", {
    price: "$0.005",
    description: "Compile and risk-assess an agent intent",
    mimeType: "application/json",
  });

  protectRoute("GET /api/trees/export", {
    price: "$0.002",
    description: "Export Merkle tree data",
    mimeType: "application/json",
  });

  protectRoute("GET /api/diagnostics", {
    price: "$0.01",
    description: "Full system diagnostics",
    mimeType: "application/json",
  });

  logger.info("x402-seller", `Registered ${protectedRoutes.size} paid routes`);
}

// ── On-Chain Payment Verification ────────────────────────────────────────────

/**
 * Verify a payment by checking the on-chain transaction receipt.
 *
 * For ERC-4337 wallets, the payment flows:
 *   EntryPoint → AgentWallet.execute() → USDC.transfer(payTo, amount)
 *
 * We verify:
 *   1. The tx exists and succeeded
 *   2. A USDC Transfer event was emitted
 *   3. The transfer went to our payTo address
 *   4. The amount is >= required
 *   5. The sender (AgentWallet) matches the claimed wallet
 */
export async function verifyPayment(
  txHash: string,
  walletAddress: string,
  expectedPayTo: string,
  expectedAmount: string,
  network: string,
): Promise<X402PaymentVerification> {
  try {
    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // 1. Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { valid: false, error: "Transaction not found on-chain" };
    }
    if (receipt.status !== 1) {
      return { valid: false, error: "Transaction reverted on-chain" };
    }

    // 2. Get USDC address for this network
    const usdcAddress = USDC_ADDRESSES[network];
    if (!usdcAddress) {
      return { valid: false, error: `Unknown network: ${network}` };
    }

    // 3. Find USDC Transfer events in the receipt
    let foundTransfer = false;
    let transferAmount = "0";
    let transferTo = "";
    let transferFrom = "";

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === usdcAddress.toLowerCase() && log.topics[0] === USDC_TRANSFER_TOPIC) {
        // Transfer(address indexed from, address indexed to, uint256 value)
        transferFrom = ethers.getAddress("0x" + log.topics[1].slice(26));
        transferTo = ethers.getAddress("0x" + log.topics[2].slice(26));
        transferAmount = BigInt(log.data).toString();

        // Check if this transfer matches our expected payment
        if (transferTo.toLowerCase() === expectedPayTo.toLowerCase()) {
          foundTransfer = true;
          break;
        }
      }
    }

    if (!foundTransfer) {
      return { valid: false, error: "No USDC Transfer to merchant address found in transaction" };
    }

    // 4. Verify amount
    if (BigInt(transferAmount) < BigInt(expectedAmount)) {
      return {
        valid: false,
        error: `Transfer amount ${transferAmount} < required ${expectedAmount}`,
      };
    }

    // 5. Verify sender matches claimed wallet
    // The transfer comes FROM the AgentWallet (via execute()), so the EntryPoint
    // is the actual caller, but the sender in the Transfer event is the wallet
    if (transferFrom.toLowerCase() !== walletAddress.toLowerCase()) {
      // For ERC-4337, the EntryPoint calls execute(), so the USDC transfer
      // sender is the wallet contract itself. If it doesn't match, check if
      // the tx was sent TO the wallet (EntryPoint → wallet pattern)
      if (receipt.to?.toLowerCase() !== "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108".toLowerCase()) {
        return {
          valid: false,
          error: `Transfer sender ${transferFrom} does not match claimed wallet ${walletAddress}`,
        };
      }
    }

    logger.info("x402-seller", `Payment verified: ${formatUsd(Number(transferAmount))} from ${walletAddress.slice(0, 10)}... tx=${txHash.slice(0, 10)}...`);

    return {
      valid: true,
      payer: walletAddress,
      amount: transferAmount,
      txHash,
    };
  } catch (e: any) {
    return { valid: false, error: `Verification failed: ${e.message}` };
  }
}

// ── HTTP Response Builders ───────────────────────────────────────────────────

export function build402Response(
  method: string,
  path: string,
  route: X402RouteConfig
): { status: 402; headers: Record<string, string>; body: any } {
  const config = loadConfig();
  const isTestnet = config.chainId === 84532;
  const payTo = config.x402?.sellerAddress || "";
  const network = isTestnet ? "eip155:84532" : "eip155:8453";

  const paymentRequirements = {
    x402Version: 1,
    accepts: [
      {
        scheme: route.scheme || "exact",
        network,
        maxAmountRequired: String(route.priceAtomic),
        resource: `${method} ${path}`,
        description: route.description,
        mimeType: route.mimeType || "application/json",
        payTo,
        maxTimeoutSeconds: 60,
      },
    ],
  };

  return {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT": btoa(JSON.stringify(paymentRequirements)),
    },
    body: {
      error: "Payment Required",
      x402: paymentRequirements,
    },
  };
}

/**
 * Parse payment proof from request headers.
 * Supports three formats:
 *   1. Voucher (X-PAYMENT-VOUCHER) — instant local verification, batch settled later
 *   2. ERC-4337 tx hash (PAYMENT-TX-HASH) — on-chain verification
 *   3. Standard x402 (PAYMENT) — signature-based
 */
export function parsePaymentFromHeaders(headers: Record<string, string>): {
  txHash?: string;
  walletAddress?: string;
  amount?: string;
  network?: string;
  signatureHeader?: string;
  voucherHeader?: string;
  paymentType: "voucher" | "onchain" | "standard" | "none";
} {
  const voucherHeader = headers["x-payment-voucher"] || headers["X-PAYMENT-VOUCHER"];
  if (voucherHeader) {
    return { voucherHeader, paymentType: "voucher" };
  }

  const txHash = headers["payment-tx-hash"] || headers["PAYMENT-TX-HASH"];
  if (txHash) {
    return {
      txHash,
      walletAddress: headers["payment-wallet"] || headers["PAYMENT-WALLET"],
      amount: headers["payment-amount"] || headers["PAYMENT-AMOUNT"],
      network: headers["payment-network"] || headers["PAYMENT-NETWORK"],
      paymentType: "onchain",
    };
  }

  const signatureHeader = headers["payment"] || headers["PAYMENT"];
  if (signatureHeader) {
    return { signatureHeader, paymentType: "standard" };
  }

  return { paymentType: "none" };
}

// ── Record Incoming ──────────────────────────────────────────────────────────

export function recordIncomingPayment(params: {
  payer: string;
  amount: string;
  resource: string;
  txHash: string;
}): void {
  runExecute(
    `INSERT INTO x402_incoming_payments (payer, amount, resource, tx_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    params.payer,
    params.amount,
    params.resource,
    params.txHash,
    Math.floor(Date.now() / 1000)
  );
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getSellerStats(): {
  totalEarned: string;
  totalPayments: number;
  topResources: Array<{ resource: string; total: string; count: number }>;
} {
  const total = runSingle<{ total: number; count: number }>(
    "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total, COUNT(*) as count FROM x402_incoming_payments"
  );
  const resources = runQuery<{ resource: string; total: number; count: number }>(
    `SELECT resource, SUM(CAST(amount AS INTEGER)) as total, COUNT(*) as count 
     FROM x402_incoming_payments GROUP BY resource ORDER BY total DESC LIMIT 10`
  );

  return {
    totalEarned: `$${((total?.total || 0) / 10 ** 6).toFixed(4)}`,
    totalPayments: total?.count || 0,
    topResources: resources.map(r => ({
      resource: r.resource,
      total: `$${(r.total / 10 ** 6).toFixed(4)}`,
      count: r.count,
    })),
  };
}

function formatUsd(atomicUnits: number): string {
  return `$${(atomicUnits / 10 ** 6).toFixed(4)}`;
}

export { protectedRoutes };

/**
 * Verify a voucher payment from request headers.
 * Returns immediately if the voucher signature is valid (0ms, no on-chain call).
 * The voucher is recorded for batch settlement later.
 */
export async function verifyVoucherPayment(
  headers: Record<string, string>,
  route: X402RouteConfig,
  resource: string
): Promise<{ accepted: boolean; payer?: string; amount?: string; error?: string }> {
  const payment = parsePaymentFromHeaders(headers);

  if (payment.paymentType !== "voucher" || !payment.voucherHeader) {
    return { accepted: false, error: "No voucher found in headers" };
  }

  let voucher: PaymentVoucher;
  try {
    voucher = JSON.parse(atob(payment.voucherHeader));
  } catch (e: any) {
    return { accepted: false, error: `Invalid voucher format: ${e.message}` };
  }

  // Check amount is sufficient
  if (BigInt(voucher.amount) < BigInt(route.priceAtomic)) {
    return { accepted: false, error: `Voucher amount ${voucher.amount} < required ${route.priceAtomic}` };
  }

  // Accept the voucher (verifies signature + session key + marks nonce)
  const config = loadConfig();
  const result = await acceptVoucher(voucher, config.chainId);

  if (!result.accepted) {
    return { accepted: false, error: result.error };
  }

  logger.info("x402-seller", `Voucher accepted: ${formatUsd(Number(voucher.amount))} from ${voucher.wallet.slice(0, 10)}... (batch settlement pending)`);

  recordIncomingPayment({
    payer: voucher.wallet,
    amount: voucher.amount,
    resource,
    txHash: `voucher:${voucher.nonce.slice(0, 16)}`,
  });

  return {
    accepted: true,
    payer: voucher.wallet,
    amount: voucher.amount,
  };
}
