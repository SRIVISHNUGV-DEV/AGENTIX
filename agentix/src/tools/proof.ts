import { ethers } from "ethers";
import { runSingle, runExecute } from "../core/database";
import { getActiveTree } from "../trees/active-tree";
import { getRevokedTree } from "../trees/revoked-tree";
import { initMerkleCrypto } from "../utils/merkle";
import { logger } from "../core/logger";

export interface ProofResult {
  success: boolean;
  proofHash?: string;
  nullifier?: string;
  activeRoot?: string;
  revokedRoot?: string;
  valid?: boolean;
  error?: string;
  details?: any;
}

export async function generateLocalProof(
  organizationId: string,
  agentId: number,
  nullifier: string,
  secret: string,
  walletAddress: string,
  sessionExpiry: number
): Promise<ProofResult> {
  try {
    await initMerkleCrypto();

    const activeTree = await getActiveTree(organizationId);
    const revokedTree = await getRevokedTree(organizationId);

    const activeRoot = activeTree.getRoot();
    const revokedRoot = revokedTree.getRoot();

    const proofData = {
      organizationId,
      nullifier,
      activeRoot,
      revokedRoot,
      wallet: walletAddress,
      permissions: "1",
      sessionExpiry,
      generatedAt: Date.now(),
    };

    const proofHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(proofData)));

    runExecute(
      `INSERT INTO proofs (proof_hash, nullifier, root, revoked_root, public_signals, proof_data, valid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      proofHash,
      nullifier,
      activeRoot,
      revokedRoot,
      JSON.stringify([nullifier, activeRoot, revokedRoot, "1", String(sessionExpiry), walletAddress]),
      JSON.stringify(proofData),
      Math.floor(Date.now() / 1000)
    );

    logger.info("proof", `Generated local proof: ${proofHash.slice(0, 20)}...`);

    return {
      success: true,
      proofHash,
      nullifier,
      activeRoot,
      revokedRoot,
      valid: true,
      details: proofData,
    };
  } catch (e: any) {
    logger.error("proof", `Failed to generate proof: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function verifyLocalProof(proofHash: string): Promise<ProofResult> {
  try {
    const proof = runSingle<any>(
      "SELECT * FROM proofs WHERE proof_hash = ?",
      proofHash
    );

    if (!proof) return { success: false, error: "Proof not found" };

    let organizationId = "";
    try {
      const proofData = JSON.parse(proof.proof_data || "{}");
      organizationId = proofData.organizationId || "";
    } catch {}

    if (!organizationId) {
      return { success: false, error: "Proof missing organization ID" };
    }

    const activeTree = await getActiveTree(organizationId);
    const revokedTree = await getRevokedTree(organizationId);

    const currentActiveRoot = activeTree.getRoot();
    const currentRevokedRoot = revokedTree.getRoot();

    const valid = proof.root === currentActiveRoot && proof.revoked_root === currentRevokedRoot;

    return {
      success: true,
      proofHash,
      valid,
      activeRoot: proof.root,
      revokedRoot: proof.revoked_root,
      details: {
        organizationId,
        storedActiveRoot: proof.root,
        currentActiveRoot,
        storedRevokedRoot: proof.revoked_root,
        currentRevokedRoot,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function listProofs(sessionId?: string): Promise<ProofResult[]> {
  try {
    let rows: any[];
    if (sessionId) {
      rows = runSingle<any[]>(
        "SELECT * FROM proofs WHERE session_id = ? ORDER BY created_at DESC",
        sessionId
      ) as any || [];
    } else {
      rows = runSingle<any[]>(
        "SELECT * FROM proofs ORDER BY created_at DESC LIMIT 50"
      ) as any || [];
    }

    if (!Array.isArray(rows)) rows = [];

    return rows.map((r: any) => ({
      success: true,
      proofHash: r.proof_hash,
      nullifier: r.nullifier,
      activeRoot: r.root,
      revokedRoot: r.revoked_root,
      valid: r.valid === 1,
    }));
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}
