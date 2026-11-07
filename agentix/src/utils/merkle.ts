const TREE_DEPTH = 20;
const ZERO_VALUE = BigInt(0);

let _poseidon: any = null;
let _zeroHashes: bigint[] | null = null;

/**
 * Returns the lazily-initialized circomlibjs Poseidon instance, building it on first use.
 * The dynamic import keeps the heavy WASM-ish dependency out of the module load path.
 * @returns The Poseidon object (cached after the first call).
 * @throws When circomlibjs fails to load or build.
 * Maps to: internal — poseidonHash (every tree hash in this module).
 * Side effects: first call loads circomlibjs and caches the instance.
 */
async function getPoseidon() {
  if (!_poseidon) {
    const p = await import("circomlibjs");
    _poseidon = await p.buildPoseidon();
  }
  return _poseidon;
}

/**
 * Hashes inputs with Poseidon (circomlibjs), returning the field element as a bigint.
 * The inputs are passed as ONE array argument — spreading them would mis-bind inputs[1] as initState and produce a hash that does NOT match the circuit's Poseidon (verified against canonical vectors).
 * @param inputs - Field elements to hash; empty input is a caller bug (the circuit never hashes zero inputs).
 * @returns The Poseidon digest as a bigint.
 * @throws When Poseidon was never initialized (call initMerkleCrypto first).
 * Maps to: circuit credential_V1.circom (Poseidon hashes); internal — hashPair and hashLeaf.
 */
function poseidonHash(inputs: bigint[]): bigint {
  const p = _poseidon;
  const converted = inputs.map((x) => p.F.e(x.toString()));
  // circomlibjs poseidon expects the inputs as a SINGLE array argument.
  // Signature is poseidon(inputs, initState, nOut) — spreading the array
  // (p(...converted)) mis-binds inputs[1] as initState, producing a hash that
  // does NOT match the circuit's Poseidon (verified against canonical vectors:
  // Poseidon([1,2]) = 7853200120776062878684798364095072458815029376092732009249414926327459813530).
  const hash = p.F.toString(p(converted));
  return BigInt(hash);
}

/**
 * Initializes the Poseidon backend used by every hash in this module.
 * Call once before any tree operation; repeated calls are cheap (the instance is cached).
 * @throws When circomlibjs fails to load or build.
 * Maps to: internal — ActiveTree.initialize, RevokedTree.initialize, and proof generation.
 * Side effects: loads circomlibjs on first call.
 */
export async function initMerkleCrypto() {
  await getPoseidon();
}

/**
 * Hashes an ordered pair of tree nodes with Poseidon.
 * Order matters: hashPair(a, b) != hashPair(b, a) — every caller must preserve left/right placement or roots will not match the circuit.
 * @returns Poseidon([left, right]) as a bigint.
 * Maps to: circuit credential_V1.circom (MerkleProof template); internal — every tree builder in this module.
 */
export function hashPair(left: bigint, right: bigint): bigint {
  return poseidonHash([left, right]);
}

/**
 * Hashes a (key, value) pair into a leaf for keyed Merkle trees.
 * Only the legacy keyed trees use this — the active credential tree inserts the commitment directly (NO hashLeaf step) because the circuit takes the commitment as the leaf.
 * @returns Poseidon([key, value]) as a bigint.
 * Maps to: circuit credential_V1.circom (legacy keyed trees only); internal — buildMerkleTreeImpl (rawLeaf=false) and buildRevokedTree.
 */
export function hashLeaf(key: bigint, value: bigint): bigint {
  return poseidonHash([key, value]);
}

/**
 * Builds the zero-hash chain: zeros[0] = 0, zeros[i+1] = hashPair(zeros[i], zeros[i]).
 * Empty subtrees collapse to these values, which is how sparse trees stay cheap.
 * @param depth - Tree depth; the result has depth+1 entries (levels 0..depth).
 * @returns The zero-hash array (cached when the depth matches the cached one).
 * Maps to: internal — every tree builder and proof function in this module.
 * Side effects: caches the chain for reuse; a different depth rebuilds it.
 */
