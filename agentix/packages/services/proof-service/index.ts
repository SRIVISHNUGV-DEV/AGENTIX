import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import { generateId } from "../../shared/utils";
import type { Proof } from "../../shared/types";

export class ProofService {
  private bus = getEventBus();

  /**
   * Persists a caller-supplied proof and marks it valid.
   * WHY: the record-keeping half of proving — the proof bytes and public signals need a durable, look-upable row before anything can be verified against them.
   * @param sessionId Session the proof was generated for; stored verbatim, not checked against the sessions table.
   * @param nullifier Nullifier the proof commits to; stored verbatim.
   * @param root Merkle root the proof was built against, as a string.
   * @param revokedRoot Revocation-tree root at proof time, as a string.
   * @param publicSignals Serialized public signals; stored verbatim.
   * @param proofData Serialized proof bytes; stored verbatim.
   * @returns The stored proof row, re-read from the DB, with valid = 1.
   * @throws Throws on DB errors.
   * Maps to: internal — ProofService.verify (read-back of the stored row); event ProofGenerated.
   * Side effects: inserts a row into proofs and emits ProofGenerated.
   * Security note: generate() performs NO cryptographic verification — it trusts the caller and marks every stored proof valid. A row existing here proves nothing about the proof; only an actual verifier (circuit/on-chain) establishes validity.
   */
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

  /**
   * Checks a stored proof's validity flag by hash.
   * WHY: the cheap lookup for flows that only need to know whether a recorded proof was marked valid.
   * @returns `{ valid, proof }` when found (valid mirrors the stored flag); `{ valid: false, error: "Proof not found" }` when no row matches.
   * @throws Throws on DB errors.
   * Maps to: internal — ProofService.generate (rows it stores).
   * Side effects: none (read-only).
   * Security note: this reads a database flag set unconditionally by generate() — it does NOT verify the proof cryptographically. Do not treat `valid: true` as a verified ZK proof.
   */
  verify(proofHash: string): { valid: boolean; proof?: Proof; error?: string } {
    const proof = runSingleCamel<Proof>("SELECT * FROM proofs WHERE proof_hash = ?", proofHash);
    if (!proof) return { valid: false, error: "Proof not found" };
    return { valid: !!proof.valid, proof };
  }

  /**
   * Lists stored proofs, newest first, with an optional cap.
   * WHY: the operator's proof inventory and the audit trail for sessions that proved something.
   * @param limit Maximum rows; when omitted, all proofs are returned (unbounded — large histories return everything).
   * @returns Proofs ordered by created_at descending; empty array when none exist.
   * @throws Throws on DB errors.
   * Maps to: internal — ProofService.count (count form of the same read).
   * Side effects: none (read-only).
   */
  list(limit?: number): Proof[] {
    const q = limit
      ? "SELECT * FROM proofs ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM proofs ORDER BY created_at DESC";
    return limit ? runQueryCamel<Proof>(q, limit) : runQueryCamel<Proof>(q);
  }

  /**
   * Counts stored proofs.
   * WHY: the cheap cardinality check for dashboards and health checks.
   * @returns The row count, 0 when none.
   * @throws Throws on DB errors.
   * Maps to: internal — ProofService.list (count form).
   * Side effects: none (read-only).
   */
  count(): number {
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM proofs");
    return r?.count || 0;
  }
}

let _svc: ProofService | null = null;
/**
 * Returns the process-wide singleton ProofService.
 * WHY: one service per process — all proof reads share the same event-bus subscription surface.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — ProofService (module-level accessor).
 * Side effects: creates the singleton on first call.
 */
export function getProofService(): ProofService {
  if (!_svc) _svc = new ProofService();
  return _svc;
}
