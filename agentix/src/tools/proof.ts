import { ethers } from "ethers";
import { runQuery, runSingle, runExecute } from "../core/database";
import { getActiveTree } from "../trees/active-tree";
import { getRevokedTree } from "../trees/revoked-tree";
import { initMerkleCrypto } from "../utils/merkle";
import { logger } from "../core/logger";
import {
  prove,
  verifyLocally,
  formatCalldata,
  computeCommitment,
  computeNullifier,
  computeRevocationKey,
  verifyIntegrity,
  type CredentialWitness,
  type Groth16Proof,
  type SolidityCalldata,
} from "../core/zk-prover";

export interface ProofResult {
  success: boolean;
  proofHash?: string;
  nullifier?: string;
  activeRoot?: string;
  revokedRoot?: string;
  maxValue?: string;
  sessionExpiry?: string;
  wallet?: string;
  credentialVersion?: string;
  valid?: boolean;
  calldata?: SolidityCalldata;
  proof?: Groth16Proof;
  error?: string;
  details?: any;
}

/**
 * Generate a REAL Groth16 proof for the credential_V1 circuit.
 * Replaces the old fake keccak-of-JSON pseudo-proof with the actual ZK proof
 * that verifies on-chain against the deployed Groth16Verifier. Flow: integrity
 * preflight on the circuit artifacts, load credential, recompute the Poseidon(7)
 * commitment, fetch the active-tree Merkle proof and the revoked-SMT
 * non-membership proof, build the witness, fullProve, verify locally, format
 * Solidity calldata, then store the proof record.
 * @param organizationId - Org id; @param agentId - Agent id within the org; @param walletAddress - Wallet the session will execute from (must match the credential).
 * @param sessionExpiry - Session expiry as a unix timestamp (seconds); @param sessionNonce - Per-session nonce bound into the nullifier — reuse across sessions breaks nullifier uniqueness.
 * @param maxValue - Optional per-session spend cap in wei as a decimal string; defaults to the credential's budget limit.
 * @returns ProofResult with proofHash, nullifier, both roots, calldata and the full proof; success:false + error when artifacts fail integrity, no active credential exists, the commitment is missing from the tree, the credential is revoked, or local verification fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: circuit credential_V1 (Groth16) + trees ActiveTree / RevokedTree.
 * Side effects: reads DB and both trees; inserts a row in the proofs table; CPU-heavy (snarkjs fullProve, seconds).
 * Security: the proof is only as sound as the artifact integrity preflight — a corrupt proving key fails fast here instead of producing a bad proof.
 */
