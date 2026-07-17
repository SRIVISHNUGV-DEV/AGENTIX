import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import { generateId } from "../../shared/utils";
import type { Proof } from "../../shared/types";

export class ProofService {
  private bus = getEventBus();

  generate(sessionId: string, nullifier: string, root: string, revokedRoot: string, publicSignals: string, proofData: string): Proof {
    const proofHash = `proof_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    runExecute(
      "INSERT INTO proofs (proof_hash, session_id, nullifier, root, revoked_root, public_signals, proof_data, valid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
      proofHash, sessionId, nullifier, root, revokedRoot, publicSignals, proofData, now
    );

    const proof = runSingleCamel<Proof>("SELECT * FROM proofs WHERE proof_hash = ?", proofHash)!;
    this.bus.emit({ type: "ProofGenerated", data: { proofHash } });
    return proof;
  }

  verify(proofHash: string): { valid: boolean; proof?: Proof; error?: string } {
    const proof = runSingleCamel<Proof>("SELECT * FROM proofs WHERE proof_hash = ?", proofHash);
    if (!proof) return { valid: false, error: "Proof not found" };
    return { valid: !!proof.valid, proof };
  }

  list(limit?: number): Proof[] {
    const q = limit
      ? "SELECT * FROM proofs ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM proofs ORDER BY created_at DESC";
    return limit ? runQueryCamel<Proof>(q, limit) : runQueryCamel<Proof>(q);
  }

  count(): number {
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM proofs");
    return r?.count || 0;
  }
}

let _svc: ProofService | null = null;
export function getProofService(): ProofService {
  if (!_svc) _svc = new ProofService();
  return _svc;
}
