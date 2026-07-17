import {
  buildMerkleTreeRaw,
  getMerkleProof,
  getRawMerkleProof,
  hashPair,
  initMerkleCrypto,
  serializeTreeSnapshot,
  deserializeTreeSnapshot,
  buildRevokedSmt,
  buildRevokedSmtFromKeys,
  smtNonMembershipProof,
  type SmtNonMembershipProof,
} from "./merkle";
import { runExecute, runSingle, runQuery } from "../database";
import { TREE_DEPTH, ZERO_VALUE } from "../../shared/constants";
import { computeRevocationKey } from "../../../src/core/zk-prover";

/**
 * TreeEngine — circuit-compatible credential tree manager.
 *
 * Circuit: credential_V1.circom (depth=20)
 *   - Active tree:  raw-leaf Poseidon Merkle tree (leaf = commitment, no re-hash)
 *   - Revoked tree: circomlibjs SMT (Poseidon hash0/hash1) for SMTVerifier
 *
 * The active tree uses buildMerkleTreeRaw() because the circuit does:
 *   activeMerkle.leaf <== commitment
 * (the commitment is the leaf directly — applying hashLeaf would double-hash
 * and produce a root that never matches the circuit's).
 *
 * The revoked tree uses circomlibjs's reference SMT (newMemEmptyTrie) so
 * roots and non-membership proofs are bit-compatible with SMTVerifier.
 */
export class TreeEngine {
  private organizationId: string;
  private activeLeaves: Map<bigint, bigint> = new Map();  // key=commitment, value=commitment
  private revokedKeys: Set<bigint> = new Set();           // revocation keys
  private activeEpoch = 0;
  private revokedEpoch = 0;
  private activeRoot = ZERO_VALUE;
  private revokedRoot = ZERO_VALUE;
  private smt: any = null; // circomlibjs SMT (async-initialized)
  private initialized = false;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  async initialize(): Promise<void> {
    await initMerkleCrypto();
    await this.loadFromDb();
    this.initialized = true;
    // After init, rebuild both trees so roots reflect loaded data
    this.rebuildActive();
    await this.rebuildRevoked();
  }

  private async loadFromDb(): Promise<void> {
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

    // Load active credentials — leaf = commitment (circuit-compatible)
    const creds = runQuery<{ agent_id: number; commitment: string; nullifier: string }>(
      "SELECT agent_id, commitment, nullifier FROM credentials WHERE organization_id = ? AND revoked = 0",
      this.organizationId
    );
    for (const c of creds) {
      const commitment = c.commitment ? BigInt(c.commitment) : BigInt(c.nullifier);
      this.activeLeaves.set(commitment, commitment);
    }

    // Load revoked credentials — key = revocationKey
    const revoked = runQuery<{ nullifier: string; secret: string }>(
      "SELECT nullifier, secret FROM credentials WHERE organization_id = ? AND revoked = 1",
      this.organizationId
    );
    for (const r of revoked) {
      try {
        const secretBigInt = r.secret ? BigInt("0x" + r.secret) : BigInt(r.nullifier);
        const revocationKey = await computeRevocationKey(secretBigInt);
        this.revokedKeys.add(revocationKey);
      } catch {
        this.revokedKeys.add(BigInt(r.nullifier));
      }
    }
  }

  private rebuildActive(): void {
    if (!this.initialized) return;
    // CRITICAL: raw-leaf tree — circuit uses commitment directly as leaf
    const result = buildMerkleTreeRaw(this.activeLeaves, TREE_DEPTH);
    this.activeRoot = result.root;
  }

  private async rebuildRevoked(): Promise<void> {
    if (!this.initialized) return;
    this.smt = await buildRevokedSmtFromKeys(Array.from(this.revokedKeys));
    const F = this.smt.F;
    this.revokedRoot = BigInt(F.toString(this.smt.root));
  }

  addCredential(commitment: bigint): { activeRoot: string; epoch: number } {
    // commitment is used directly as both key and leaf value (raw tree)
    this.activeLeaves.set(commitment, commitment);
    this.activeEpoch++;
    this.rebuildActive();
    this.persistActiveRoot();
    return { activeRoot: this.activeRoot.toString(), epoch: this.activeEpoch };
  }

