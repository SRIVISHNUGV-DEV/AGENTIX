import {
  buildRevokedTree,
  hashLeaf,
  initMerkleCrypto,
  serializeTreeSnapshot,
  deserializeTreeSnapshot,
} from "../utils/merkle";
import { runExecute, runSingle } from "../core/database";
import { logger } from "../core/logger";

const TREE_DEPTH = 20;

export class RevokedTree {
  private organizationId: string;
  private nullifiers: Set<bigint> = new Set();
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
      "SELECT epoch, root FROM revocation_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );

    if (stored) {
      this.epoch = stored.epoch;
      this.root = BigInt(stored.root);
    }

    const revoked = runSingle<{ nullifier: string }[]>(
      "SELECT nullifier FROM credentials WHERE organization_id = ? AND revoked = 1",
      this.organizationId
    ) as any;

    if (Array.isArray(revoked)) {
      for (const r of revoked) {
        this.nullifiers.add(BigInt(r.nullifier));
      }
    }

    this.rebuild();
  }

  rebuild(): void {
    if (!this.initialized) return;
    const result = buildRevokedTree(this.nullifiers, TREE_DEPTH);
    this.root = result.root;
    logger.info("revoked-tree", `Rebuilt revoked tree for org ${this.organizationId}: root=${this.root.toString().slice(0, 20)}... nullifiers=${this.nullifiers.size}`);
  }

  addNullifier(nullifier: bigint): { root: bigint; epoch: number } {
    this.nullifiers.add(nullifier);
    this.epoch++;
    this.rebuild();
    this.persistRoot();
    return { root: this.root, epoch: this.epoch };
  }

  private persistRoot(): void {
    runExecute(
      "INSERT INTO revocation_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId,
      this.root.toString(),
      this.epoch
    );
  }

  getRoot(): string {
    return this.root.toString();
  }

  getEpoch(): number {
    return this.epoch;
  }

  isRevoked(nullifier: bigint): boolean {
    return this.nullifiers.has(nullifier);
  }

  snapshot(): string {
    const result = buildRevokedTree(this.nullifiers, TREE_DEPTH);
    return serializeTreeSnapshot(this.root, result.layers, this.epoch);
  }

  restore(snapshotData: string): void {
    const snapshot = deserializeTreeSnapshot(snapshotData);
    this.root = snapshot.root;
    this.epoch = snapshot.epoch;
    logger.info("revoked-tree", `Restored snapshot for org ${this.organizationId}: epoch=${this.epoch}`);
  }

  async exportTree(): Promise<string> {
    return JSON.stringify({
      organizationId: this.organizationId,
      root: this.root.toString(),
      epoch: this.epoch,
      nullifiers: Array.from(this.nullifiers).map((n) => n.toString()),
      exportedAt: Date.now(),
    });
  }

  async importTree(data: string): Promise<void> {
    const parsed = JSON.parse(data);
    this.nullifiers.clear();
    for (const n of parsed.nullifiers) {
      this.nullifiers.add(BigInt(n));
    }
    this.epoch = parsed.epoch || 0;
    this.rebuild();
    this.persistRoot();
    logger.info("revoked-tree", `Imported revoked tree for org ${this.organizationId}: ${this.nullifiers.size} nullifiers`);
  }

  verifyConsistency(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const result = buildRevokedTree(this.nullifiers, TREE_DEPTH);

    if (this.root !== result.root) {
      errors.push(`Root mismatch: stored=${this.root.toString()}, computed=${result.root.toString()}`);
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
