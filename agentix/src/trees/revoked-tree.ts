import {
  buildRevokedSmt,
  buildRevokedSmtFromKeys,
  smtNonMembershipProof,
  initMerkleCrypto,
  type SmtNonMembershipProof,
} from "../utils/merkle";
import { runExecute, runSingle, runQuery } from "../core/database";
import { logger } from "../core/logger";

const TREE_DEPTH = 20;

/**
 * RevokedTree — the revoked-credential Sparse Merkle Tree.
 *
 * Circuit compatibility (credential_V1.circom):
 *   component revokedVerifier = SMTVerifier(depth);
 * The circuit uses circomlib's SMTVerifier, which expects a Poseidon SMT
 * (newMemEmptyTrie from circomlibjs) with hash0/hash1 node hashing.
 * A simple binary Merkle tree will NOT produce roots or proofs that match
 * the circuit's SMTVerifier.
 *
 * This class wraps the circomlibjs SMT reference implementation so roots
 * and non-membership proofs are bit-compatible with the circuit by
 * construction.
 */
export class RevokedTree {
  private organizationId: string;
  private revokedKeys: Set<bigint> = new Set();
  private epoch: number = 0;
  private root: bigint = BigInt(0);
  private smt: any = null; // circomlibjs SMT instance (async-initialized)
  private initialized: boolean = false;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  async initialize(): Promise<void> {
    await initMerkleCrypto();
    this.initialized = true;
    await this.loadFromDb();
  }

