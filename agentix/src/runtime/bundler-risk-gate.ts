import { ethers } from "ethers";
import { runSingle } from "../core/database";
import { logger } from "../core/logger";
import { checkPolicy, parseValueToWei, decodeTokenMove } from "../core/owner-policy";

/**
 * bundler-risk-gate — enforcement layer for the ERC-4337 relay path.
 *
 * BEFORE this existed, POST /api/bundler/send relayed any session-signed UserOp
 * straight to the EntryPoint with NO reference to the risk engine or owner policy.
 * The sophisticated 10-stage compiler + risk engine only ran on the gateway path
 * (MCP/REST intents), so an agent could bypass every safety control by calling the
 * bundler directly. This closes that hole: the same decision logic now gates the
 * relay, so a DENY actually stops execution.
 *
 * The gate is intentionally fail-closed: if it cannot understand what the UserOp
 * does, it refuses rather than relaying blind.
 */

export interface GateDecision {
  allowed: boolean;
  decision: "ALLOW" | "ALLOW_WITH_CONTROLS" | "REVIEW" | "CHALLENGE" | "DENY";
  score: number;
  reason: string;
  category?: string;
  topDrivers?: string[];
}

/**
 * Decode a wallet.execute(target,value,data) UserOp into a risk intent.
 * FAIL-CLOSED: an unparseable value throws, and the caller denies — the
 * pre-fix fallback to 0n turned a malformed relay body into a "free" op.
 * Token calldata is decoded (R-6) so the policy check sees the token move,
 * not just the ETH value (which is 0 for a token transfer).
 */
function decodeExecute(userOp: { sender: string; target: string; value: string; calldata?: string }): {
  walletAddress: string;
  target: string;
  valueWei: bigint;
} {
  return {
    walletAddress: userOp.sender,
    target: userOp.target,
    valueWei: parseValueToWei(userOp.value ?? "0"),
  };
}

/**
 * Assess a session-signed UserOp against the risk engine + owner policy and
 * decide whether the relay may proceed.
 *
 * @param userOp        the { sender, target, value, calldata, sessionId } relay body
 * @param opts.ownerApprovalAttestation  optional owner EIP-191 signature over the
 *        userOpHash. When the risk decision is REVIEW/CHALLENGE, a valid owner
 *        attestation upgrades it to allowed (step-up). DENY is never overridable.
 */