export function buildZeroHashes(depth: number = TREE_DEPTH): bigint[] {
  if (_zeroHashes && _zeroHashes.length === depth + 1) return _zeroHashes;
  const zeros: bigint[] = [ZERO_VALUE];
  for (let i = 1; i <= depth; i++) {
    zeros[i] = hashPair(zeros[i - 1], zeros[i - 1]);
  }
  _zeroHashes = zeros;
  return zeros;
}

/**
 * Builds a keyed Merkle tree: each leaf is hashLeaf(key, value), placed at index key % 2^depth.
 * LEGACY: the keyed placement silently overwrites colliding leaves (birthday-bound ~50% at ~1,200 leaves) and allocates a full 2^depth array. Prefer IncrementalMerkleTree for the active tree; this remains for the old keyed-tree callers.
 * @param leaves - Map of key -> value; @param depth - Tree depth (default 20).
 * @returns { root, layers, zeroHashes } — the full layer arrays (2^depth leaves at level 0).
 * Maps to: internal — legacy keyed-tree callers (no live caller in src/ or packages/ besides this module).
 */
export function buildMerkleTree(
  leaves: Map<bigint, bigint>,
  depth: number = TREE_DEPTH
): { root: bigint; layers: bigint[][]; zeroHashes: bigint[] } {
  return buildMerkleTreeImpl(leaves, depth, false);
}

/**
 * Builds a raw-leaf Merkle tree: the leaf value is inserted directly WITHOUT hashing (no hashLeaf step). The credential_V1 circuit uses the commitment itself as the leaf (activeMerkle.leaf <== commitment), so the active tree MUST be built this way or the computed root will not match the circuit's.
 * Key = positional index = Number(commitment % 2^depth).
 * @param leaves - Map of key -> value; @param depth - Tree depth (default 20).
 * @returns { root, layers, zeroHashes } — the full layer arrays (2^depth leaves at level 0).
 * Maps to: circuit credential_V1.circom (activeMerkle leaf = commitment); internal — packages/core/tree-engine.
 */
export function buildMerkleTreeRaw(
  leaves: Map<bigint, bigint>,
  depth: number = TREE_DEPTH
): { root: bigint; layers: bigint[][]; zeroHashes: bigint[] } {
  return buildMerkleTreeImpl(leaves, depth, true);
}

/**
 * Generates a Merkle proof for a leaf, returning siblings + indices in the exact format the credential_V1 circuit's MerkleProof template expects: pathIndices[i] = 0 means sibling is on the RIGHT (current is left child); pathIndices[i] = 1 means sibling is on the LEFT (current is right child).
 * @param layers - Layers from buildMerkleTreeRaw; @param leafIndex - Dense index of the leaf; @param depth - Tree depth (default 20).
 * @returns { pathElements, pathIndices, root }.
 * Maps to: circuit credential_V1.circom (MerkleProof template); internal — packages/core/tree-engine.
 */
export function getRawMerkleProof(
  layers: bigint[][],
  leafIndex: number,
  depth: number = TREE_DEPTH
): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
  return {
    pathElements: getMerkleProof(layers, leafIndex, depth).pathElements,
    pathIndices: getMerkleProof(layers, leafIndex, depth).pathIndices,
    root: layers[depth][0],
  };
}

/**
 * Shared builder behind buildMerkleTree and buildMerkleTreeRaw (rawLeaf selects the leaf treatment).
 * Allocates a full 2^depth leaf array and rehashes from scratch — O(2^depth) per build, which is why the incremental tree replaced it for live use.
 * @param rawLeaf - True inserts values directly, false applies hashLeaf(key, value) first.
 * @returns { root, layers, zeroHashes }.
 * Maps to: internal — buildMerkleTree and buildMerkleTreeRaw.
 */
