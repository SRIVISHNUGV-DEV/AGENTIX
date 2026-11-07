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

  /**
   * Creates a tree engine for one organization; loads nothing yet.
   * Why: trees are per-org (roots are stored per organization_id), so the org must be fixed at construction — call initialize() before any other method.
   * @param organizationId The org whose credential_roots / revocation_roots rows this engine owns.
   * @returns An uninitialized TreeEngine; roots are ZERO_VALUE and leaves are empty until initialize().
   * @throws Nothing.
   * Maps to: internal — getTreeEngine (the cached factory that constructs and initializes it).
   */
  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  /**
   * Loads this org's state from the DB and rebuilds both trees.
   * Why: the engine is in-memory only — without this, roots would be zero and proofs would be built over an empty tree even when credentials exist.
   * @returns Nothing; after it resolves, activeRoot/revokedRoot reflect the stored epochs and leaves.
   * @throws Throws when Poseidon init or a DB read fails — the engine stays uninitialized and must not be used.
   * Maps to: circuit credential_V1 (the roots this rebuilds must match the circuit's trees).
   * Side effects: sets initialized=true, populates activeLeaves/revokedKeys from the credentials table, and rebuilds both roots.
   */
  async initialize(): Promise<void> {
    await initMerkleCrypto();
    await this.loadFromDb();
    this.initialized = true;
    // After init, rebuild both trees so roots reflect loaded data
    this.rebuildActive();
    await this.rebuildRevoked();
  }

  /**
   * Loads the latest stored roots and the credential rows behind them.
   * Why: the DB is the durable record — the in-memory maps are rebuilt from it on every start, so a restart never loses issued/revoked state.
   * @returns Nothing; sets activeEpoch/activeRoot, revokedEpoch/revokedRoot, activeLeaves (commitment as key and leaf; falls back to nullifier when commitment is empty) and revokedKeys (computed revocation key per revoked row, falling back to the raw nullifier when the key cannot be computed).
   * @throws Throws on DB failure; a per-row revocation-key failure is swallowed (that row falls back to its nullifier).
   * Maps to: internal — TreeEngine.initialize (the only caller).
   * Side effects: replaces the in-memory leaves/keys and roots with DB state.
   */
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

  /**
   * Recomputes the active Merkle root from the current leaves.
   * Why: every mutation (add/revoke) must re-derive the root or the stored root would go stale and proofs would fail verification.
   * @returns Nothing; sets activeRoot to the raw-leaf tree root at TREE_DEPTH.
   * @throws Nothing — no-op before initialize() completes.
   * Maps to: circuit credential_V1 (the active Merkle root the circuit checks).
   * Side effects: overwrites activeRoot; does not persist it (callers persist after mutating).
   */
  private rebuildActive(): void {
    if (!this.initialized) return;
    // CRITICAL: raw-leaf tree — circuit uses commitment directly as leaf
    const result = buildMerkleTreeRaw(this.activeLeaves, TREE_DEPTH);
    this.activeRoot = result.root;
  }

  /**
   * Rebuilds the revocation SMT from the current revoked keys.
   * Why: the SMT root is what the circuit's SMTVerifier checks, so it must be re-derived whenever the revoked set changes.
   * @returns Nothing; replaces `smt` and sets revokedRoot from the new SMT root.
   * @throws Throws when the SMT build fails (e.g. Poseidon not initialized) — the old root is left in place.
   * Maps to: circuit credential_V1 SMTVerifier (the revoked root it checks).
   * Side effects: replaces the in-memory SMT and overwrites revokedRoot; no-op before initialize() completes; does not persist the root.
   */
  private async rebuildRevoked(): Promise<void> {
    if (!this.initialized) return;
    this.smt = await buildRevokedSmtFromKeys(Array.from(this.revokedKeys));
    const F = this.smt.F;
    this.revokedRoot = BigInt(F.toString(this.smt.root));
  }

  /**
   * Adds a credential commitment to the active tree and persists the new root.
   * Why: issuance is only real once the commitment is in the tree — the ZK proof a holder later generates is verified against this root.
   * @param commitment The credential commitment, used directly as both key and leaf value (raw-leaf tree); two commitments colliding at the same index (commitment mod 2^20) overwrite each other.
   * @returns `{ activeRoot, epoch }` — the new root as a decimal string and the incremented active epoch.
   * @throws Throws on DB persist failure — the leaf is already in memory, so a failed persist leaves memory ahead of the DB; verifyConsistency exposes the drift.
   * Maps to: circuit credential_V1 (the active root the issuance proof is checked against) and event CredentialIssued.
   * Side effects: inserts into activeLeaves, increments activeEpoch, rebuilds the active root, and inserts a credential_roots row.
   */
  addCredential(commitment: bigint): { activeRoot: string; epoch: number } {
    // commitment is used directly as both key and leaf value (raw tree)
    this.activeLeaves.set(commitment, commitment);
    this.activeEpoch++;
    this.rebuildActive();
    this.persistActiveRoot();
    return { activeRoot: this.activeRoot.toString(), epoch: this.activeEpoch };
  }

  /**
   * Removes a commitment from the active tree, adds its revocation key to the revoked SMT, and persists both new roots.
   * Why: revocation must be visible to both trees at once — the credential stops proving membership and starts failing the non-membership check.
   * @param commitment The commitment to remove from the active tree; removing an absent commitment is a no-op for that tree but still bumps both epochs and re-adds the key.
   * @param revocationKey The key to insert into the revoked SMT.
   * @returns `{ revokedRoot, epoch }` — the new revoked root as a decimal string and the incremented revoked epoch.
   * @throws Throws on SMT rebuild or DB persist failure — partial state (one root persisted, the other not) is possible; verifyConsistency exposes it.
   * Maps to: circuit credential_V1 SMTVerifier (the revoked root) and event CredentialRevoked.
   * Side effects: deletes from activeLeaves, adds to revokedKeys, increments both epochs, rebuilds both trees, and inserts credential_roots and revocation_roots rows.
   */
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

  /**
   * Inserts the current active root and epoch into credential_roots.
   * Why: the root must survive restarts — loadFromDb restores the latest row on the next initialize().
   * @returns Nothing.
   * @throws Throws on DB failure.
   * Maps to: internal — TreeEngine.addCredential / revokeCredential (the mutations that persist after changing the root).
   * Side effects: one INSERT into credential_roots (append-only; old epochs are kept as history).
   */
  private persistActiveRoot(): void {
    runExecute(
      "INSERT INTO credential_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId, this.activeRoot.toString(), this.activeEpoch
    );
  }

  /**
   * Inserts the current revoked root and epoch into revocation_roots.
   * Why: the revoked root must survive restarts — loadFromDb restores the latest row on the next initialize().
   * @returns Nothing.
   * @throws Throws on DB failure.
   * Maps to: internal — TreeEngine.revokeCredential (the mutation that persists after changing the root).
   * Side effects: one INSERT into revocation_roots (append-only; old epochs are kept as history).
   */
  private persistRevokedRoot(): void {
    runExecute(
      "INSERT INTO revocation_roots (organization_id, root, epoch) VALUES (?, ?, ?)",
      this.organizationId, this.revokedRoot.toString(), this.revokedEpoch
    );
  }

  /**
   * Returns the circuit-compatible Merkle proof that a commitment is in the active tree.
   * Why: the ZK prover needs pathElements + pathIndices in the exact shape of the circuit's MerkleProof template — this is the only way to produce them.
   * @param commitment The commitment to prove; its leaf index is commitment mod 2^TREE_DEPTH, matching how buildMerkleTreeRaw places it.
   * @returns `{ pathElements, pathIndices, root }` (all pathElements and root as decimal strings), or null when the commitment is not in the active tree.
   * @throws Nothing — returns null for an unknown commitment instead of throwing.
   * Maps to: circuit credential_V1 MerkleProof template (pathElements + pathIndices).
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
   * Returns the SMT non-membership proof that a revocation key is NOT revoked.
   * Why: the ZK prover must show the credential is absent from the revoked tree — the circuit's SMTVerifier checks exactly these siblings/oldKey/oldValue/isOld0 fields.
   * @param revocationKey The key to prove non-membership for.
   * @returns The SmtNonMembershipProof, or null when the key IS revoked (a revoked credential has no non-membership proof by definition).
   * @throws Throws when the SMT cannot be built or the proof computation fails.
   * Maps to: circuit credential_V1 SMTVerifier (siblings, oldKey, oldValue, isOld0).
   * Side effects: rebuilds the revoked SMT first when it was never built.
   */
  async getRevokedProof(revocationKey: bigint): Promise<SmtNonMembershipProof | null> {
    if (!this.smt) await this.rebuildRevoked();
    if (this.revokedKeys.has(revocationKey)) return null; // revoked — no non-membership proof
    return smtNonMembershipProof(this.smt, revocationKey, TREE_DEPTH);
  }

  /**
   * Returns a plain snapshot of this engine's roots, epochs and leaf counts.
   * Why: diagnostics and health endpoints need the tree state without exposing the internal maps.
   * @returns `{ organizationId, activeRoot, activeEpoch, activeLeaves, revokedRoot, revokedEpoch, revokedLeaves }` with roots as decimal strings and counts as numbers.
   * @throws Nothing.
   * Maps to: MCP tool agentix_diagnostics (the tree status it reports).
   */
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

  /**
   * Serializes both trees into two snapshot strings.
   * Why: backup/export needs a portable form of the trees that restore() can read back — the active half is the serialized layer snapshot, the revoked half is root + epoch + keys + timestamp as JSON.
   * @returns `{ active, revoked }` snapshot strings.
   * @throws Throws on serialization failure.
   * Maps to: internal — TreeEngine.restore (the matching deserializer) and BackupEngine (the snapshot path).
   */
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

  /**
   * Restores roots and epochs from snapshot strings produced by snapshot().
   * Why: lets an operator bring an engine back to a snapshotted state without re-issuing every credential.
   * @param activeSnapshot The active-tree snapshot string from snapshot().
   * @param revokedSnapshot The revoked-tree JSON snapshot string from snapshot().
   * @returns Nothing.
   * @throws Throws when either snapshot is malformed JSON (or the active snapshot fails to deserialize).
   * Maps to: internal — TreeEngine.snapshot (the matching serializer).
   * Side effects: overwrites activeRoot/activeEpoch and revokedRoot/revokedEpoch — but NOT activeLeaves, revokedKeys or the SMT, so getActiveProof/verifyConsistency will disagree with the restored roots until the engine is re-initialized from the DB; treat restore as root-only, not a full state restore.
   */
  restore(activeSnapshot: string, revokedSnapshot: string): void {
    const active = deserializeTreeSnapshot(activeSnapshot);
    const revoked = JSON.parse(revokedSnapshot);
    this.activeRoot = active.root;
    this.activeEpoch = active.epoch;
    this.revokedRoot = BigInt(revoked.root);
    this.revokedEpoch = revoked.epoch;
  }

  /**
   * Recomputes both roots from the in-memory state and compares them to the stored roots.
   * Why: the corruption detector — a mismatch means the DB rows and the live trees diverged (failed persist, bad restore, or manual tampering) and must be investigated before proofs are issued.
   * @returns `{ valid, errors }` — valid:true with an empty errors list when both roots match; otherwise one human-readable mismatch message per divergent tree.
   * @throws Nothing — mismatches are reported as errors, not thrown.
   * Maps to: event TreeCorruptionDetected (the signal a caller should emit when valid is false).
   */
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

  /**
   * Serializes the engine's full in-memory state (roots, epochs, leaves, revoked keys) to JSON.
   * Why: export/import needs the leaves themselves, not just roots — unlike snapshot(), this round-trips the state that rebuilds the trees.
   * @returns JSON string with organizationId, both roots/epochs, activeLeaves as [key, value] string pairs, revokedKeys, and exportedAt.
   * @throws Throws on serialization failure.
   * Maps to: internal — TreeEngine.importData (the matching importer).
   */
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

  /**
   * Replaces the engine's state from an exportData() JSON string and persists the rebuilt roots.
   * Why: the import half of export — a migrated or restored instance rebuilds its trees from the exported leaves instead of the DB.
   * @param data JSON string as produced by exportData(); it must contain activeLeaves and revokedKeys arrays — a missing array throws on iteration, so callers must pass a complete export.
   * @returns Nothing; on success the leaves/keys are replaced, both roots are rebuilt, and both roots are persisted.
   * @throws Throws on malformed JSON, missing leaf/key arrays, or DB persist failure — a mid-import failure can leave the in-memory state replaced but the roots unpersisted.
   * Maps to: internal — TreeEngine.exportData (the matching exporter).
   * Side effects: clears and repopulates activeLeaves/revokedKeys, rebuilds both trees, and inserts credential_roots and revocation_roots rows.
   */
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

/**
 * Returns the cached TreeEngine for an org, creating and initializing it on first use.
 * Why: roots and leaf maps are per-org mutable state — two engines for the same org would diverge (one's addCredential invisible to the other), so all callers must share one.
 * @param organizationId The org whose engine to return; a new engine is built and initialized on a cache miss.
 * @returns The shared, initialized TreeEngine for the org.
 * @throws Throws when initialization fails (Poseidon init or DB read) — nothing is cached on failure, so a retry creates a fresh engine.
 * Maps to: internal — TreeEngine.addCredential / getActiveProof / getRevokedProof (the per-org operations behind this cache).
 * Side effects: on a miss, constructs a TreeEngine, awaits initialize(), and caches it; the cache is never evicted.
 */
export async function getTreeEngine(organizationId: string): Promise<TreeEngine> {
  if (treeCache.has(organizationId)) return treeCache.get(organizationId)!;
  const engine = new TreeEngine(organizationId);
  await engine.initialize();
  treeCache.set(organizationId, engine);
  return engine;
}
