/**
 * x402-batch.ts — Agent-side batch payment orchestrator.
 *
 * This is the "zero-latency" path for agents making multiple paid requests.
 * Instead of paying per-request (3-5s each), the agent:
 *   1. Risk-analyzes ALL intents upfront (through the compiler pipeline)
 *   2. Signs ALL payment vouchers at once (local, ~5ms each)
 *   3. Fires ALL requests in parallel (each server verifies signature locally)
 *   4. Background: server batch-settles all vouchers in one executeBatch() UserOp
 *
 * Total latency for N requests: ~200ms (not N × 3-5s)
 */

import { ethers } from "ethers";
import { logger } from "./logger";
import { loadConfig } from "./config";
import {
  signVoucher,
  signVoucherBatch,
  type PaymentVoucher,
} from "./x402-voucher";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaidRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  maxAmountUsd?: string;    // Max willing to pay (e.g. "0.01")
}

export interface PaidRequestResult {
  url: string;
  status: number;
  paymentVoucher?: PaymentVoucher;
  responseBody?: string;
  error?: string;
  latencyMs: number;
}

export interface BatchPaymentResult {
  totalRequests: number;
  succeeded: number;
  failed: number;
  totalPaidUsd: string;
  wallClockMs: number;
  results: PaidRequestResult[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;

// ── Batch Payment Orchestrator ───────────────────────────────────────────────

/**
 * Execute multiple paid requests in parallel with zero per-request latency.
 *
 * @param requests - List of URLs/endpoints to access
 * @param agentWallet - The agent's ERC-4337 smart contract wallet address
 * @param sessionKeyWallet - The session key (ethers.Wallet) that signs vouchers
 * @param opts - Options for risk checking and settlement
 */
export async function executeBatchPaid(
  requests: PaidRequest[],
  agentWallet: string,
  sessionKeyWallet: ethers.Wallet,
  opts?: {
    riskCheck?: (requests: PaidRequest[]) => Promise<Array<{ allowed: boolean; reason?: string }>>;
    maxTotalUsd?: string;
    voucherExpirySeconds?: number;
  }
): Promise<BatchPaymentResult> {
  const start = Date.now();
  const config = loadConfig();

  // 1. Risk-analyze ALL intents upfront (if handler provided)
  if (opts?.riskCheck) {
    const riskResults = await opts.riskCheck(requests);
    const blocked = riskResults.filter(r => !r.allowed);
    if (blocked.length > 0) {
      logger.warn("x402-batch", `${blocked.length}/${requests.length} requests blocked by risk check`);
      // Filter out blocked requests
      const allowed = requests.filter((_, i) => riskResults[i].allowed);
      if (allowed.length === 0) {
        return {
          totalRequests: requests.length,
          succeeded: 0,
          failed: requests.length,
          totalPaidUsd: "0",
          wallClockMs: Date.now() - start,
          results: requests.map((r, i) => ({
            url: r.url,
            status: 0,
            error: riskResults[i].reason || "Blocked by risk check",
            latencyMs: 0,
          })),
        };
      }
      requests = allowed;
    }
  }

  // 2. Pre-fetch payment requirements for all URLs (parallel)
  const preflightResults = await Promise.allSettled(
    requests.map(async (req) => {
      const response = await fetch(req.url, {
        method: req.method || "GET",
        headers: req.headers || {},
        body: req.body,
      });
      if (response.status !== 402) {
        return { needsPayment: false, response, requirements: null };
      }
      const paymentHeader = response.headers.get("PAYMENT") || response.headers.get("payment");
      if (!paymentHeader) return { needsPayment: false, response, requirements: null };

      try {
        const decoded = JSON.parse(atob(paymentHeader));
        const accepts = decoded.accepts || [decoded];
        // Pick the best requirement (exact, our network)
        const isTestnet = config.chainId === 84532;
        const targetNetwork = isTestnet ? "eip155:84532" : "eip155:8453";
        const req = accepts.find((a: any) => a.scheme === "exact" && a.network === targetNetwork) || accepts[0];
        return { needsPayment: true, response, requirements: req };
      } catch {
        return { needsPayment: false, response, requirements: null };
      }
    })
  );

  // 3. Collect all that need payment
  const paymentNeeded: Array<{
    index: number;
    url: string;
    requirements: any;
  }> = [];

  const freeResults: PaidRequestResult[] = [];

  for (let i = 0; i < preflightResults.length; i++) {
    const result = preflightResults[i];
    if (result.status === "rejected") {
      freeResults.push({
        url: requests[i].url,
        status: 0,
        error: result.reason?.message || "Preflight failed",
        latencyMs: 0,
      });
      continue;
    }

    const { needsPayment, response, requirements } = result.value;
    if (!needsPayment) {
      freeResults.push({
        url: requests[i].url,
        status: response.status,
        responseBody: await response.text().catch(() => ""),
        latencyMs: 0,
      });
    } else {
      paymentNeeded.push({
        index: i,
        url: requests[i].url,
        requirements,
      });
    }
  }

  // 4. Sign ALL vouchers at once (parallel, local)
  let vouchers: PaymentVoucher[] = [];
  if (paymentNeeded.length > 0) {
    const payments = paymentNeeded.map(p => ({
      payTo: p.requirements.payTo,
      amount: p.requirements.maxAmountRequired,
      resource: p.url,
    }));

    vouchers = await signVoucherBatch({
      wallet: agentWallet,
      payments,
      sessionKeyWallet,
      chainId: config.chainId,
      expirySeconds: opts?.voucherExpirySeconds,
    });
  }

  // 5. Fire ALL paid requests in parallel (each includes its voucher)
  const paidResults = await Promise.allSettled(
    paymentNeeded.map(async (p, i) => {
      const reqStart = Date.now();
      const voucher = vouchers[i];
      const originalReq = requests[p.index];

      const response = await fetch(originalReq.url, {
        method: originalReq.method || "GET",
        headers: {
          ...(originalReq.headers || {}),
          // Payment voucher header
          "X-PAYMENT-VOUCHER": btoa(JSON.stringify(voucher)),
          // Also standard x402 header for compatibility
          "PAYMENT": btoa(JSON.stringify({
            x402Version: 1,
            scheme: "exact",
            network: config.chainId === 84532 ? "eip155:84532" : "eip155:8453",
            from: voucher.wallet,
            to: voucher.payTo,
            value: voucher.amount,
            nonce: voucher.nonce,
            expiry: voucher.expiry,
            signature: voucher.signature,
            sessionKey: voucher.sessionKey,
            resource: voucher.resource,
          })),
        },
        body: originalReq.body,
      });

      return {
        url: originalReq.url,
        status: response.status,
        paymentVoucher: voucher,
        responseBody: await response.text().catch(() => ""),
        latencyMs: Date.now() - reqStart,
      };
    })
  );

  // 6. Collect results
  const allResults: PaidRequestResult[] = [...freeResults];
  for (let i = 0; i < paidResults.length; i++) {
    const result = paidResults[i];
    if (result.status === "fulfilled") {
      allResults.push(result.value);
    } else {
      allResults.push({
        url: paymentNeeded[i].url,
        status: 0,
        error: result.reason?.message || "Request failed",
        latencyMs: 0,
      });
    }
  }

  const succeeded = allResults.filter(r => r.status >= 200 && r.status < 400).length;
  const failed = allResults.filter(r => r.status >= 400 || r.error).length;
  const totalPaid = vouchers.reduce((sum, v) => sum + BigInt(v.amount), 0n);

  logger.info("x402-batch", `Batch complete: ${succeeded} succeeded, ${failed} failed, paid=${formatUsd(Number(totalPaid))}, wall=${Date.now() - start}ms`);

  return {
    totalRequests: requests.length,
    succeeded,
    failed,
    totalPaidUsd: formatUsd(Number(totalPaid)),
    wallClockMs: Date.now() - start,
    results: allResults,
  };
}

// ── Convenience: Single Paid Request (voucher-based) ─────────────────────────

/**
 * Make a single paid request using a voucher (instant, no block wait).
 */
export async function executeSinglePaid(
  url: string,
  agentWallet: string,
  sessionKeyWallet: ethers.Wallet,
  opts?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<PaidRequestResult> {
  const result = await executeBatchPaid(
    [{ url, method: opts?.method, headers: opts?.headers, body: opts?.body }],
    agentWallet,
    sessionKeyWallet
  );
  return result.results[0];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(atomicUnits: number): string {
  return `$${(atomicUnits / 10 ** USDC_DECIMALS).toFixed(4)}`;
}