function buildMerkleTreeImpl(
  leaves: Map<bigint, bigint>,
  depth: number,
  rawLeaf: boolean
): { root: bigint; layers: bigint[][]; zeroHashes: bigint[] } {
  const zeros = buildZeroHashes(depth);
  const size = 2 ** depth;
  const leavesArray: bigint[] = new Array(size).fill(ZERO_VALUE);

  for (const [key, value] of leaves) {
    const idx = Number(key % BigInt(size));
    leavesArray[idx] = rawLeaf ? value : hashLeaf(key, value);
  }

  const layers: bigint[][] = [leavesArray];

  for (let level = 0; level < depth; level++) {
    const prev = layers[level];
    const half = prev.length / 2;
    const curr: bigint[] = new Array(half);
    // Children live at `level`; their zero-hash is zeros[level].
    // The parent (this level) zero-hash is zeros[level+1].
    // (zeros[0]=0 is the empty leaf; zeros[i+1]=hashPair(zeros[i],zeros[i]).)
    const childZero = zeros[level];
    for (let i = 0; i < half; i++) {
      const left = prev[i * 2];
      const right = prev[i * 2 + 1];
      if (left === childZero && right === childZero) {
        curr[i] = zeros[level + 1];
      } else if (left === childZero) {
        curr[i] = hashPair(childZero, right);
      } else if (right === childZero) {
        curr[i] = hashPair(left, childZero);
      } else {
        curr[i] = hashPair(left, right);
      }
    }
    layers.push(curr);
  }

  return { root: layers[depth][0], layers, zeroHashes: zeros };
}

/**
 * Derives a proof (siblings + indices) for a leaf from prebuilt layers.
 * A missing sibling slot falls back to the zero hash for the level — that should not happen for layers built by buildMerkleTreeImpl, which fills every slot.
 * @param layers - Layers from a tree builder; @param leafIndex - Index of the leaf; @param depth - Tree depth (default 20).
 * @returns { pathElements, pathIndices } (no root — read it from layers[depth][0]).
 * Maps to: circuit credential_V1.circom (MerkleProof template); internal — getRawMerkleProof and packages/core/tree-engine.
 */
export function getMerkleProof(
  layers: bigint[][],
  leafIndex: number,
  depth: number = TREE_DEPTH
): { pathElements: bigint[]; pathIndices: number[] } {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let idx = leafIndex;

  for (let level = 0; level < depth; level++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    // Use the stored value; if the slot was never written (shouldn't happen
    // since buildMerkleTreeImpl fills all slots), fall back to the zero hash
    // for this level (zeros[depth-level], matching the tree builder's convention).
    const sibling = layers[level][siblingIdx];
    pathElements.push(sibling !== undefined ? sibling : ZERO_VALUE);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }

  return { pathElements, pathIndices };
}

/**
 * Verifies a Merkle proof by recomputing the root from the leaf and the sibling path.
 * NOTE: this is the legacy binary-tree verifier (hashPair ordering) — it does NOT verify SMT proofs for the revoked tree (those need the circomlibjs SMT verifier path).
 * @param leafHash - The leaf value (already hashed when the tree is keyed); @param pathElements / pathIndices - Siblings and left/right flags; both must have exactly `depth` entries.
 * @returns True when the recomputed root equals the given root, false otherwise.
 * @throws TypeError when either path array is shorter than depth (an undefined sibling cannot be hashed).
 * Maps to: circuit credential_V1.circom (MerkleProof template); internal — no live caller in src/ or packages/.
 */
export function verifyProof(
  leafHash: bigint,
  pathElements: bigint[],
  pathIndices: number[],
  root: bigint,
  depth: number = TREE_DEPTH
): boolean {
  let current = leafHash;
  for (let i = 0; i < depth; i++) {
    const isRight = pathIndices[i] === 1;
    const sibling = pathElements[i];
    current = isRight ? hashPair(sibling, current) : hashPair(current, sibling);
  }
  return current === root;
}

/**
 * Builds a revoked-credentials tree from a set of nullifiers (leaf = hashLeaf(nullifier, 1), placed at nullifier % 2^depth).
 * LEGACY: the live revoked tree is the circomlibjs SMT (RevokedTree), not this binary tree — and this builder's empty-subtree zero-hash indexing (zeros[depth-level-1]) disagrees with buildMerkleTreeImpl's (zeros[level+1]), so roots from the two builders do not match. No live caller in src/, packages/, or tests/.
 * @param nullifiers - Set of revoked nullifiers; @param depth - Tree depth (default 20).
 * @returns { root, layers }.
 * Maps to: internal — no live caller (legacy; see report).
 */
