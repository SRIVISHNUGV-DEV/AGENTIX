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

  /**
   * Creates an uninitialized revoked tree for one organization.
   * Call initialize() before any other method — the SMT is built from the DB there.
   * @param organizationId - The org this tree belongs to; trees are per-org and never shared.
   * Maps to: internal — getRevokedTree (cached singleton per org).
   */
  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  /**
   * Loads the revoked set from the local DB and rebuilds the SMT (see loadFromDb).
   * Must run before addRevocationKey/getNonMembershipProof/etc.; the SMT is null until it does.
   * @throws When the Poseidon crypto backend fails to initialize.
   * Maps to: internal — getRevokedTree.
   * Side effects: reads credential and root rows from the DB; builds the circomlibjs SMT.
   */
  async initialize(): Promise<void> {
    await initMerkleCrypto();
    this.initialized = true;
    await this.loadFromDb();
  }

  /**
   * Loads the stored epoch/root and every revoked credential's revocation key, then rebuilds the SMT.
   * The revocation key is Poseidon2(secret, 0) mod 2^64; legacy rows without a usable secret fall back to the nullifier (which will not match circuit proofs for those credentials).
   * Maps to: circuit credential_V1.circom (SMTVerifier, keyed by revocationKey); internal — RevokedTree.initialize.
   * Side effects: DB reads; builds the SMT; a bad secret per row is swallowed into the nullifier fallback.
   */
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
   * Rebuilds the SMT from the current set of revoked keys.
   * This re-creates the circomlibjs SMT and re-inserts all keys.
   * No-op before initialize(); otherwise the root is recomputed from the full key set.
   * Maps to: internal — RevokedTree.initialize, loadFromDb, and importTree.
   * Side effects: replaces the in-memory SMT and root.
   */
  async rebuild(): Promise<void> {
    if (!this.initialized) return;
    this.smt = await buildRevokedSmtFromKeys(Array.from(this.revokedKeys));
    const F = this.smt.F;
    this.root = BigInt(F.toString(this.smt.root));
    logger.info("revoked-tree", `Rebuilt SMT for org ${this.organizationId}: root=${this.root.toString().slice(0, 20)}... revokedKeys=${this.revokedKeys.size}`);
  }

  /**
   * Adds a revoked key (revocation key) to the SMT.
   * key should be computeRevocationKey(secret) = Poseidon2(secret, 0) mod 2^64.
   * Adding an already-present key is a no-op for the SMT insert but still bumps the epoch and persists — callers must not assume a duplicate add is free.
   * @returns The new root and the bumped epoch.
   * Maps to: circuit credential_V1.circom (SMTVerifier); MCP tool agentix_cred_verify flows.
   * Side effects: inserts into the SMT, bumps the epoch, persists the root row and a snapshot.
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
   * Legacy alias: addNullifier — but the circuit keys the SMT by revocationKey (Poseidon2(secret,0) mod 2^64), not the nullifier. Prefer addRevocationKey() for new code.
   * Despite the name, the argument must be a revocation key, not a nullifier — passing a raw nullifier inserts the wrong key and the circuit will not see the credential as revoked.
   * @returns The new root and the bumped epoch (from addRevocationKey).
   * Maps to: internal — RevokedTree.addRevocationKey.
   * Side effects: same as addRevocationKey (SMT insert, epoch bump, root + snapshot persist).
   */
  async addNullifier(revocationKey: bigint): Promise<{ root: bigint; epoch: number }> {
    return this.addRevocationKey(revocationKey);
  }

  /**
   * Appends the current revoked root and epoch to the revocation_roots table.
   * Roots are append-only history — nothing here deletes or overwrites an older root row.
   * Maps to: internal — RevokedTree.addRevocationKey and importTree.
   * Side effects: DB INSERT.
   */
  private persistRoot(): void {
    runExecute(
      "INSERT INTO revocation_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId,
      this.root.toString(),
      this.epoch
    );
  }

  /**
   * Persists the full SMT state (revoked keys + root) to merkle_snapshots.
   * This allows tree reconstruction without re-reading all revoked credentials.
   * Maps to: internal — RevokedTree.addRevocationKey.
   * Side effects: DB INSERT into merkle_snapshots (tree_type 'revoked').
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
   * Produces a non-membership proof for a revocation key.
   * This is exactly what the circuit's SMTVerifier consumes: siblings[depth], oldKey, oldValue, isOld0.
   * @returns The proof, or null when the key IS revoked (no non-membership proof exists for a present key).
   * Maps to: circuit credential_V1.circom (SMTVerifier); MCP tool agentix_cred_verify flows.
   * Side effects: rebuilds the SMT first when it has not been built yet.
   */
  async getNonMembershipProof(revocationKey: bigint): Promise<SmtNonMembershipProof | null> {
    if (!this.smt) await this.rebuild();
    if (this.revokedKeys.has(revocationKey)) {
      // Key IS revoked — cannot produce a non-membership proof
      return null;
    }
    return smtNonMembershipProof(this.smt, revocationKey, TREE_DEPTH);
  }

  /**
   * Reports whether a revocation key is in the revoked set.
   * @returns True when revoked, false otherwise.
   * Maps to: internal — callers gating proof generation on revocation status.
   */
  isRevoked(revocationKey: bigint): boolean {
    return this.revokedKeys.has(revocationKey);
  }

  /**
   * Returns the current revoked SMT root as a decimal string.
   * This is the value that must match the on-chain anchored revoked root.
   * @returns The root, decimal-stringified.
   * Maps to: contract OrganizationCredentialAnchor.revokedRoot; MCP tool agentix_tree_status.
   */
  getRoot(): string {
    return this.root.toString();
  }

  /**
   * Returns the tree's epoch (incremented on every revocation add).
   * @returns The current epoch, 0 before any mutation.
   * Maps to: internal — RevokedTree snapshot/restore and anchor epoch tracking.
   */
  getEpoch(): number {
    return this.epoch;
  }

  /**
   * Returns the number of revoked keys currently tracked.
   * @returns The revoked-key count.
   * Maps to: internal — RevokedTree status reporting.
   */
  getRevokedCount(): number {
    return this.revokedKeys.size;
  }

  /**
   * Serializes the full revoked state (root, epoch, all revoked keys) to JSON.
   * @returns The JSON snapshot string.
   * Maps to: internal — RevokedTree.persistSnapshot and exportTree.
   */
  snapshot(): string {
    return JSON.stringify({
      root: this.root.toString(),
      epoch: this.epoch,
      revokedKeys: Array.from(this.revokedKeys).map((k) => k.toString()),
      timestamp: Date.now(),
    });
  }

  /**
   * Restores root and epoch from a snapshot — but NOT the revoked keys.
   * The key set is left as-is (only root/epoch are overwritten), so restore() alone does not rebuild a usable SMT; importTree() is the full path (it reloads keys and rebuilds). Do not use restore() expecting a working tree.
   * @param snapshotData - JSON from snapshot(); malformed JSON throws.
   * @throws On malformed JSON or non-bigint root values.
   * Maps to: internal — RevokedTree snapshot handling (partial; see importTree).
   * Side effects: overwrites root and epoch in memory.
   */
  restore(snapshotData: string): void {
    const snapshot = JSON.parse(snapshotData);
    this.root = BigInt(snapshot.root);
    this.epoch = snapshot.epoch;
    logger.info("revoked-tree", `Restored SMT snapshot for org ${this.organizationId}: epoch=${this.epoch}`);
  }

  /**
   * Exports the revoked tree (org, root, epoch, all revoked keys) as JSON.
   * Unlike snapshot(), the export carries the key set, so importTree() can rebuild the SMT from it.
   * @returns The JSON export string.
   * Maps to: internal — RevokedTree.importTree; CLI 'agentix tree' export.
   */
  async exportTree(): Promise<string> {
    return JSON.stringify({
      organizationId: this.organizationId,
      root: this.root.toString(),
      epoch: this.epoch,
      revokedKeys: Array.from(this.revokedKeys).map((n) => n.toString()),
      exportedAt: Date.now(),
    });
  }

  /**
   * Replaces the revoked key set from an export, rebuilds the SMT, and persists the new root.
   * @param data - JSON from exportTree(); malformed JSON or non-bigint keys throw (after the key set was already cleared — a failed import can leave the tree empty).
   * @throws On malformed JSON or invalid key values.
   * Maps to: internal — RevokedTree.exportTree; CLI 'agentix tree' import.
   * Side effects: replaces the in-memory key set, rebuilds the SMT, persists a root row.
   */
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

  /**
   * Checks the stored root against the live SMT's root.
   * Returns valid when there is no SMT built yet (nothing to compare) — that is "unverified", not "verified".
   * @returns { valid, errors } — valid is false with a root-mismatch message when the two disagree.
   * Maps to: internal — tree health checks.
   */
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

/**
 * Returns the cached RevokedTree for an org, creating and initializing it on first use.
 * The cache is process-global: every caller shares the same instance, so mutations are visible to all of them.
 * @returns The initialized RevokedTree for the org.
 * @throws When Poseidon initialization or the DB load fails.
 * Maps to: internal — credential revocation and proof flows that need the revoked tree.
 * Side effects: first call constructs the tree, reads the DB, and builds the SMT; later calls return the cached instance.
 */
export async function getRevokedTree(organizationId: string): Promise<RevokedTree> {
  if (treeCache.has(organizationId)) return treeCache.get(organizationId)!;
  const tree = new RevokedTree(organizationId);
  await tree.initialize();
  treeCache.set(organizationId, tree);
  return tree;
}