export async function assessBundlerOp(
  userOp: { sender: string; target: string; value: string; calldata?: string; sessionId?: string },
  opts: { ownerApprovalAttestation?: string; userOpHash?: string } = {}
): Promise<GateDecision> {
  let decoded: ReturnType<typeof decodeExecute>;
  try {
    decoded = decodeExecute(userOp);
  } catch (e: any) {
    // Fail-closed on malformed value: do not relay an op we cannot price.
    return { allowed: false, decision: "DENY", score: 100, reason: `Unparseable relay value: ${e.message}` };
  }
  const { walletAddress, target, valueWei } = decoded;
  const tokenMove = decodeTokenMove(target, userOp.calldata);

  // 1. Resolve the session → wallet → org context so the risk engine has history.
  const session = userOp.sessionId
    ? runSingle<{ wallet_address: string; organization_id: string; max_value: string; revoked: number; expiry: number }>(
        "SELECT wallet_address, organization_id, max_value, revoked, expiry FROM sessions WHERE session_id = ?",
        userOp.sessionId
      )
    : null;

  // Fail-closed: a session referenced but not found, revoked, or expired is denied.
  if (userOp.sessionId) {
    if (!session) {
      return { allowed: false, decision: "DENY", score: 100, reason: `Unknown session ${userOp.sessionId}` };
    }
    if (session.revoked) {
      return { allowed: false, decision: "DENY", score: 100, reason: "Session is revoked" };
    }
    if (session.expiry && session.expiry * 1000 < Date.now() && session.expiry < 1e12) {
      // expiry stored in seconds
      return { allowed: false, decision: "DENY", score: 100, reason: "Session has expired" };
    }
  }

  // 2. Fast owner-policy pre-check (per-tx / daily ceilings, allow/forbid lists).
  //    This mirrors the gateway's policy gate so both paths enforce the same limits.
  //    FAIL-CLOSED: a policy-check exception denies — the pre-fix code logged
  //    and continued to the risk engine, letting a policy-layer failure pass.
  //    The calldata is passed through so token moves are policy-checked as
  //    token moves (R-6), not as zero-value generic executes.
  try {
    const policyCheck = checkPolicy(walletAddress, "wallet_execute", {
      walletAddress,
      target,
      value: valueWei.toString(),
      data: userOp.calldata || "0x",
    });
    if (!policyCheck.allowed) {
      return {
        allowed: false,
        decision: "DENY",
        score: 95,
        reason: `Owner policy blocked: ${policyCheck.reason}`,
      };
    }
  } catch (e: any) {
    logger.error("bundler-gate", `owner-policy check failed (denying): ${e.message}`);
    return { allowed: false, decision: "DENY", score: 100, reason: `Owner policy check failed: ${e.message}` };
  }

  // 3. Run the modular risk engine (value + counterparty + behavioral + compliance …).
  let decision: GateDecision["decision"] = "ALLOW";
  let score = 0;
  let category: string | undefined;
  let topDrivers: string[] | undefined;
  let reason = "Within policy";

  try {
    const { RiskEngineCore } = await import("../../packages/compiler/risk/engine");
    const core = new RiskEngineCore(undefined);
    const assessment = await core.assess({
      intent: {
        action: "wallet_execute",
        normalizedAction: "wallet_execute",
        source: "bundler",
        requestedAt: Math.floor(Date.now() / 1000),
        agent: { walletAddress },
        sessionId: userOp.sessionId,
        params: {
          walletAddress,
          target,
          recipient: target,
          value: valueWei.toString(),
          data: userOp.calldata || "0x",
          // Token moves are visible to risk signals as token moves, not as
          // zero-value executes (R-6). Amounts are token atomic units, NOT
          // ETH — never summed into the ETH value above.
          tokenTransfer: tokenMove
            ? { kind: tokenMove.kind, token: tokenMove.token, to: tokenMove.to, amount: tokenMove.amount.toString() }
            : undefined,
        },
        limits: {},
      } as any,
      capabilities: { canExecute: true, missingExplicit: [], mustDelegate: [] } as any,
    });

    score = assessment.score;
    category = assessment.category;
    topDrivers = assessment.topDrivers;
    decision = (assessment.decision || (assessment.requiresApproval ? "REVIEW" : "ALLOW")) as GateDecision["decision"];
    if (assessment.topDrivers && assessment.topDrivers.length > 0) {
      reason = `Risk ${category} (${score}): ${assessment.topDrivers.join("; ")}`;
    } else {
      reason = `Risk ${category} (${score})`;
    }
  } catch (e: any) {
    // Fail-closed on risk-engine error: do not relay an op we couldn't assess.
    logger.error("bundler-gate", `risk assessment failed: ${e.message}`);
    return { allowed: false, decision: "DENY", score: 100, reason: `Risk engine error: ${e.message}` };
  }

  // 4. Decision → allow/block. DENY is terminal. REVIEW/CHALLENGE can be upgraded
  //    by a valid owner attestation (step-up); otherwise they block the relay.
  if (decision === "ALLOW" || decision === "ALLOW_WITH_CONTROLS") {
    return { allowed: true, decision, score, reason, category, topDrivers };
  }

  if (decision === "DENY") {
    return { allowed: false, decision, score, reason, category, topDrivers };
  }

  // REVIEW or CHALLENGE — require owner step-up.
  if (opts.ownerApprovalAttestation && opts.userOpHash) {
    const ok = verifyOwnerSignature(walletAddress, ethers.getBytes(opts.userOpHash), opts.ownerApprovalAttestation);
    if (ok) {
      return {
        allowed: true,
        decision,
        score,
        reason: `${reason} — upgraded by owner step-up attestation`,
        category,
        topDrivers,
      };
    }
  }

  return {
    allowed: false,
    decision,
    score,
    reason: `${reason}. Owner approval (step-up) required before this action can be relayed.`,
    category,
    topDrivers,
  };
}

/**
 * Verify that `signature` is a valid EIP-191 signature over `message` by the
 * wallet's registered owner (wallets table). Shared by the bundler step-up
 * path (message = userOpHash bytes) and the MCP plan-approval path (message
 * = a domain-separated plan-approval string) — one owner-attestation check,
 * not one per surface. Callers MUST domain-separate their messages: a plan
 * attestation must never verify as a bundler attestation or vice versa.
 */
export function verifyOwnerSignature(walletAddress: string, message: Uint8Array, signature: string): boolean {
  try {
    const row = runSingle<{ owner_address: string }>(
      "SELECT owner_address FROM wallets WHERE wallet_address = ?",
      walletAddress
    );
    if (!row?.owner_address) return false;
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === row.owner_address.toLowerCase();
  } catch {
    return false;
  }
}
