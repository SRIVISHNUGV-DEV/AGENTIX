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

  /**
   * Creates an uninitialized active tree for one organization.
   * Call initialize() before any other method — the tree loads its leaves from the DB there.
   * @param organizationId - The org this tree belongs to; trees are per-org and never shared.
   * Maps to: internal — getActiveTree (cached singleton per org).
   */
  constructor(organizationId: string) {
    this.organizationId = organizationId;
    this.tree = new IncrementalMerkleTree(TREE_DEPTH);
  }

  /**
   * Loads the tree's leaves and anchored root from the local DB (see loadFromDb).
   * Must run before addLeaf/getProof/etc.; the tree is empty until it does. Idempotent only in the sense that a second call reloads from DB — prefer one call per instance.
   * @throws When the Poseidon crypto backend fails to initialize.
   * Maps to: internal — getActiveTree.
   * Side effects: reads credential and root rows from the DB; may backfill leaf_index values on legacy rows.
   */
  async initialize(): Promise<void> {
    await initMerkleCrypto();
    this.initialized = true;
    this.loadFromDb();
  }

  /**
   * Rebuilds the in-memory tree from the DB's active credentials (dense indices) and checks the rebuilt root against the anchored root.
   * Legacy rows without a leaf_index get the next free dense index and are written back; a root mismatch is logged as ROOT DRIFT (it does not throw — re-anchor on-chain only after investigating).
   * Maps to: internal — ActiveTree.initialize and rebuild.
   * Side effects: DB reads and (for legacy rows) leaf_index UPDATEs; logs load stats and any root drift.
   */
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
   * Adds a credential commitment as a new dense leaf. Returns root, epoch, and the assigned dense leaf index (caller persists it onto the credential row).
   * Adding an already-present commitment is a no-op for placement (same index) but still bumps the epoch and persists a root row — callers must not assume a second add is free.
   * @param _key - Ignored (kept for the old keyed API); placement uses the dense index, not the key.
   * @param value - The commitment itself, used directly as the leaf (no hashLeaf step — the circuit expects the raw commitment).
   * @returns The new root, the bumped epoch, and the dense leaf index.
   * @throws When the tree is full (2^20 leaves).
   * Maps to: circuit credential_V1.circom (activeMerkle leaf = commitment); MCP tool agentix_cred_list flows.
   * Side effects: inserts the leaf, bumps the epoch, and persists a new root row.
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

  /**
   * Removes a commitment's leaf (resets it to the empty value) and bumps the epoch.
   * Removing an absent commitment is a silent no-op that still returns the current root and epoch.
   * @returns The root and epoch after removal (unchanged when the commitment was absent).
   * Maps to: internal — credential revocation flows that drop a leaf from the active tree.
   * Side effects: removes the leaf, bumps the epoch, and persists a new root row when the leaf existed.
   */
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

  /**
   * Appends the current root and epoch to the credential_roots table.
   * Roots are append-only history — nothing here deletes or overwrites an older root row.
   * Maps to: internal — ActiveTree.addLeaf and removeLeaf.
   * Side effects: DB INSERT.
   */
  private persistRoot(): void {
    runExecute(
      "INSERT INTO credential_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId,
      this.tree.root().toString(),
      this.epoch
    );
  }

  /**
   * Returns the circuit-compatible Merkle proof for a commitment, O(depth).
   * The proof (path elements, indices, root) is exactly what credential_V1's MerkleProof template consumes.
   * @returns The proof with stringified bigints, or null when the commitment is not in the tree.
   * Maps to: circuit credential_V1.circom (MerkleProof template); MCP tool agentix_proof_verify flows.
   */
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

  /**
   * Returns the circuit-compatible Merkle proof for a leaf by explicit dense index, O(depth).
   * Prefer getProofForCommitment unless the caller already holds the dense index.
   * @param leafIndex - Dense index (0-based); out-of-range indices produce a proof against empty leaves, not an error.
   * @returns The proof with stringified path elements and indices (no root — use getRoot for it).
   * Maps to: circuit credential_V1.circom (MerkleProof template).
   */
  getProof(leafIndex: number): { pathElements: string[]; pathIndices: number[] } {
    const proof = this.tree.getProof(leafIndex);
    return { pathElements: proof.pathElements.map((e) => e.toString()), pathIndices: proof.pathIndices };
  }

  /**
   * Returns the dense leaf index of a commitment, or -1 when it is not in the tree.
   * @returns The index, or -1 on a miss.
   * Maps to: internal — ActiveTree.getProofForCommitment and callers resolving commitments to indices.
   */
  findLeafIndex(commitment: bigint): number {
    return this.indexOf.get(commitment) ?? -1;
  }

  /**
   * Reports whether a commitment is currently in the active tree.
   * @returns True when present, false otherwise.
   * Maps to: internal — credential membership checks before proving.
   */
  hasLeaf(commitment: bigint): boolean {
    return this.indexOf.has(commitment);
  }

  /**
   * Returns the current Merkle root as a decimal string.
   * This is the value that must match the on-chain anchored root; a mismatch means the tree and the chain disagree.
   * @returns The root, decimal-stringified.
   * Maps to: contract OrganizationCredentialAnchor.currentRoot; MCP tool agentix_tree_status.
   */
  getRoot(): string {
    return this.tree.root().toString();
  }

  /**
   * Returns the tree's epoch (incremented on every add/remove).
   * @returns The current epoch, 0 before any mutation.
   * Maps to: internal — ActiveTree snapshot/restore and anchor epoch tracking.
   */
  getEpoch(): number {
    return this.epoch;
  }

  /**
   * Returns the number of leaves currently in the tree.
   * @returns The leaf count (size of the underlying incremental tree).
   * Maps to: internal — ActiveTree.verifySnapshotIntegrity.
   */
  getLeafCount(): number {
    return this.tree.size;
  }

  /**
   * Serializes the full tree state (root, epoch, next index, all commitment->index pairs) to JSON.
   * The snapshot is the portable form — restore() rebuilds the identical tree from it.
   * @returns The JSON snapshot string.
   * Maps to: internal — ActiveTree.exportTree and snapshot persistence.
   */
  snapshot(): string {
    return JSON.stringify({
      root: this.tree.root().toString(),
      epoch: this.epoch,
      nextIndex: this.nextIndex,
      leaves: Array.from(this.indexOf.entries()).map(([commitment, index]) => ({ commitment: commitment.toString(), index })),
      timestamp: Date.now(),
    });
  }

  /**
   * Rebuilds the tree from a snapshot produced by snapshot().
   * Clears all current state first; the epoch and next index come from the snapshot (or are recomputed when absent).
   * @param snapshotData - JSON from snapshot(); malformed JSON throws and the tree is left partially cleared.
   * @throws On malformed JSON or non-bigint leaf values.
   * Maps to: internal — ActiveTree.importTree and rebuildFromSnapshot.
   * Side effects: replaces the in-memory tree wholesale.
   */
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

  /**
   * Replaces the tree with a snapshot and persists the new root.
   * The async wrapper around restore() + persistRoot() for callers that import by string.
   * @throws On malformed snapshot data.
   * Maps to: internal — ActiveTree.restore; CLI 'agentix tree' import.
   * Side effects: replaces the in-memory tree and appends a root row.
   */
  async importTree(data: string): Promise<void> {
    this.restore(data);
    this.persistRoot();
  }

  /**
   * Exports the tree as a JSON snapshot string.
   * @returns The snapshot JSON (same format restore() consumes).
   * Maps to: internal — ActiveTree.snapshot; CLI 'agentix tree' export.
   */
  async exportTree(): Promise<string> {
    return this.snapshot();
  }

  /**
   * Rebuilds a fresh tree from the same index->commitment set and compares roots.
   * Catches in-memory corruption (a diverged root) without touching the DB.
   * @returns { valid, errors } — valid is false with a root-mismatch message when the rebuild disagrees.
   * Maps to: internal — ActiveTree.verifySnapshotIntegrity.
   */
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

  /**
   * Checks the tree against the DB: leaf count vs active-credential count, plus a root rebuild check.
   * The counts must agree — a mismatch means credentials were added/removed without the tree knowing.
   * @returns { valid, errors, credentialCount, leafCount } — errors list every mismatch found.
   * Maps to: internal — tree health checks (CLI 'agentix tree' status / doctor).
   * Side effects: DB read.
   */
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

  /**
   * Rebuilds the tree from the current DB credential set (fresh reload).
   * No-op before initialize(); otherwise clears the in-memory index and reloads from DB.
   * Maps to: internal — ActiveTree.loadFromDb; CLI 'agentix tree' rebuild.
   * Side effects: replaces the in-memory tree; may backfill leaf_index values on legacy rows.
   */
  rebuild(): void {
    if (!this.initialized) return;
    this.indexOf.clear();
    this.loadFromDb();
  }

  /**
   * Rebuilds the tree from a snapshot and persists the restored root.
   * @throws On malformed snapshot data.
   * Maps to: internal — ActiveTree.restore; CLI 'agentix tree' restore.
   * Side effects: replaces the in-memory tree and appends a root row.
   */
  rebuildFromSnapshot(snapshotData: string): void {
    this.restore(snapshotData);
    this.persistRoot();
  }

  /**
   * Returns the newest stored 'active' snapshot for this org, or null when none exists.
   * Snapshots live in merkle_snapshots; the newest by epoch wins.
   * @returns The snapshot data string, or null when the org has no stored snapshot.
   * Maps to: internal — ActiveTree snapshot/restore flows.
   * Side effects: DB read.
   */
  getLatestSnapshot(): string | null {
    const row = runSingle<{ data: string }>(
      "SELECT data FROM merkle_snapshots WHERE organization_id = ? AND tree_type = 'active' ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );
    return row?.data || null;
  }

  /**
   * Lists all stored 'active' snapshots for this org, newest epoch first.
   * The timestamp is parsed from each snapshot's JSON (0 when the JSON is unreadable — the row is still listed).
   * @returns The snapshot summaries; an empty array when none exist.
   * Maps to: internal — snapshot management (CLI 'agentix tree' flows).
   * Side effects: DB read.
   */
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

/**
 * Returns the cached ActiveTree for an org, creating and initializing it on first use.
 * The cache is process-global: every caller shares the same instance, so mutations are visible to all of them.
 * @returns The initialized ActiveTree for the org.
 * @throws When Poseidon initialization or the DB load fails.
 * Maps to: internal — credential issuance and proof flows that need the active tree.
 * Side effects: first call constructs the tree and reads the DB; later calls return the cached instance.
 */
export async function getActiveTree(organizationId: string): Promise<ActiveTree> {
  if (treeCache.has(organizationId)) return treeCache.get(organizationId)!;
  const tree = new ActiveTree(organizationId);
  await tree.initialize();
  treeCache.set(organizationId, tree);
  return tree;
}