export async function generateProof(
  organizationId: string,
  agentId: number,
  walletAddress: string,
  sessionExpiry: number,
  sessionNonce: bigint,
  maxValue?: string,
): Promise<ProofResult> {
  try {
    // Hash-verified preflight — fail fast if artifacts are missing OR corrupted.
    const integ = verifyIntegrity();
    if (!integ.ok) {
      return {
        success: false,
        error: `ZK artifact integrity check failed: ${integ.errors.join("; ")}. ` +
          `Regenerate artifacts (cd circuits && ...) or set AGENTIX_CIRCUITS_DIR.`,
      };
    }

    await initMerkleCrypto();

    // 1. Load the credential from DB
    const cred = runSingle<{
      agent_id: number;
      nullifier: string;
      secret: string;
      permissions: string;
      expiry: number;
      budget_limit: string;
      credential_version: number;
      commitment: string;
    }>(
      "SELECT agent_id, nullifier, secret, permissions, expiry, budget_limit, credential_version, commitment FROM credentials WHERE organization_id = ? AND agent_id = ? AND revoked = 0",
      organizationId, agentId
    );

    if (!cred) {
      return { success: false, error: `No active credential found for agent ${agentId} in org ${organizationId}` };
    }

    // 2. Compute commitment (must match circuit's Poseidon7)
    const orgIdBigInt = BigInt(organizationId) || BigInt(1);
    const secretBigInt = cred.secret ? BigInt("0x" + cred.secret) : BigInt(0);
    const budgetLimit = BigInt(cred.budget_limit || cred.permissions || "0");
    const expiry = BigInt(cred.expiry);
    const credentialVersion = BigInt(cred.credential_version || 1);
    const walletBigInt = BigInt(walletAddress);

    const commitment = await computeCommitment({
      agentId: BigInt(agentId),
      orgId: orgIdBigInt,
      budgetLimit,
      wallet: walletBigInt,
      expiry,
      credentialVersion,
      secret: secretBigInt,
    });

    // 3. Get the active-tree Merkle proof
    const activeTree = await getActiveTree(organizationId);
    const activeProof = activeTree.getProofForCommitment(commitment);
    if (!activeProof) {
      return { success: false, error: "Credential commitment not found in active tree — tree may be stale. Run: agentix tree rebuild" };
    }

    // 4. Compute revocation key
    const revocationKey = await computeRevocationKey(secretBigInt);

    // 5. Get SMT non-membership proof from revoked tree
    const revokedTree = await getRevokedTree(organizationId);
    const smtProof = await revokedTree.getNonMembershipProof(revocationKey);
    if (!smtProof) {
      return { success: false, error: "Credential is revoked (revocation key found in revoked SMT)" };
    }

    const activeRoot = activeTree.getRoot();
    const revokedRoot = revokedTree.getRoot();
    const maxVal = BigInt(maxValue || budgetLimit.toString());
    const sessionExpiryBig = BigInt(sessionExpiry);

    // 6. Build witness and generate proof
    const witness: CredentialWitness = {
      agentId: BigInt(agentId),
      orgId: orgIdBigInt,
      budgetLimit,
      expiry,
      secret: secretBigInt,
      sessionNonce,
      activePathElements: activeProof.pathElements.map((e) => BigInt(e)),
      activePathIndices: activeProof.pathIndices.map((e) => BigInt(e)),
      revokedSiblings: smtProof.siblings,
      revokedOldKey: smtProof.oldKey,
      revokedOldValue: smtProof.oldValue,
      revokedIsOld0: smtProof.isOld0,
      wallet: walletBigInt,
      activeRoot: BigInt(activeRoot),
      revokedRoot: BigInt(revokedRoot),
      maxValue: maxVal,
      sessionExpiry: sessionExpiryBig,
      credentialVersion,
    };

    const groth16Proof = await prove(witness);

    // 7. Verify locally
    const localValid = await verifyLocally(groth16Proof);
    if (!localValid) {
      logger.error("proof", "Local Groth16 verification FAILED — proof/circuit mismatch");
      return { success: false, error: "Local Groth16 verification failed — proof/circuit mismatch" };
    }

    // 8. Format as Solidity calldata
    const calldata = await formatCalldata(groth16Proof);

    // 9. Compute the nullifier (for DB storage and dedup)
    const nullifier = await computeNullifier(orgIdBigInt, secretBigInt, sessionNonce);

    // 10. Store proof record
    const proofHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify({
        nullifier: nullifier.toString(),
        activeRoot,
        revokedRoot,
        walletAddress,
        sessionExpiry,
      }))
    );

    runExecute(
      `INSERT INTO proofs (proof_hash, nullifier, root, revoked_root, public_signals, proof_data, valid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      proofHash,
      nullifier.toString(),
      activeRoot,
      revokedRoot,
      JSON.stringify(groth16Proof.publicSignals),
      JSON.stringify({ groth16: groth16Proof.proof, organizationId, agentId, walletAddress, sessionExpiry }),
      Math.floor(Date.now() / 1000)
    );

    logger.info("proof", `Generated Groth16 proof: ${proofHash.slice(0, 20)}... nullifier=${nullifier.toString().slice(0, 20)}...`);

    return {
      success: true,
      proofHash,
      nullifier: nullifier.toString(),
      activeRoot,
      revokedRoot,
      maxValue: maxVal.toString(),
      sessionExpiry: sessionExpiryBig.toString(),
      wallet: walletAddress,
      credentialVersion: credentialVersion.toString(),
      valid: true,
      calldata,
      proof: groth16Proof,
    };
  } catch (e: any) {
    logger.error("proof", `Failed to generate Groth16 proof: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Verify a stored proof by hash — Groth16 re-verification when the proof data is present, root comparison otherwise.
 * The fallback matters: legacy proofs with no Groth16 data are only "valid" if the
 * stored roots still equal the current tree roots, which fails after any later
 * issue/revoke — a root-comparison "invalid" does not prove the original proof was bad.
 * @param proofHash - keccak id returned by generateProof.
 * @returns ProofResult with valid:true/false plus the stored roots and verifiedVia ("groth16" or "root-comparison"); success:false + "Proof not found" when the hash has no row.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_proof_verify.
 * Side effects: read-only DB read + local Groth16 verification (CPU) or tree-root reads for the fallback.
 */
export async function verifyProof(proofHash: string): Promise<ProofResult> {
  try {
    const proof = runSingle<any>(
      "SELECT * FROM proofs WHERE proof_hash = ?",
      proofHash
    );

    if (!proof) return { success: false, error: "Proof not found" };

    let organizationId = "";
    let groth16Proof: Groth16Proof | null = null;
    try {
      const proofData = JSON.parse(proof.proof_data || "{}");
      organizationId = proofData.organizationId || "";
      if (proofData.groth16) {
        groth16Proof = {
          proof: proofData.groth16,
          publicSignals: JSON.parse(proof.public_signals || "[]"),
        };
      }
    } catch {}

    // If we have a real Groth16 proof, verify it
    if (groth16Proof) {
      const valid = await verifyLocally(groth16Proof);
      return {
        success: true,
        proofHash,
        valid,
        activeRoot: proof.root,
        revokedRoot: proof.revoked_root,
        details: { organizationId, verifiedVia: "groth16" },
      };
    }

    // Fallback: root-comparison verification (legacy proofs)
    if (!organizationId) {
      return { success: false, error: "Proof missing organization ID and no Groth16 data" };
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
        verifiedVia: "root-comparison",
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Legacy alias for generateProof with a random session nonce.
 * The old generateLocalProof produced a fake keccak-of-JSON hash; it now delegates
 * to the real Groth16 generateProof. The _nullifier and secret parameters are
 * accepted for signature compatibility and IGNORED — the secret is re-read from the DB.
 * @param organizationId - Org id; @param agentId - Agent id; @param _nullifier - Ignored (legacy signature); @param secret - Ignored (legacy signature).
 * @param walletAddress - Wallet the session will execute from; @param sessionExpiry - Session expiry as a unix timestamp (seconds).
 * @returns Same ProofResult as generateProof.
 * @throws Never throws: failures are returned as success:false (from generateProof).
 * Maps to: internal — generateProof (legacy callers).
 * Side effects: same as generateProof (DB insert + proving work).
 */
export async function generateLocalProof(
  organizationId: string,
  agentId: number,
  _nullifier: string,
  secret: string,
  walletAddress: string,
  sessionExpiry: number
): Promise<ProofResult> {
  // Use a random session nonce if not provided
  const sessionNonce = BigInt(Math.floor(Math.random() * 1_000_000_000) + 1);
  return generateProof(organizationId, agentId, walletAddress, sessionExpiry, sessionNonce);
}

/**
 * Recent proofs, newest first — optionally filtered to one session.
 * The session filter reads proofs.session_id, which generateProof never
 * populates, so filtering by sessionId currently always returns an empty list.
 * @param sessionId - Omit for the latest 50 proofs overall.
 * @returns ProofResult[] (empty when none); a DB failure yields [{success:false, error}].
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_proof_list.
 * Side effects: read-only DB query.
 */
export async function listProofs(sessionId?: string): Promise<ProofResult[]> {
  try {
    let rows: any[];
    if (sessionId) {
      rows = runQuery(
        "SELECT * FROM proofs WHERE session_id = ? ORDER BY created_at DESC",
        sessionId
      );
    } else {
      rows = runQuery(
        "SELECT * FROM proofs ORDER BY created_at DESC LIMIT 50"
      );
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
