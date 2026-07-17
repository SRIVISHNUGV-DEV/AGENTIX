import { IncrementalMerkleTree, initMerkleCrypto } from "../utils/merkle";
import { runExecute, runSingle, runQuery } from "../core/database";
import { logger } from "../core/logger";

const TREE_DEPTH = 20;
const MAX_LEAVES = 2 ** TREE_DEPTH;

/**
 * ActiveTree — the active-credential Merkle tree.
 *
 * Circuit compatibility (credential_V1.circom): activeMerkle.leaf <== commitment.
 * The commitment (Poseidon7 output) is the leaf directly — NO hashLeaf step.
 *
 * Indexing (CHANGED): each credential occupies a DENSE, per-organization leaf
 * index (0,1,2,…) assigned at issuance and persisted in credentials.leaf_index.
 * This replaces the old `commitment % 2^depth` placement, which silently
 * overwrote any two commitments colliding in the low 20 bits (birthday-bound
 * ~50% at ~1,200 credentials). Dense indices are collision-free to 2^depth.
 *
 * The circuit verifies leaf+path→root and is index-agnostic, so the change is
 * transparent to proving. Backed by IncrementalMerkleTree: insert/getProof are
 * O(depth) (~20 hashes), root() is O(1) — no 1M-array, subsecond reads.
 */