  private async loadFromDb(): Promise<void> {
    const stored = runSingle<{ epoch: number; root: string }>(
      "SELECT epoch, root FROM revocation_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );

    if (stored) {
      this.epoch = stored.epoch;
      this.root = BigInt(stored.root);
    }

    const revoked = runQuery<{ nullifier: string; secret: string }>(
      "SELECT nullifier, secret FROM credentials WHERE organization_id = ? AND revoked = 1",
      this.organizationId
    );

    // The circuit's revocation key = Poseidon2(secret, 0) mod 2^64.
    // We store revoked keys by revocationKey, not by nullifier — the circuit
    // proves non-membership of revocationKey in the SMT.
    const { computeRevocationKey } = await import("../core/zk-prover");
    for (const r of revoked) {
      try {
        // secret is stored as hex; use it to compute the revocation key
        const secretBigInt = r.secret ? BigInt("0x" + r.secret) : BigInt(r.nullifier);
        const revocationKey = await computeRevocationKey(secretBigInt);
        this.revokedKeys.add(revocationKey);
      } catch {
        // Fall back to nullifier for legacy rows
        this.revokedKeys.add(BigInt(r.nullifier));
      }
    }

    await this.rebuild();
  }

  /**
   * Rebuild the SMT from the current set of revoked keys.
   * This re-creates the circomlibjs SMT and re-inserts all keys.
   */
  async rebuild(): Promise<void> {
    if (!this.initialized) return;
    this.smt = await buildRevokedSmtFromKeys(Array.from(this.revokedKeys));
    const F = this.smt.F;
    this.root = BigInt(F.toString(this.smt.root));
    logger.info("revoked-tree", `Rebuilt SMT for org ${this.organizationId}: root=${this.root.toString().slice(0, 20)}... revokedKeys=${this.revokedKeys.size}`);
  }

  /**
   * Add a revoked key (revocation key) to the SMT.
   * key should be computeRevocationKey(secret) = Poseidon2(secret, 0) mod 2^64.
   */
  async addRevocationKey(revocationKey: bigint): Promise<{ root: bigint; epoch: number }> {
    if (!this.smt) await this.rebuild();
    const F = this.smt.F;
    try {
      await this.smt.insert(F.e(revocationKey.toString()), F.e("1"));
    } catch {
      // already present — skip
    }
    this.revokedKeys.add(revocationKey);
    this.root = BigInt(F.toString(this.smt.root));
    this.epoch++;
    this.persistRoot();
    this.persistSnapshot();
    return { root: this.root, epoch: this.epoch };
  }

  /**
   * Legacy alias: addNullifier — but the circuit keys the SMT by
   * revocationKey (Poseidon2(secret,0) mod 2^64), not the nullifier.
   * Prefer addRevocationKey() for new code.
   */
  async addNullifier(revocationKey: bigint): Promise<{ root: bigint; epoch: number }> {
    return this.addRevocationKey(revocationKey);
  }

  private persistRoot(): void {
    runExecute(
      "INSERT INTO revocation_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId,
      this.root.toString(),
      this.epoch
    );
  }

  /**
   * Persist the full SMT state (revoked keys + root) to merkle_snapshots.
   * This allows tree reconstruction without re-reading all revoked credentials.
   */
  private persistSnapshot(): void {
    const snapshot = this.snapshot();
    runExecute(
      `INSERT INTO merkle_snapshots (organization_id, tree_type, epoch, root, data)
       VALUES (?, 'revoked', ?, ?, ?)`,
      this.organizationId,
      this.epoch,
      this.root.toString(),
      snapshot
    );
    logger.info("revoked-tree", `Persisted SMT snapshot for org ${this.organizationId}: epoch=${this.epoch}`);
  }

  /**
   * Produce a non-membership proof for a revocation key.
   * This is exactly what the circuit's SMTVerifier consumes:
   *   siblings[depth], oldKey, oldValue, isOld0
   */
  async getNonMembershipProof(revocationKey: bigint): Promise<SmtNonMembershipProof | null> {
    if (!this.smt) await this.rebuild();
    if (this.revokedKeys.has(revocationKey)) {
      // Key IS revoked — cannot produce a non-membership proof
      return null;
    }
    return smtNonMembershipProof(this.smt, revocationKey, TREE_DEPTH);
  }

  isRevoked(revocationKey: bigint): boolean {
    return this.revokedKeys.has(revocationKey);
  }

  getRoot(): string {
    return this.root.toString();
  }

  getEpoch(): number {
    return this.epoch;
  }

  getRevokedCount(): number {
    return this.revokedKeys.size;
  }

  snapshot(): string {
    return JSON.stringify({
      root: this.root.toString(),
      epoch: this.epoch,
      revokedKeys: Array.from(this.revokedKeys).map((k) => k.toString()),
      timestamp: Date.now(),
    });
  }

  restore(snapshotData: string): void {
    const snapshot = JSON.parse(snapshotData);
    this.root = BigInt(snapshot.root);
    this.epoch = snapshot.epoch;
    logger.info("revoked-tree", `Restored SMT snapshot for org ${this.organizationId}: epoch=${this.epoch}`);
  }

  async exportTree(): Promise<string> {
    return JSON.stringify({
      organizationId: this.organizationId,
      root: this.root.toString(),
      epoch: this.epoch,
      revokedKeys: Array.from(this.revokedKeys).map((n) => n.toString()),
      exportedAt: Date.now(),
    });
  }

  async importTree(data: string): Promise<void> {
    const parsed = JSON.parse(data);
    this.revokedKeys.clear();
    for (const n of parsed.revokedKeys) {
      this.revokedKeys.add(BigInt(n));
    }
    this.epoch = parsed.epoch || 0;
    await this.rebuild();
    this.persistRoot();
    logger.info("revoked-tree", `Imported SMT for org ${this.organizationId}: ${this.revokedKeys.size} keys`);
  }

  verifyConsistency(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (this.smt) {
      const F = this.smt.F;
      const computedRoot = BigInt(F.toString(this.smt.root));
      if (this.root !== computedRoot) {
        errors.push(`Root mismatch: stored=${this.root.toString()}, computed=${computedRoot.toString()}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
}

const treeCache: Map<string, RevokedTree> = new Map();

export async function getRevokedTree(organizationId: string): Promise<RevokedTree> {
  if (treeCache.has(organizationId)) return treeCache.get(organizationId)!;
  const tree = new RevokedTree(organizationId);
  await tree.initialize();
  treeCache.set(organizationId, tree);
  return tree;
}
