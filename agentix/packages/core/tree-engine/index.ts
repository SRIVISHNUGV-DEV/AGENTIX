import { buildMerkleTree, getMerkleProof, hashLeaf, initMerkleCrypto, serializeTreeSnapshot, deserializeTreeSnapshot } from "./merkle";
import { runExecute, runSingle, runQuery } from "../database";
import { TREE_DEPTH, ZERO_VALUE } from "../../shared/constants";

export class TreeEngine {
  private organizationId: string;
  private activeLeaves: Map<bigint, bigint> = new Map();
  private revokedLeaves: Set<bigint> = new Set();
  private activeEpoch = 0;
  private revokedEpoch = 0;
  private activeRoot = ZERO_VALUE;
  private revokedRoot = ZERO_VALUE;
  private initialized = false;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  async initialize(): Promise<void> {
    await initMerkleCrypto();
    this.loadFromDb();
    this.initialized = true;
  }

  private loadFromDb(): void {
    const activeStored = runSingle<{ epoch: number; root: string }>(
      "SELECT epoch, root FROM credential_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );
    if (activeStored) {
      this.activeEpoch = activeStored.epoch;
      this.activeRoot = BigInt(activeStored.root);
    }

    const revokedStored = runSingle<{ epoch: number; root: string }>(
      "SELECT epoch, root FROM revocation_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
      this.organizationId
    );
    if (revokedStored) {
      this.revokedEpoch = revokedStored.epoch;
      this.revokedRoot = BigInt(revokedStored.root);
    }

    const creds = runQuery<{ agent_id: number; nullifier: string }>(
      "SELECT agent_id, nullifier FROM credentials WHERE organization_id = ? AND revoked = 0",
      this.organizationId
    );
    for (const c of creds) {
      this.activeLeaves.set(BigInt(c.agent_id), BigInt(c.nullifier));
    }

    const revoked = runQuery<{ nullifier: string }>(
      "SELECT nullifier FROM credentials WHERE organization_id = ? AND revoked = 1",
      this.organizationId
    );
    for (const r of revoked) {
      this.revokedLeaves.add(BigInt(r.nullifier));
    }

    this.rebuildActive();
    this.rebuildRevoked();
  }

  private rebuildActive(): void {
    if (!this.initialized) return;
    const result = buildMerkleTree(this.activeLeaves, TREE_DEPTH);
    this.activeRoot = result.root;
  }

  private rebuildRevoked(): void {
    if (!this.initialized) return;
    const leaves = new Map<bigint, bigint>();
    for (const n of this.revokedLeaves) {
      leaves.set(n, BigInt(1));
    }
    const result = buildMerkleTree(leaves, TREE_DEPTH);
    this.revokedRoot = result.root;
  }

  addCredential(agentId: number, nullifier: string): { activeRoot: string; epoch: number } {
    this.activeLeaves.set(BigInt(agentId), BigInt(nullifier));
    this.activeEpoch++;
    this.rebuildActive();
    this.persistActiveRoot();
    return { activeRoot: this.activeRoot.toString(), epoch: this.activeEpoch };
  }

  revokeCredential(agentId: number, nullifier: string): { revokedRoot: string; epoch: number } {
    this.activeLeaves.delete(BigInt(agentId));
    this.revokedLeaves.add(BigInt(nullifier));
    this.activeEpoch++;
    this.revokedEpoch++;
    this.rebuildActive();
    this.rebuildRevoked();
    this.persistActiveRoot();
    this.persistRevokedRoot();
    return { revokedRoot: this.revokedRoot.toString(), epoch: this.revokedEpoch };
  }

  private persistActiveRoot(): void {
    runExecute(
      "INSERT INTO credential_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId, this.activeRoot.toString(), this.activeEpoch
    );
  }

  private persistRevokedRoot(): void {
    runExecute(
      "INSERT INTO revocation_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId, this.revokedRoot.toString(), this.revokedEpoch
    );
  }

  getActiveProof(agentId: number): { pathElements: string[]; pathIndices: number[] } | null {
    const result = buildMerkleTree(this.activeLeaves, TREE_DEPTH);
    let leafIndex = -1;
    let i = 0;
    for (const key of this.activeLeaves.keys()) {
      if (key === BigInt(agentId)) { leafIndex = i; break; }
      i++;
    }
    if (leafIndex === -1) return null;
    const proof = getMerkleProof(result.layers, leafIndex, TREE_DEPTH);
    return {
      pathElements: proof.pathElements.map((e) => e.toString()),
      pathIndices: proof.pathIndices,
    };
  }

  getStatus() {
    return {
      organizationId: this.organizationId,
      activeRoot: this.activeRoot.toString(),
      activeEpoch: this.activeEpoch,
      activeLeaves: this.activeLeaves.size,
      revokedRoot: this.revokedRoot.toString(),
      revokedEpoch: this.revokedEpoch,
      revokedLeaves: this.revokedLeaves.size,
    };
  }

  snapshot(): { active: string; revoked: string } {
    const activeResult = buildMerkleTree(this.activeLeaves, TREE_DEPTH);
    const revokedLeaves = new Map<bigint, bigint>();
    for (const n of this.revokedLeaves) revokedLeaves.set(n, BigInt(1));
    const revokedResult = buildMerkleTree(revokedLeaves, TREE_DEPTH);
    return {
      active: serializeTreeSnapshot(this.activeRoot, activeResult.layers, this.activeEpoch),
      revoked: serializeTreeSnapshot(this.revokedRoot, revokedResult.layers, this.revokedEpoch),
    };
  }

  restore(activeSnapshot: string, revokedSnapshot: string): void {
    const active = deserializeTreeSnapshot(activeSnapshot);
    const revoked = deserializeTreeSnapshot(revokedSnapshot);
    this.activeRoot = active.root;
    this.activeEpoch = active.epoch;
    this.revokedRoot = revoked.root;
    this.revokedEpoch = revoked.epoch;
  }

  verifyConsistency(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const result = buildMerkleTree(this.activeLeaves, TREE_DEPTH);
    if (this.activeRoot !== result.root) {
      errors.push(`Active root mismatch: stored=${this.activeRoot}, computed=${result.root}`);
    }
    return { valid: errors.length === 0, errors };
  }

  exportData(): string {
    return JSON.stringify({
      organizationId: this.organizationId,
      activeRoot: this.activeRoot.toString(),
      activeEpoch: this.activeEpoch,
      revokedRoot: this.revokedRoot.toString(),
      revokedEpoch: this.revokedEpoch,
      activeLeaves: Array.from(this.activeLeaves.entries()).map(([k, v]) => [k.toString(), v.toString()]),
      revokedLeaves: Array.from(this.revokedLeaves).map((n) => n.toString()),
      exportedAt: Date.now(),
    });
  }

  importData(data: string): void {
    const parsed = JSON.parse(data);
    this.activeLeaves.clear();
    for (const [k, v] of parsed.activeLeaves) {
      this.activeLeaves.set(BigInt(k), BigInt(v));
    }
    this.revokedLeaves.clear();
    for (const n of parsed.revokedLeaves) {
      this.revokedLeaves.add(BigInt(n));
    }
    this.activeEpoch = parsed.activeEpoch || 0;
    this.revokedEpoch = parsed.revokedEpoch || 0;
    this.rebuildActive();
    this.rebuildRevoked();
    this.persistActiveRoot();
    this.persistRevokedRoot();
  }
}

const treeCache = new Map<string, TreeEngine>();

export async function getTreeEngine(organizationId: string): Promise<TreeEngine> {
  if (treeCache.has(organizationId)) return treeCache.get(organizationId)!;
  const engine = new TreeEngine(organizationId);
  await engine.initialize();
  treeCache.set(organizationId, engine);
  return engine;
}