export function buildRevokedTree(
  nullifiers: Set<bigint>,
  depth: number = TREE_DEPTH
): { root: bigint; layers: bigint[][] } {
  const zeros = buildZeroHashes(depth);
  const size = 2 ** depth;
  const leavesArray: bigint[] = new Array(size).fill(ZERO_VALUE);

  for (const nullifier of nullifiers) {
    const idx = Number(nullifier % BigInt(size));
    leavesArray[idx] = hashLeaf(nullifier, BigInt(1));
  }

  const layers: bigint[][] = [leavesArray];

  for (let level = 0; level < depth; level++) {
    const prev = layers[level];
    const half = prev.length / 2;
    const curr: bigint[] = new Array(half);
    for (let i = 0; i < half; i++) {
      const left = prev[i * 2];
      const right = prev[i * 2 + 1];
      if (left === ZERO_VALUE && right === ZERO_VALUE) {
        curr[i] = zeros[depth - level - 1];
      } else {
        curr[i] = hashPair(left, right);
      }
    }
    layers.push(curr);
  }

  return { root: layers[depth][0], layers };
}

/**
 * Serializes a tree (root, full layers, epoch) to a JSON string.
 * Layers are stringified bigints; the snapshot is only as portable as the builder that made the layers.
 * @returns The JSON snapshot string.
 * Maps to: internal — packages/core/tree-engine snapshot flows.
 */
export function serializeTreeSnapshot(
  root: bigint,
  layers: bigint[][],
  epoch: number
): string {
  return JSON.stringify({
    root: root.toString(),
    layers: layers.map((l) => l.map((n) => n.toString())),
    epoch,
    timestamp: Date.now(),
  });
}

/**
 * Parses a snapshot produced by serializeTreeSnapshot back into bigints.
 * @param data - JSON snapshot string; malformed JSON or non-bigint values throw.
 * @returns { root, layers, epoch, timestamp }.
 * @throws On malformed JSON or values that are not valid bigints.
 * Maps to: internal — packages/core/tree-engine snapshot flows.
 */
export function deserializeTreeSnapshot(data: string): {
  root: bigint;
  layers: bigint[][];
  epoch: number;
  timestamp: number;
} {
  const parsed = JSON.parse(data);
  return {
    root: BigInt(parsed.root),
    layers: parsed.layers.map((l: string[]) => l.map((n: string) => BigInt(n))),
    epoch: parsed.epoch,
    timestamp: parsed.timestamp,
  };
}

/* ============================================================
   INCREMENTAL MERKLE TREE — the active-credentials tree.

   Replaces the old buildMerkleTreeRaw(Map, depth) approach, which:
     (a) placed each leaf at index = commitment % 2^depth  → SILENT COLLISIONS
         (birthday-bound ~50% at ~1,200 creds), last-writer-wins, and
     (b) allocated a 2^depth (=1,048,576) element array and rehashed from
         scratch on every insert AND every proof read.

   This class instead:
     • Uses caller-assigned DENSE indices (0,1,2,…) — collision-free up to
       2^depth leaves, and small integers so proofs are cheap.
     • Stores only non-empty nodes in a sparse per-level cache; empty subtrees
       collapse to precomputed zero-hashes. insert() and getProof() are O(depth)
       (20 Poseidon hashes), root() is O(1). Subsecond by construction.

   Root/proof output is byte-identical to buildMerkleTreeRaw for the SAME index
   placement (same hashPair ordering, same zero-hash convention), so it is fully
   compatible with credential_V1.circom's MerkleProof template. The circuit only
   checks leaf+path→root and is index-agnostic, so moving from commitment%2^depth
   to dense indices requires NO circuit change.
   ============================================================ */

export class IncrementalMerkleTree {
  readonly depth: number;
  private zeros: bigint[];
  // nodes[level] : Map<indexAtLevel, hash>. level 0 = leaves, level `depth` = root.
  private nodes: Map<number, bigint>[];
  private _root: bigint;

