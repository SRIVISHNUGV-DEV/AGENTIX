import {
  buildMerkleTree,
  getMerkleProof,
  hashLeaf,
  initMerkleCrypto,
  serializeTreeSnapshot,
  deserializeTreeSnapshot,
} from "../utils/merkle";
import { runExecute, runSingle, runQuery, runTransaction } from "../core/database";
import { logger } from "../core/logger";

const TREE_DEPTH = 20;

export class ActiveTree {
  private organizationId: string;
  private leaves: Map<bigint, bigint> = new Map();
  private epoch: number = 0;
  private root: bigint = BigInt(0);
  private initialized: boolean = false;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  async initialize(): Promise<void> {
    await initMerkleCrypto();
    await this.loadFromDb();
    this.initialized = true;
  }

  private loadFromDb(): void {
    const stored = runSingle<{ epoch: number; root: string }>(
      "SELECT epoch, root FROM credential_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );

    if (stored) {
      this.epoch = stored.epoch;
      this.root = BigInt(stored.root);
    }

    const creds = runSingle<{ max_epoch: number }>(
      "SELECT COALESCE(MAX(epoch), 0) as max_epoch FROM credential_roots WHERE organization_id = ?",
      this.organizationId
    );
    if (creds) this.epoch = Math.max(this.epoch, creds.max_epoch);

    const rows = runSingle<{ count: number }>(
      "SELECT COUNT(*) as count FROM credentials WHERE organization_id = ? AND revoked = 0",
      this.organizationId
    );
    if (rows && rows.count > 0) {
      const credentials = runQuery<{ agent_id: number; nullifier: string }>(
        "SELECT agent_id, nullifier FROM credentials WHERE organization_id = ? AND revoked = 0",
        this.organizationId
      );
      for (const cred of credentials) {
        const key = BigInt(cred.agent_id);
        const value = BigInt(cred.nullifier);
        this.leaves.set(key, value);
      }
    }

    this.rebuild();
  }

  rebuild(): void {
    if (!this.initialized) return;
    const result = buildMerkleTree(this.leaves, TREE_DEPTH);
    this.root = result.root;
    logger.info("active-tree", `Rebuilt tree for org ${this.organizationId}: root=${this.root.toString().slice(0, 20)}... leaves=${this.leaves.size}`);
  }

  addLeaf(key: bigint, value: bigint): { root: bigint; epoch: number } {
    this.leaves.set(key, value);
    this.epoch++;
    this.rebuild();
    this.persistRoot();
    return { root: this.root, epoch: this.epoch };
  }

  removeLeaf(key: bigint): { root: bigint; epoch: number } {
    this.leaves.delete(key);
    this.epoch++;
    this.rebuild();
    this.persistRoot();
    return { root: this.root, epoch: this.epoch };
  }

  private persistRoot(): void {
    runExecute(
      "INSERT INTO credential_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId,
      this.root.toString(),
      this.epoch
    );
  }

  getProof(leafIndex: number): { pathElements: string[]; pathIndices: number[] } {
    const result = buildMerkleTree(this.leaves, TREE_DEPTH);
    const proof = getMerkleProof(result.layers, leafIndex, TREE_DEPTH);
    return {
      pathElements: proof.pathElements.map((e) => e.toString()),
      pathIndices: proof.pathIndices,
    };
  }

  getRoot(): string {
    return this.root.toString();
  }

  getEpoch(): number {
    return this.epoch;
  }

  getLeafCount(): number {
    return this.leaves.size;
  }

  snapshot(): string {
    const result = buildMerkleTree(this.leaves, TREE_DEPTH);
    return serializeTreeSnapshot(this.root, result.layers, this.epoch);
  }

  restore(snapshotData: string): void {
    const snapshot = deserializeTreeSnapshot(snapshotData);
    this.root = snapshot.root;
    this.epoch = snapshot.epoch;
    logger.info("active-tree", `Restored snapshot for org ${this.organizationId}: epoch=${this.epoch}`);
  }

  async exportTree(): Promise<string> {
    const creds = runSingle<{ agent_id: number; nullifier: string }[]>(
      "SELECT agent_id, nullifier FROM credentials WHERE organization_id = ? AND revoked = 0",
      this.organizationId
    ) as any;

    const leaves: Array<{ key: string; value: string }> = [];
    if (Array.isArray(creds)) {
      for (const c of creds) {
        leaves.push({ key: String(c.agent_id), value: c.nullifier });
      }
    }

    return JSON.stringify({
      organizationId: this.organizationId,
      root: this.root.toString(),
      epoch: this.epoch,
      leaves,
      exportedAt: Date.now(),
    });
  }

  async importTree(data: string): Promise<void> {
    const parsed = JSON.parse(data);
    this.leaves.clear();
    for (const leaf of parsed.leaves) {
      this.leaves.set(BigInt(leaf.key), BigInt(leaf.value));
    }
    this.epoch = parsed.epoch || 0;
    this.rebuild();
    this.persistRoot();
    logger.info("active-tree", `Imported tree for org ${this.organizationId}: ${this.leaves.size} leaves`);
  }

  verifyConsistency(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const result = buildMerkleTree(this.leaves, TREE_DEPTH);

    if (this.root !== result.root) {
      errors.push(`Root mismatch: stored=${this.root.toString()}, computed=${result.root.toString()}`);
    }

    return { valid: errors.length === 0, errors };
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
