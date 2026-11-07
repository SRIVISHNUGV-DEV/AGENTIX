import { ethers } from "ethers";
import { getProvider } from "../core/provider";
import { loadConfig, saveConfig } from "../core/config";
import { logger } from "../core/logger";
import { runExecute, runQueryCamel } from "../core/database";
import { getEventBus } from "../../packages/core/eventbus";
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// ── Types ───────────────────────────────────────────────────────

export interface BundlerConfig {
  privateKey: string;
  address: string;
  maxPending: number;
  gasBuffer: bigint;
}

export interface PendingUserOp {
  id: string;
  userOpHash: string;
  signedUserOp: any;
  submittedBy: string;
  walletAddress: string;
  action: string;
  status: "pending" | "submitted" | "completed" | "failed";
  txHash?: string;
  error?: string;
  createdAt: number;
  submittedAt?: number;
  completedAt?: number;
}

export interface BundlerStatus {
  address: string;
  balance: string;
  pendingCount: number;
  totalSubmitted: number;
  totalCompleted: number;
  totalFailed: number;
}

// ── Constants ───────────────────────────────────────────────────

const BUNDLER_KEY_PATH = join(homedir(), ".agentix", "config", "bundler-key");
const EP_ABI = [
  "function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external",
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

// ── Bundler EOA Management ──────────────────────────────────────

/**
 * Loads the bundler relay EOA private key from disk, creating and persisting one on first use.
 * The relay needs a funded EOA to pay handleOps gas; a stable on-disk key keeps its address (and
 * therefore its funding/deposit) the same across restarts instead of minting a fresh unfunded key.
 * @returns The raw private key as a hex string (never log it — only the address is logged).
 * @throws On unreadable/unwritable key file or directory creation failure.
 * Maps to: internal — getBundlerWallet (its only caller).
 * Side effects: creates ~/.agentix/config/bundler-key (mode 0600) on first run; tightens an existing
 *   key file to 0600 on load (best-effort on non-POSIX platforms).
 * Security note: raw private key for the gas-paying EOA — handle in memory only, never persist
 *   or transmit it elsewhere; the file must stay 0600.
 */
function loadOrCreateBundlerKey(): string {
  const dir = dirname(BUNDLER_KEY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(BUNDLER_KEY_PATH)) {
    // Tighten permissions on load too: keys created before this fix may
    // sit at the default umask. Best-effort on non-POSIX platforms.
    try {
      chmodSync(BUNDLER_KEY_PATH, 0o600);
    } catch {}
    return readFileSync(BUNDLER_KEY_PATH, "utf-8").trim();
  }

  const wallet = ethers.Wallet.createRandom();
  writeFileSync(BUNDLER_KEY_PATH, wallet.privateKey, { mode: 0o600, encoding: "utf-8" });
  try {
    chmodSync(BUNDLER_KEY_PATH, 0o600);
  } catch {}
  logger.info("bundler", `Generated bundler key: ${wallet.address}`);
  return wallet.privateKey;
}

/**
 * Returns a signer for the bundler relay EOA connected to the configured provider.
 * Call this per submission rather than caching a wallet, so a rotated key file or provider
 * change is picked up on the next call.
 * @returns An ethers Wallet bound to the provider; its address is the handleOps beneficiary.
 * @throws If the key cannot be loaded or the provider is misconfigured.
 * Maps to: internal — submitUserOp and getBundlerStatus.
 * Security note: the returned wallet can spend the bundler EOA's ETH — only hand it to the
 *   EntryPoint submission path, never to caller-controlled code.
 */
function getBundlerWallet(): ethers.Wallet {
  const pk = loadOrCreateBundlerKey();
  const provider = getProvider();
  return new ethers.Wallet(pk, provider);
}

// ── Queue Management ────────────────────────────────────────────

/**
 * Persists a signed UserOp to the bundler queue as pending and returns its queue record.
 * Decouples relay intake from on-chain submission so a burst of ops is drained by
 * flushPendingOps instead of each caller paying for its own handleOps round-trip.
 * @returns The queued op with a generated `bop_<ms>_<hex>` id, status "pending", and createdAt in epoch seconds.
 * @throws On a DB insert failure — the op is not queued and the caller must retry or report the error.
 * Maps to: REST POST /api/bundler/send queue path (via the runtime) and MCP/CLI bundler submission.
 * Side effects: INSERTs one row into bundler_queue; logs the queue id and action.
 */
export function queueUserOp(params: {
  userOpHash: string;
  signedUserOp: any;
  submittedBy: string;
  walletAddress: string;
  action: string;
}): PendingUserOp {
  const id = `bop_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const op: PendingUserOp = {
    id,
    userOpHash: params.userOpHash,
    signedUserOp: params.signedUserOp,
    submittedBy: params.submittedBy,
    walletAddress: params.walletAddress,
    action: params.action,
    status: "pending",
    createdAt: Math.floor(Date.now() / 1000),
  };

  runExecute(
    `INSERT INTO bundler_queue (id, user_op_hash, signed_user_op, submitted_by, wallet_address, action, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    params.userOpHash,
    JSON.stringify(params.signedUserOp),
    params.submittedBy,
    params.walletAddress,
    params.action,
    op.createdAt
  );

  logger.info("bundler", `Queued UserOp ${id} for ${params.action}`);
  return op;
}

/**
 * Returns every still-pending queued UserOp, oldest first.
 * Flush order matters: FIFO keeps an early op from starving behind later ones and preserves
 * the nonce order the EntryPoint expects for a given sender.
 * @returns Pending ops with signedUserOp parsed from JSON; empty array when the queue is drained.
 * @throws On a DB read failure or a corrupt signed_user_op JSON row.
 * Maps to: internal — flushPendingOps (its only caller).
 */
function getPendingOps(): PendingUserOp[] {
  const rows = runQueryCamel<any>(
    "SELECT * FROM bundler_queue WHERE status = 'pending' ORDER BY created_at ASC"
  );
  return rows.map((r: any) => ({
    ...r,
    signedUserOp: JSON.parse(r.signedUserOp || "{}"),
  }));
}

/**
 * Updates one queued op's status (and tx hash / error / timestamps) in place.
 * The queue's audit trail: without it a submitted op would look pending forever and flush would
 * resubmit it, double-spending gas and possibly replaying the op.
 * @param status free-form string; callers use "submitted" | "completed" | "failed".
 * @param extra.txHash recorded on completion; extra.error on failure. Other keys are ignored.
 * @returns Nothing. Silently does nothing visible if the id does not exist (no row matched).
 * @throws On a DB update failure.
 * Maps to: internal — flushPendingOps (its only caller).
 * Side effects: UPDATEs bundler_queue; stamps submitted_at on "submitted" and completed_at on
 *   "completed"/"failed", in epoch seconds.
 */
function updateOpStatus(id: string, status: string, extra?: Record<string, any>): void {
  const updates = ["status = ?"];
  const values: any[] = [status];

  if (extra?.txHash) {
    updates.push("tx_hash = ?");
    values.push(extra.txHash);
  }
  if (extra?.error) {
    updates.push("error = ?");
    values.push(extra.error);
  }
  if (status === "submitted") {
    updates.push("submitted_at = ?");
    values.push(Math.floor(Date.now() / 1000));
  }
  if (status === "completed" || status === "failed") {
    updates.push("completed_at = ?");
    values.push(Math.floor(Date.now() / 1000));
  }

  values.push(id);
  runExecute(
    `UPDATE bundler_queue SET ${updates.join(", ")} WHERE id = ?`,
    ...values
  );
}

// ── Core: Submit to EntryPoint ───────────────────────────────────

/**
 * Submits one signed UserOp to the EntryPoint via handleOps and waits for its receipt.
 * The single-op on-chain step of the relay: pre-flight checks (bundler gas, wallet deposit,
 * live nonce) run first so a doomed op is refused before any gas is spent.
 * @param signedUserOp the packed op; its nonce is OVERWRITTEN in place with the live EntryPoint
 *   nonce and its sender must already hold an EntryPoint deposit.
 * @returns { success, txHash, userOpHash } on success; { success: false, error } when the bundler
 *   is under the 0.001 ETH gas floor, the wallet has zero deposit, or handleOps fails.
 * @throws On provider/RPC failure or a rejected handleOps transaction (no receipt) — callers
 *   (flushPendingOps) catch this per-op and mark the op failed rather than aborting the batch.
 * Maps to: contract EntryPoint.handleOps; REST POST /api/bundler/send via flushPendingOps.
 * Side effects: mutates signedUserOp.nonce; spends bundler ETH on gas; emits a WalletExecuted event on success.
 * Security note: submits whatever op it is handed — caller must have run assessBundlerOp first;
 *   this function performs no policy, session, or risk check of its own.
 */
export async function submitUserOp(signedUserOp: any): Promise<{
  success: boolean;
  txHash?: string;
  userOpHash?: string;
  error?: string;
}> {
  const config = loadConfig();
  const bundler = getBundlerWallet();
  const provider = getProvider();

  // 1. Check bundler has gas ETH
  const bundlerBalance = await provider.getBalance(bundler.address);
  if (bundlerBalance < ethers.parseEther("0.001")) {
    return {
      success: false,
      error: `Bundler has insufficient gas: ${ethers.formatEther(bundlerBalance)} ETH. Fund ${bundler.address}`,
    };
  }

  // 2. Check wallet has EntryPoint deposit
  const ep = new ethers.Contract(config.contracts.entryPoint, EP_ABI, provider);
  const deposit = await ep.balanceOf(signedUserOp.sender);
  if (deposit === 0n) {
    return {
      success: false,
      error: `Wallet ${signedUserOp.sender} has no EntryPoint deposit. Fund via addDeposit().`,
    };
  }

  // 3. Get correct nonce
  const nonce = await ep.getNonce(signedUserOp.sender, 0);
  signedUserOp.nonce = nonce;

  // 4. Submit via handleOps
  const epSigner = new ethers.Contract(config.contracts.entryPoint, EP_ABI, bundler);
  const tx = await epSigner.handleOps([signedUserOp], bundler.address, {
    gasLimit: 500_000,
  });
  const receipt = await tx.wait();

  logger.info("bundler", `UserOp submitted: ${receipt.hash}`);

  // 5. Emit event
  await getEventBus().emit({
    type: "WalletExecuted",
    data: {
      walletAddress: signedUserOp.sender,
      txHash: receipt.hash,
      bundler: bundler.address,
    },
  });

  return {
    success: true,
    txHash: receipt.hash,
    userOpHash: signedUserOp.userOpHash,
  };
}

// ── Batch Submission ─────────────────────────────────────────────

/**
 * Drains the pending queue, submitting each op in FIFO order and recording its outcome.
 * The batch worker for the relay: one op's failure must not block the rest, so each op is
 * submitted and marked independently and the run always returns a full per-op summary.
 * @returns { submitted, failed, results } with one entry per drained op (txHash on success,
 *   error on failure); all zeros with an empty results array when the queue is empty.
 * @throws Never for per-op failures (they are counted, not thrown); a DB read failure in
 *   getPendingOps propagates to the caller.
 * Maps to: internal — the bundler flush trigger (REST/CLI); contract EntryPoint.handleOps per op.
 * Side effects: UPDATEs each op to submitted then completed/failed; spends bundler gas per op.
 */
export async function flushPendingOps(): Promise<{
  submitted: number;
  failed: number;
  results: Array<{ id: string; txHash?: string; error?: string }>;
}> {
  const pending = getPendingOps();
  if (pending.length === 0) {
    return { submitted: 0, failed: 0, results: [] };
  }

  const results: Array<{ id: string; txHash?: string; error?: string }> = [];
  let submitted = 0;
  let failed = 0;

  for (const op of pending) {
    try {
      updateOpStatus(op.id, "submitted");
      const result = await submitUserOp(op.signedUserOp);

      if (result.success) {
        updateOpStatus(op.id, "completed", { txHash: result.txHash });
        results.push({ id: op.id, txHash: result.txHash });
        submitted++;
      } else {
        updateOpStatus(op.id, "failed", { error: result.error });
        results.push({ id: op.id, error: result.error });
        failed++;
      }
    } catch (e: any) {
      updateOpStatus(op.id, "failed", { error: e.message });
      results.push({ id: op.id, error: e.message });
      failed++;
    }
  }

  logger.info("bundler", `Flushed: ${submitted} submitted, ${failed} failed`);
  return { submitted, failed, results };
}

// ── Status ───────────────────────────────────────────────────────

/**
 * Returns the relay's live health snapshot: bundler address, ETH balance, and queue counts.
 * The dashboard/status read for the relay — it answers "can the bundler afford the next op"
 * without submitting anything.
 * @returns BundlerStatus; counts are 0 (not null) when a queue state has no rows. Note
 *   totalSubmitted counts only ops still in "submitted" state, not completed/failed ones.
 * @throws On provider failure (balance read) or a DB count failure.
 * Maps to: REST GET bundler status (dashboard); contract EntryPoint.balanceOf for the deposit view.
 * Side effects: none — read-only (balance + COUNT queries).
 */
export async function getBundlerStatus(): Promise<BundlerStatus> {
  const bundler = getBundlerWallet();
  const provider = getProvider();
  const balance = await provider.getBalance(bundler.address);

  const pending = runQueryCamel<any>(
    "SELECT COUNT(*) as count FROM bundler_queue WHERE status = 'pending'"
  );
  const submitted = runQueryCamel<any>(
    "SELECT COUNT(*) as count FROM bundler_queue WHERE status = 'submitted'"
  );
  const completed = runQueryCamel<any>(
    "SELECT COUNT(*) as count FROM bundler_queue WHERE status = 'completed'"
  );
  const failed = runQueryCamel<any>(
    "SELECT COUNT(*) as count FROM bundler_queue WHERE status = 'failed'"
  );

  return {
    address: bundler.address,
    balance: ethers.formatEther(balance),
    pendingCount: pending[0]?.count || 0,
    totalSubmitted: submitted[0]?.count || 0,
    totalCompleted: completed[0]?.count || 0,
    totalFailed: failed[0]?.count || 0,
  };
}

// ── Schema ───────────────────────────────────────────────────────

export const BUNDLER_SCHEMA = `
CREATE TABLE IF NOT EXISTS bundler_queue (
  id TEXT PRIMARY KEY,
  user_op_hash TEXT NOT NULL,
  signed_user_op TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bundler_status ON bundler_queue(status);
CREATE INDEX IF NOT EXISTS idx_bundler_wallet ON bundler_queue(wallet_address);
`;