export class ActiveTree {
  private organizationId: string;
  private tree: IncrementalMerkleTree;
  private indexOf: Map<bigint, number> = new Map(); // commitment -> dense index
  private nextIndex = 0;
  private epoch = 0;
  private initialized = false;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
    this.tree = new IncrementalMerkleTree(TREE_DEPTH);
  }

  async initialize(): Promise<void> {
    await initMerkleCrypto();
    this.initialized = true;
    this.loadFromDb();
  }

  private loadFromDb(): void {
    const stored = runSingle<{ epoch: number; root: string }>(
      "SELECT epoch, root FROM credential_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );
    const anchoredRoot: bigint | null = stored ? BigInt(stored.root) : null;
    if (stored) this.epoch = stored.epoch;

    const maxEpoch = runSingle<{ max_epoch: number }>(
      "SELECT COALESCE(MAX(epoch), 0) as max_epoch FROM credential_roots WHERE organization_id = ?",
      this.organizationId
    );
    if (maxEpoch) this.epoch = Math.max(this.epoch, maxEpoch.max_epoch);

    // Assigned-index rows first (ordered), then legacy (-1) rows in issuance order.
    const rows = runQuery<{ id: number; commitment: string; nullifier: string; leaf_index: number }>(
      "SELECT id, commitment, nullifier, leaf_index FROM credentials WHERE organization_id = ? AND revoked = 0 ORDER BY (leaf_index >= 0) DESC, leaf_index ASC, id ASC",
      this.organizationId
    );

    const entries: Array<[number, bigint]> = [];
    let maxIndex = -1;
    const backfills: Array<{ id: number; index: number }> = [];

    for (const cred of rows) {
      const leafValue = cred.commitment ? BigInt(cred.commitment) : BigInt(cred.nullifier);
      let idx = cred.leaf_index;
      if (idx === null || idx === undefined || idx < 0) {
        idx = maxIndex + 1;
        backfills.push({ id: cred.id, index: idx });
      }
      if (idx >= MAX_LEAVES) {
        logger.error("active-tree", `Leaf index ${idx} exceeds capacity for org ${this.organizationId}; skipping id=${cred.id}`);
        continue;
      }
      this.indexOf.set(leafValue, idx);
      entries.push([idx, leafValue]);
      if (idx > maxIndex) maxIndex = idx;
    }

    this.nextIndex = maxIndex + 1;
    this.tree.loadLeaves(entries);

    for (const b of backfills) {
      runExecute("UPDATE credentials SET leaf_index = ? WHERE id = ?", b.index, b.id);
    }
    if (backfills.length > 0) {
      logger.info("active-tree", `Back-filled leaf_index for ${backfills.length} legacy credential(s) in org ${this.organizationId}`);
    }

    logger.info("active-tree", `Loaded tree for org ${this.organizationId}: root=${this.tree.root().toString().slice(0, 20)}... leaves=${this.tree.size}`);

    if (anchoredRoot !== null && anchoredRoot !== BigInt(0) && this.tree.root() !== anchoredRoot) {
      logger.error(
        "active-tree",
        `ROOT DRIFT for org ${this.organizationId}: rebuilt root ${this.tree.root().toString().slice(0, 24)}... != anchored ${anchoredRoot.toString().slice(0, 24)}... (epoch ${this.epoch}). Re-anchor on-chain after investigating.`
      );
    }
  }

  /**
   * Add a credential commitment as a new dense leaf. Returns root, epoch, and the
   * assigned dense leaf index (caller persists it onto the credential row).
   */
  addLeaf(_key: bigint, value: bigint): { root: bigint; epoch: number; leafIndex: number } {
    let idx = this.indexOf.get(value);
    if (idx === undefined) {
      if (this.nextIndex >= MAX_LEAVES) {
        throw new Error(`Active tree for org ${this.organizationId} is full (${MAX_LEAVES} leaves)`);
      }
      idx = this.nextIndex++;
      this.indexOf.set(value, idx);
    }
    this.tree.insert(idx, value);
    this.epoch++;
    this.persistRoot();
    return { root: this.tree.root(), epoch: this.epoch, leafIndex: idx };
  }

  removeLeaf(commitment: bigint): { root: bigint; epoch: number } {
    const idx = this.indexOf.get(commitment);
    if (idx !== undefined) {
      this.tree.remove(idx);
      this.indexOf.delete(commitment);
      this.epoch++;
      this.persistRoot();
    }
    return { root: this.tree.root(), epoch: this.epoch };
  }

  private persistRoot(): void {
    runExecute(
      "INSERT INTO credential_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId,
      this.tree.root().toString(),
      this.epoch
    );
  }

  /** Circuit-compatible proof for a commitment, O(depth). Null if not present. */
  getProofForCommitment(commitment: bigint): { pathElements: string[]; pathIndices: number[]; root: string } | null {
    const idx = this.indexOf.get(commitment);
    if (idx === undefined) return null;
    const proof = this.tree.getProof(idx);
    return {
      pathElements: proof.pathElements.map((e) => e.toString()),
      pathIndices: proof.pathIndices,
      root: proof.root.toString(),
    };
  }

  /** Proof by explicit dense index, O(depth). */
  getProof(leafIndex: number): { pathElements: string[]; pathIndices: number[] } {
    const proof = this.tree.getProof(leafIndex);
    return { pathElements: proof.pathElements.map((e) => e.toString()), pathIndices: proof.pathIndices };
  }

  findLeafIndex(commitment: bigint): number {
    return this.indexOf.get(commitment) ?? -1;
  }

  hasLeaf(commitment: bigint): boolean {
    return this.indexOf.has(commitment);
  }

  getRoot(): string {
    return this.tree.root().toString();
  }

  getEpoch(): number {
    return this.epoch;
  }

  getLeafCount(): number {
    return this.tree.size;
  }

  snapshot(): string {
    return JSON.stringify({
      root: this.tree.root().toString(),
      epoch: this.epoch,
      nextIndex: this.nextIndex,
      leaves: Array.from(this.indexOf.entries()).map(([commitment, index]) => ({ commitment: commitment.toString(), index })),
      timestamp: Date.now(),
    });
  }

  restore(snapshotData: string): void {
    const snap = JSON.parse(snapshotData);
    this.indexOf.clear();
    const entries: Array<[number, bigint]> = [];
    for (const leaf of snap.leaves) {
      const commitment = BigInt(leaf.commitment);
      this.indexOf.set(commitment, leaf.index);
      entries.push([leaf.index, commitment]);
    }
    this.epoch = snap.epoch || 0;
    this.nextIndex = snap.nextIndex ?? (entries.reduce((m, [i]) => Math.max(m, i), -1) + 1);
    this.tree.loadLeaves(entries);
    logger.info("active-tree", `Restored snapshot for org ${this.organizationId}: ${this.indexOf.size} leaves`);
  }

  async importTree(data: string): Promise<void> {
    this.restore(data);
    this.persistRoot();
  }

  async exportTree(): Promise<string> {
    return this.snapshot();
  }

  verifyConsistency(): { valid: boolean; errors: string[] } {
    // Rebuild a fresh tree from the same index→commitment set and compare roots.
    const check = new IncrementalMerkleTree(TREE_DEPTH);
    check.loadLeaves(Array.from(this.indexOf.entries()).map(([c, i]) => [i, c] as [number, bigint]));
    const errors: string[] = [];
    if (check.root() !== this.tree.root()) {
      errors.push(`Root mismatch: live=${this.tree.root().toString()}, recomputed=${check.root().toString()}`);
    }
    return { valid: errors.length === 0, errors };
  }

  verifySnapshotIntegrity(): { valid: boolean; errors: string[]; credentialCount: number; leafCount: number } {
    const errors: string[] = [];
    const creds = runSingle<{ count: number }>(
      "SELECT COUNT(*) as count FROM credentials WHERE organization_id = ? AND revoked = 0",
      this.organizationId
    );
    const credentialCount = creds?.count || 0;
    if (this.tree.size !== credentialCount) {
      errors.push(`Leaf count mismatch: tree has ${this.tree.size}, DB has ${credentialCount} active credentials`);
    }
    const consistency = this.verifyConsistency();
    if (!consistency.valid) errors.push(...consistency.errors);
    return { valid: errors.length === 0, errors, credentialCount, leafCount: this.tree.size };
  }

  /** Rebuild the tree from the current DB credential set (fresh reload). */
  rebuild(): void {
    if (!this.initialized) return;
    this.indexOf.clear();
    this.loadFromDb();
  }

  rebuildFromSnapshot(snapshotData: string): void {
    this.restore(snapshotData);
    this.persistRoot();
  }

  getLatestSnapshot(): string | null {
    const row = runSingle<{ data: string }>(
      "SELECT data FROM merkle_snapshots WHERE organization_id = ? AND tree_type = 'active' ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );
    return row?.data || null;
  }

  listSnapshots(): Array<{ epoch: number; root: string; timestamp: number }> {
    const rows = runQuery<{ epoch: number; root: string; data: string }>(
      "SELECT epoch, root, data FROM merkle_snapshots WHERE organization_id = ? AND tree_type = 'active' ORDER BY epoch DESC",
      this.organizationId
    );
    return rows.map((r) => {
      let timestamp = 0;
      try { timestamp = JSON.parse(r.data).timestamp || 0; } catch {}
      return { epoch: r.epoch, root: r.root, timestamp };
    });
  }
}

const treeCache: Map<string, ActiveTree> = new Map();

export async function getActiveTree(organizationId: string): Promise<ActiveTree> {
  if (treeCache.has(organizationId)) return treeCache.get(organizationId)!;
  const tree = new ActiveTree(organizationId);
  await tree.initialize();
  treeCache.set(organizationId, tree);
  return tree;
}