  /**
   * Creates an empty incremental tree of the given depth (default 20, ~1M leaves).
   * The tree starts at the all-empty root (zeros[depth]); leaves are added with insert().
   * @param depth - Tree depth; capacity is 2^depth leaves.
   * Maps to: internal — ActiveTree (depth 20).
   */
  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.zeros = buildZeroHashes(depth);
    this.nodes = Array.from({ length: depth + 1 }, () => new Map<number, bigint>());
    this._root = this.zeros[depth];
  }

  /**
   * Inserts or overwrites the leaf at `index` (a raw commitment value) in O(depth).
   * Overwriting an existing index silently replaces its value — the caller owns index allocation (dense indices from ActiveTree).
   * @param index - Dense leaf index, 0 <= index < 2^depth; @param value - Raw leaf value (commitment, NOT hashed).
   * @throws When the index is out of range.
   * Maps to: circuit credential_V1.circom (activeMerkle leaf = commitment); internal — ActiveTree.addLeaf and loadLeaves.
   * Side effects: updates the sparse node cache and the cached root.
   */
  insert(index: number, value: bigint): void {
    if (index < 0 || index >= 2 ** this.depth) {
      throw new Error(`Leaf index ${index} out of range for depth ${this.depth}`);
    }
    this.nodes[0].set(index, value);
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const cur = this.nodes[level].get(idx) ?? this.zeros[level];
      const isRight = idx % 2 === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      const sib = this.nodes[level].get(sibIdx) ?? this.zeros[level];
      // Preserve left/right ordering: parent = hashPair(left, right).
      const parent = isRight ? hashPair(sib, cur) : hashPair(cur, sib);
      idx = Math.floor(idx / 2);
      this.nodes[level + 1].set(idx, parent);
    }
    this._root = this.nodes[this.depth].get(0) ?? this.zeros[this.depth];
  }

  /**
   * Removes the leaf at `index` (resets it to the empty/zero value) in O(depth).
   * Removing an absent index is a no-op; empty parent nodes are pruned from the cache as the root is recomputed.
   * Maps to: internal — ActiveTree.removeLeaf.
   * Side effects: updates the sparse node cache and the cached root.
   */
  remove(index: number): void {
    this.nodes[0].delete(index);
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const cur = this.nodes[level].get(idx) ?? this.zeros[level];
      const isRight = idx % 2 === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      const sib = this.nodes[level].get(sibIdx) ?? this.zeros[level];
      const parent = isRight ? hashPair(sib, cur) : hashPair(cur, sib);
      const parentIdx = Math.floor(idx / 2);
      if (parent === this.zeros[level + 1]) this.nodes[level + 1].delete(parentIdx);
      else this.nodes[level + 1].set(parentIdx, parent);
      idx = parentIdx;
    }
    this._root = this.nodes[this.depth].get(0) ?? this.zeros[this.depth];
  }

  /**
   * Returns the circuit-compatible proof for the leaf at `index` in O(depth): pathIndices[i] = 0 means sibling on the RIGHT (current is left child); pathIndices[i] = 1 means sibling on the LEFT (current is right child).
   * @returns { pathElements, pathIndices, root } — the proof plus the current root for the caller to compare.
   * Maps to: circuit credential_V1.circom (MerkleProof template); internal — ActiveTree.getProof and getProofForCommitment.
   */
  getProof(index: number): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const isRight = idx % 2 === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      pathElements.push(this.nodes[level].get(sibIdx) ?? this.zeros[level]);
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices, root: this._root };
  }

  /**
   * Returns the current Merkle root in O(1) (cached, recomputed on every insert/remove).
   * @returns The root as a bigint (zeros[depth] while the tree is empty).
   * Maps to: internal — ActiveTree.getRoot and persistRoot.
   */
  root(): bigint {
    return this._root;
  }

  /**
   * Returns the number of non-empty leaves currently stored.
   * @returns The leaf count (size of the level-0 node map).
   * Maps to: internal — ActiveTree.getLeafCount and verifySnapshotIntegrity.
   */
  get size(): number {
    return this.nodes[0].size;
  }

  /**
   * Bulk-loads dense leaves (index->value). Clears any existing state first.
   * Every entry goes through insert(), so a duplicate index in the input silently keeps the last value.
   * Maps to: internal — ActiveTree.loadFromDb and restore.
   * Side effects: clears the tree, then inserts all entries and recomputes the root.
   */
  loadLeaves(entries: Iterable<[number, bigint]>): void {
    for (let l = 0; l <= this.depth; l++) this.nodes[l].clear();
    this._root = this.zeros[this.depth];
    for (const [index, value] of entries) this.insert(index, value);
  }
}