  async revokeCredential(commitment: bigint, revocationKey: bigint): Promise<{ revokedRoot: string; epoch: number }> {
    this.activeLeaves.delete(commitment);
    this.revokedKeys.add(revocationKey);
    this.activeEpoch++;
    this.revokedEpoch++;
    this.rebuildActive();
    await this.rebuildRevoked();
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

  /**
   * Get the circuit-compatible Merkle proof for a commitment.
   * Returns pathElements + pathIndices matching the circuit's MerkleProof template.
   */
  getActiveProof(commitment: bigint): { pathElements: string[]; pathIndices: number[]; root: string } | null {
    if (!this.activeLeaves.has(commitment)) return null;
    const result = buildMerkleTreeRaw(this.activeLeaves, TREE_DEPTH);
    const size = 2 ** TREE_DEPTH;
    const leafIndex = Number(commitment % BigInt(size));
    const proof = getRawMerkleProof(result.layers, leafIndex, TREE_DEPTH);
    return {
      pathElements: proof.pathElements.map((e: bigint) => e.toString()),
      pathIndices: proof.pathIndices,
      root: this.activeRoot.toString(),
    };
  }

  /**
   * Get the SMT non-membership proof for a revocation key.
   * Returns siblings, oldKey, oldValue, isOld0 matching the circuit's SMTVerifier.
   */
  async getRevokedProof(revocationKey: bigint): Promise<SmtNonMembershipProof | null> {
    if (!this.smt) await this.rebuildRevoked();
    if (this.revokedKeys.has(revocationKey)) return null; // revoked — no non-membership proof
    return smtNonMembershipProof(this.smt, revocationKey, TREE_DEPTH);
  }

  getStatus() {
    return {
      organizationId: this.organizationId,
      activeRoot: this.activeRoot.toString(),
      activeEpoch: this.activeEpoch,
      activeLeaves: this.activeLeaves.size,
      revokedRoot: this.revokedRoot.toString(),
      revokedEpoch: this.revokedEpoch,
      revokedLeaves: this.revokedKeys.size,
    };
  }

  snapshot(): { active: string; revoked: string } {
    const activeResult = buildMerkleTreeRaw(this.activeLeaves, TREE_DEPTH);
    return {
      active: serializeTreeSnapshot(this.activeRoot, activeResult.layers, this.activeEpoch),
      revoked: JSON.stringify({
        root: this.revokedRoot.toString(),
        epoch: this.revokedEpoch,
        revokedKeys: Array.from(this.revokedKeys).map((k) => k.toString()),
        timestamp: Date.now(),
      }),
    };
  }

  restore(activeSnapshot: string, revokedSnapshot: string): void {
    const active = deserializeTreeSnapshot(activeSnapshot);
    const revoked = JSON.parse(revokedSnapshot);
    this.activeRoot = active.root;
    this.activeEpoch = active.epoch;
    this.revokedRoot = BigInt(revoked.root);
    this.revokedEpoch = revoked.epoch;
  }

  verifyConsistency(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const result = buildMerkleTreeRaw(this.activeLeaves, TREE_DEPTH);
    if (this.activeRoot !== result.root) {
      errors.push(`Active root mismatch: stored=${this.activeRoot}, computed=${result.root}`);
    }
    if (this.smt) {
      const F = this.smt.F;
      const computedRevokedRoot = BigInt(F.toString(this.smt.root));
      if (this.revokedRoot !== computedRevokedRoot) {
        errors.push(`Revoked root mismatch: stored=${this.revokedRoot}, computed=${computedRevokedRoot}`);
      }
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
      revokedKeys: Array.from(this.revokedKeys).map((n) => n.toString()),
      exportedAt: Date.now(),
    });
  }

  async importData(data: string): Promise<void> {
    const parsed = JSON.parse(data);
    this.activeLeaves.clear();
    for (const [k, v] of parsed.activeLeaves) {
      const bv = BigInt(v);
      this.activeLeaves.set(bv, bv);
    }
    this.revokedKeys.clear();
    for (const n of parsed.revokedKeys) {
      this.revokedKeys.add(BigInt(n));
    }
    this.activeEpoch = parsed.activeEpoch || 0;
    this.revokedEpoch = parsed.revokedEpoch || 0;
    this.rebuildActive();
    await this.rebuildRevoked();
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
