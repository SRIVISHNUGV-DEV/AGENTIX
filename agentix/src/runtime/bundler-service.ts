import { ethers } from "ethers";
import { getProvider } from "../core/provider";
import { loadConfig, saveConfig } from "../core/config";
import { logger } from "../core/logger";
import { runExecute, runQueryCamel } from "../core/database";
import { getEventBus } from "../../packages/core/eventbus";
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
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

function loadOrCreateBundlerKey(): string {
  const dir = dirname(BUNDLER_KEY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(BUNDLER_KEY_PATH)) {
    return readFileSync(BUNDLER_KEY_PATH, "utf-8").trim();
  }

  const wallet = ethers.Wallet.createRandom();
  writeFileSync(BUNDLER_KEY_PATH, wallet.privateKey, "utf-8");
  logger.info("bundler", `Generated bundler key: ${wallet.address}`);
  return wallet.privateKey;
}

function getBundlerWallet(): ethers.Wallet {
  const pk = loadOrCreateBundlerKey();
  const provider = getProvider();
  return new ethers.Wallet(pk, provider);
}

// ── Queue Management ────────────────────────────────────────────

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

function getPendingOps(): PendingUserOp[] {
  const rows = runQueryCamel<any>(
    "SELECT * FROM bundler_queue WHERE status = 'pending' ORDER BY created_at ASC"
  );
  return rows.map((r: any) => ({
    ...r,
    signedUserOp: JSON.parse(r.signedUserOp || "{}"),
  }));
}

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