/* ============================================================
   SPARSE MERKLE TREE (SMT) — for the revoked-credentials tree.
   Matches circomlib's smtverifier.circom (Poseidon hash0/hash1),
   which the credential_V1 circuit consumes via SMTVerifier(depth).

   We wrap circomlibjs's reference SMT (newMemEmptyTrie) so roots and
   proofs are bit-compatible with the circuit by construction — no
   hand-rolled hashing that could drift from smtverifier.circom.
   ============================================================ */

export interface SmtNonMembershipProof {
  root: bigint;
  siblings: bigint[];   // length = depth (20)
  oldKey: bigint;       // key of the leaf the search landed on
  oldValue: bigint;     // value of that leaf
  isOld0: bigint;       // 1 = empty slot hit, 0 = landed on an existing leaf
}

/**
 * Builds a fresh Poseidon SMT (circomlib reference). Returns the raw smt object.
 * Callers insert keys then ask for non-membership proofs.
 * @returns The empty circomlibjs SMT object (untyped `any` — the library ships no types).
 * @throws When circomlibjs fails to load.
 * Maps to: circuit credential_V1.circom (SMTVerifier, via circomlib's SMT); internal — buildRevokedSmtFromKeys and RevokedTree.rebuild.
 */
export async function buildRevokedSmt(): Promise<any> {
  const circomlibjs = await import("circomlibjs");
  // newMemEmptyTrie is exported as a top-level function in circomlibjs
  return (circomlibjs as any).newMemEmptyTrie();
}

/**
 * Produces a non-membership proof for `key` from a circomlibjs SMT.
 * The proof fields map directly onto SMTVerifier's inputs: siblings[level], oldKey, oldValue, isOld0.
 * Internally uses smt.find(key) which returns, for a non-present key: { found: false, siblings, notFoundKey, notFoundValue, isOld0 }.
 * @param smt - A circomlibjs SMT (from buildRevokedSmt); @param depth - Proof depth (default 20); short sibling arrays are zero-padded to it.
 * @returns The non-membership proof (root, 20 siblings, oldKey, oldValue, isOld0).
 * @throws When the key IS present in the SMT (the credential is revoked — no non-membership proof exists).
 * Maps to: circuit credential_V1.circom (SMTVerifier); internal — RevokedTree.getNonMembershipProof.
 */
export async function smtNonMembershipProof(
  smt: any,
  key: bigint,
  depth: number = TREE_DEPTH
): Promise<SmtNonMembershipProof> {
  const F = smt.F;
  const res = await smt.find(F.e(key.toString()));
  if (res.found) {
    throw new Error(`Key ${key} IS present in the revoked SMT — credential is revoked.`);
  }
  // siblings may be shorter than depth; pad with zeros (matches empty subtrees).
  const rawSiblings: any[] = res.siblings || [];
  const siblings: bigint[] = new Array(depth).fill(0n);
  for (let i = 0; i < rawSiblings.length && i < depth; i++) {
    siblings[i] = BigInt(F.toString(rawSiblings[i]));
  }
  return {
    root: BigInt(F.toString(smt.root)),
    siblings,
    oldKey: BigInt(F.toString(res.notFoundKey)),
    oldValue: BigInt(F.toString(res.notFoundValue)),
    isOld0: res.isOld0 ? 1n : 0n,
  };
}

/**
 * Builds an SMT from a set of revoked keys (value=1) and returns the SMT object.
 * Caller can then query root / proofs.
 * @param revokedKeys - Revocation keys to insert; duplicates are skipped (insert throws on an existing key).
 * @returns The populated circomlibjs SMT object.
 * Maps to: circuit credential_V1.circom (SMTVerifier); internal — RevokedTree.rebuild.
 */
export async function buildRevokedSmtFromKeys(
  revokedKeys: bigint[]
): Promise<any> {
  const smt = await buildRevokedSmt();
  const F = smt.F;
  for (const key of revokedKeys) {
    // value = 1 marks "revoked". insert throws if key exists; ignore dupes.
    try {
      await smt.insert(F.e(key.toString()), F.e("1"));
    } catch {
      // already present — skip
    }
  }
  return smt;
}
