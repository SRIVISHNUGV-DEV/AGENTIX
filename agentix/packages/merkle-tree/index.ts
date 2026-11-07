export interface MerkleSnapshot<T> {
  name: string;
  depth: number;
  root: string;
  epoch: number;
  leafCount: number;
  hashFunction: string;
  leaves: Map<number, T>;
}

interface MerkleNode {
  hash: bigint;
  left?: MerkleNode;
  right?: MerkleNode;
}

export class MerkleTree<T = string> {
  public readonly name: string;
  public readonly depth: number;
  public readonly hashFunction: 'poseidon' | 'keccak256' | 'sha256';
  private root: bigint = 0n;
  private epoch: number = 0;
  private leaves: Map<number, bigint> = new Map();
  private nodes: Map<string, bigint> = new Map();
  private zeroHashes: bigint[];

  /**
   * Creates an empty tree whose root is the all-zero-leaf root for its depth.
   * WHY: the depth is fixed at construction because it sizes the tree (2^depth leaves) and the zero-hash chain; pick it before inserting anything.
   * @param name Human-readable label carried into snapshots; does not affect hashing.
   * @param depth Tree depth, default 20 (~1M leaves). Larger depths cost a longer update path per insert.
   * @param hashFunction Leaf/pair hash; `poseidon` is NOT implemented here and silently falls back to SHA-256 (see _hash).
   * @returns A tree with zero leaves and epoch 0.
   * @throws Never throws for sane depths; a negative or huge depth makes _computeZeroHashes loop or throw a range error, not a guard.
   * Maps to: internal — src/utils/merkle.ts (the Poseidon tree the ZK pipeline actually uses; this package is a generic utility, NOT the credential tree).
   * Side effects: precomputes the zero-hash chain, O(depth) hashes.
   */
  constructor(name: string, depth: number = 20, hashFunction: 'poseidon' | 'keccak256' | 'sha256' = 'keccak256') {
    this.name = name;
    this.depth = depth;
    this.hashFunction = hashFunction;
    this.zeroHashes = this._computeZeroHashes(depth);
    this.root = this.zeroHashes[depth];
  }

  /**
   * Inserts (or overwrites) the leaf at `index` and recomputes the root.
   * WHY: the root is the commitment callers prove against, so every mutation must advance it and bump the epoch in one step.
   * @param value Leaf value; hashed as its JSON serialization, so two values with the same JSON are indistinguishable.
   * @returns Nothing; use getRoot()/getEpoch() to observe the new state.
   * @throws Throws when `index` is outside [0, 2^depth - 1].
   * Maps to: internal — MerkleTree.restore / credential issuance paths that add a commitment leaf.
   * Side effects: mutates leaves, cached nodes, root, and epoch (+1). Not idempotent across different values at the same index.
   */
  insert(index: number, value: T): void {
    this._validateIndex(index);
    const leafHash = this._hash(JSON.stringify(value));
    this.leaves.set(index, leafHash);
    this._updatePath(index, leafHash);
    this.epoch++;
  }

  /**
   * Removes the leaf at `index` by resetting it to the zero hash and recomputing the root.
   * WHY: deletion must be provable too — the leaf becomes an empty slot instead of disappearing, so existing proofs stay structurally valid.
   * @returns Nothing; the leaf count drops by one and the epoch advances. Removing an already-empty slot is a no-op that still bumps the epoch.
   * @throws Throws when `index` is outside [0, 2^depth - 1].
   * Maps to: internal — credential revocation paths that clear a commitment leaf.
   * Side effects: mutates leaves, cached nodes, root, and epoch (+1).
   */
  remove(index: number): void {
    this._validateIndex(index);
    this.leaves.delete(index);
    const zeroHash = this.zeroHashes[0];
    this._updatePath(index, zeroHash);
    this.epoch++;
  }

  /**
   * Builds the Merkle inclusion proof (sibling hashes + left/right bits) for the leaf at `index`.
   * WHY: a prover needs exactly these siblings to recompute the root off-chain or inside the credential circuit.
   * @returns `{ path, indices }` with one sibling per level (length = depth); an empty leaf still yields a proof against the zero hash.
   * @throws Throws when `index` is outside [0, 2^depth - 1].
   * Maps to: internal — credential_V1 circuit inputs (proof path for a commitment leaf).
   * Side effects: none (read-only).
   */
  getProof(index: number): { path: bigint[]; indices: number[] } {
    this._validateIndex(index);
    const path: bigint[] = [];
    const indices: number[] = [];

    let currentIndex = index;
    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = this._getNode(level, siblingIndex);
      path.push(sibling);
      indices.push(currentIndex % 2);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { path, indices };
  }

  /**
   * Recomputes the root from a proof and a candidate leaf value and compares it to the expected root.
   * WHY: the cheap local check before handing a proof to the ZK prover or an on-chain verifier — a mismatch here means the proof is stale or for a different leaf.
   * @param proof A `{ path, indices }` pair from getProof; a wrong-length path silently folds to a wrong root instead of throwing.
   * @param root Expected root as a decimal string, as returned by getRoot().
   * @returns True only when the recomputed root equals `root`; false for any mismatch, including a proof for a different index/value.
   * @throws Never throws.
   * Maps to: internal — credential_V1 proof verification (off-chain pre-check for the on-chain verifier).
   * Side effects: none (pure).
   */
  verify(proof: { path: bigint[]; indices: number[] }, root: string, index: number, value: T): boolean {
    const leafHash = this._hash(JSON.stringify(value));
    let currentHash = leafHash;
    let currentIndex = index;

    for (let i = 0; i < proof.path.length; i++) {
      const sibling = proof.path[i];
      if (proof.indices[i] === 0) {
        currentHash = this._hashPair(currentHash, sibling);
      } else {
        currentHash = this._hashPair(sibling, currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return currentHash.toString() === root;
  }

  /**
   * Returns the current root as a decimal string.
   * WHY: the root is the single value commitments are checked against; decimal strings are the serialization the rest of the codebase uses for bigint hashes.
   * @returns Decimal root; an empty tree returns the all-zero-leaf root, never `0`.
   * @throws Never throws.
   * Maps to: internal — proof-service root field (the root a stored proof was built against).
   * Side effects: none.
   */
  getRoot(): string {
    return this.root.toString();
  }

  /**
   * Returns how many insert/remove operations have mutated this tree.
   * WHY: the epoch is the cheap staleness check — a proof built at epoch N is suspect once the epoch moves.
   * @returns Monotonically increasing count starting at 0; restore() resets it to the snapshot's epoch.
   * @throws Never throws.
   * Maps to: internal — MerkleSnapshot.epoch.
   * Side effects: none.
   */
  getEpoch(): number {
    return this.epoch;
  }

  /**
   * Returns the number of non-empty leaves currently stored.
   * WHY: distinguishes a sparse tree from a full one without walking the leaf map.
   * @returns 0 for an empty tree; remove() decrements it, restore() replaces it.
   * @throws Never throws.
   * Maps to: internal — MerkleSnapshot.leafCount.
   * Side effects: none.
   */
  getLeafCount(): number {
    return this.leaves.size;
  }

  /**
   * Attempts to recover the leaf value at `index` — but cannot return the original value.
   * WHY: leaves store only the bigint hash, so `JSON.parse` of the decimal hash yields the hash as a (precision-lost) number, never the inserted value. Verified at runtime: getLeaf(0) after inserting 'hello' returns 1.2e+76. Do not rely on it; see report.
   * @returns The numeric leaf hash cast as T, or undefined for an empty slot or an unparseable hash. Never the original value.
   * @throws Never throws — parse failures return undefined.
   * Maps to: internal — MerkleTree.snapshot / restore round-trip (which inherits the same broken value recovery).
   * Side effects: none.
   */
  getLeaf(index: number): T | undefined {
    const hash = this.leaves.get(index);
    if (!hash) return undefined;
    try {
      return JSON.parse(hash.toString()) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Captures the tree's full state for later restore or export.
   * WHY: checkpoints let callers persist a tree across restarts without replaying every insert.
   * @returns A snapshot with name, depth, root, epoch, leaf count, hash function, and a copy of the leaf map. NOTE: the copied map holds bigint hashes, not original values — restore() re-hashes them and throws on any non-empty tree (see restore).
   * @throws Never throws.
   * Maps to: internal — MerkleTree.restore / exportBinary.
   * Side effects: none (the leaf map is copied; mutating the snapshot does not affect the tree).
   */
  snapshot(): MerkleSnapshot<T> {
    return {
      name: this.name,
      depth: this.depth,
      root: this.root.toString(),
      epoch: this.epoch,
      leafCount: this.leaves.size,
      hashFunction: this.hashFunction,
      leaves: new Map(this.leaves) as Map<number, T>,
    };
  }

  /**
   * Replaces the tree's state with a previously captured snapshot.
   * WHY: restart recovery — rebuild the tree from a persisted snapshot instead of replaying inserts.
   * @param snapshot A snapshot from snapshot() or importBinary(); its leaf map is expected to hold original values, but snapshot() actually stores bigint hashes.
   * @returns Nothing; leaves, nodes, root, and epoch are replaced.
   * @throws Throws `TypeError: Do not know how to serialize a BigInt` for any non-empty snapshot from snapshot() (verified at runtime); empty snapshots restore cleanly.
   * Maps to: internal — MerkleTree.snapshot / importBinary.
   * Side effects: clears leaves and cached nodes, then re-inserts every snapshot leaf (epoch ends at the snapshot's epoch).
   */
  restore(snapshot: MerkleSnapshot<T>): void {
    this.leaves.clear();
    this.nodes.clear();

    for (const [index, value] of snapshot.leaves) {
      const leafHash = this._hash(JSON.stringify(value));
      this.leaves.set(index, leafHash);
      this._updatePath(index, leafHash);
    }

    this.epoch = snapshot.epoch;
  }

  /**
   * Serializes a snapshot to a Buffer for persistence or transport.
   * WHY: the binary form is what gets written to disk or sent across a boundary; JSON with bigint-safe encoding keeps roots/hashes exact.
   * @returns A Buffer of the JSON snapshot with bigints encoded as decimal strings. NOTE: `leaves` is a Map, which JSON.stringify renders as `{}` — every leaf is silently dropped, so importBinary() restores an empty tree (verified at runtime).
   * @throws Throws on serialization failure.
   * Maps to: internal — MerkleTree.importBinary.
   * Side effects: none.
   */
  exportBinary(): Buffer {
    const snapshot = this.snapshot();
    return Buffer.from(JSON.stringify(snapshot, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ));
  }

  /**
   * Rebuilds the tree from a buffer produced by exportBinary().
   * WHY: restart recovery from the persisted form.
   * @param data Buffer from exportBinary(); anything else parses unpredictably (long digit strings become BigInt; plain objects with root/epoch/leaves keys become snapshots).
   * @returns Nothing; state is replaced via restore(). NOTE: because exportBinary() drops the leaves, a round-tripped tree comes back empty (0 leaves, empty-tree root) while keeping the exported epoch — silently wrong (verified at runtime).
   * @throws Throws on invalid JSON or when restore() cannot serialize a revived leaf value.
   * Maps to: internal — MerkleTree.exportBinary.
   * Side effects: replaces leaves, nodes, root, and epoch.
   */
  importBinary(data: Buffer): void {
    const snapshot = JSON.parse(data.toString(), (_, v) => {
      if (typeof v === 'string' && /^\d+$/.test(v) && v.length > 15) {
        return BigInt(v);
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('root' in v && 'epoch' in v && 'leaves' in v) {
          const m = new Map<number, T>();
          for (const [k, val] of Object.entries(v.leaves as Record<string, T>)) {
            m.set(parseInt(k), val);
          }
          return { ...v, leaves: m } as MerkleSnapshot<T>;
        }
      }
      return v;
    }) as MerkleSnapshot<T>;
    this.restore(snapshot);
  }

  /**
   * Checks the tree's stored root against a freshly read root.
   * WHY: intended as a post-restore sanity check to catch corrupted in-memory state before proofs are issued.
   * @returns True when the two readings agree. NOTE: both readings come from the same in-memory `root` field (`this.root.toString()` vs getRoot()), so this is currently a tautology — it cannot detect a wrongly computed root, only a divergence that cannot happen.
   * @throws Never throws.
   * Maps to: internal — MerkleTree.restore / importBinary (post-load sanity check).
   * Side effects: none.
   */
  verifyConsistency(): boolean {
    const computed = this.root.toString();
    const stored = this.getRoot();
    return computed === stored;
  }

  /**
   * Rejects leaf indices outside the tree's addressable range.
   * WHY: every public mutation/proof path funnels through here so an out-of-range index fails loudly instead of silently addressing a wrong path.
   * @param index Leaf index; valid range is [0, 2^depth - 1].
   * @throws Throws Error when the index is out of range.
   * Maps to: internal — MerkleTree.insert / remove / getProof.
   * Side effects: none.
   */
  private _validateIndex(index: number): void {
    const maxIndex = 2 ** this.depth - 1;
    if (index < 0 || index > maxIndex) {
      throw new Error(`Index ${index} out of range [0, ${maxIndex}] for depth ${this.depth}`);
    }
  }

  /**
   * Hashes a string to a 254-bit bigint under the tree's configured hash function.
   * WHY: 254-bit outputs keep hashes inside the BN254 field the credential circuit works over.
   * @param data UTF-8 string to hash (leaf JSON, or two concatenated decimal hashes for pairs).
   * @returns Hash reduced modulo 2^254.
   * @throws Never throws — a missing `ethers` install falls back to SHA3-256, and `poseidon` mode silently uses SHA-256.
   * Maps to: internal — credential_V1 Poseidon hashing in src/utils/merkle.ts (this package is NOT the ZK pipeline's tree).
   * Side effects: none (requires `crypto`, optionally `ethers`).
   * Security note: the keccak256 path falls back to NIST SHA3-256 when ethers is absent — same length, different digest, so roots computed with and without ethers do not match. `poseidon` here is not Poseidon at all.
   */
  private _hash(data: string): bigint {
    // WARNING: This packages/merkle-tree package is NOT used by the ZK pipeline.
    // The credential_V1 circuit uses Poseidon hashing (see src/utils/merkle.ts).
    // This package is a generic utility tree — its "keccak256" mode is provided
    // for off-circuit use only. Real keccak256 in Node uses the 'keccak' npm
    // package (NIST SHA-3 with Keccak padding), NOT crypto.createHash('sha3-256')
    // which is NIST SHA-3 (different padding → different digest).
    const crypto = require('crypto');
    if (this.hashFunction === 'keccak256') {
      // Use ethers v6 keccak256 if available (correct Keccak-256), else
      // fall back to sha3-256 with a clear warning that it is NOT EVM keccak.
      try {
        const { ethers } = require('ethers');
        return BigInt(ethers.keccak256('0x' + Buffer.from(data, 'utf8').toString('hex'))) % (2n ** 254n);
      } catch {
        // ethers not installed — sha3-256 is NOT keccak256 but avoids crashing
        return BigInt('0x' + crypto.createHash('sha3-256').update(data).digest('hex')) % (2n ** 254n);
      }
    }
    if (this.hashFunction === 'sha256') {
      return BigInt('0x' + crypto.createHash('sha256').update(data).digest('hex')) % (2n ** 254n);
    }
    // poseidon mode would require circomlibjs — not implemented in this generic package
    return BigInt('0x' + crypto.createHash('sha256').update(data).digest('hex')) % (2n ** 254n);
  }

  /**
   * Hashes an ordered pair of child hashes into their parent hash.
   * WHY: ordering is the tree's left/right discipline — swapping the pair yields a different parent, which is what makes proofs position-sensitive.
   * @returns Parent hash, modulo 2^254.
   * @throws Never throws (see _hash).
   * Maps to: internal — MerkleTree._updatePath / _computeZeroHashes.
   * Side effects: none.
   */
  private _hashPair(left: bigint, right: bigint): bigint {
    const data = left.toString() + right.toString();
    return this._hash(data);
  }

  /**
   * Reads a cached node hash, defaulting to the zero hash for its level when absent.
   * WHY: sparse trees only store nodes on touched paths; untouched subtrees are all-zero by definition.
   * @param level 0 = leaves, depth = root level.
   * @returns Stored hash, or the level's zero hash for an untouched node.
   * @throws Never throws.
   * Maps to: internal — MerkleTree.getProof / _updatePath.
   * Side effects: none.
   */
  private _getNode(level: number, index: number): bigint {
    const key = `${level}_${index}`;
    return this.nodes.get(key) || this.zeroHashes[level];
  }

  /**
   * Caches a node hash at a level/index position.
   * WHY: proofs and updates read siblings from this cache instead of recomputing whole subtrees.
   * @throws Never throws.
   * Maps to: internal — MerkleTree._updatePath.
   * Side effects: mutates the node cache.
   */
  private _setNode(level: number, index: number, value: bigint): void {
    const key = `${level}_${index}`;
    this.nodes.set(key, value);
  }

  /**
   * Recomputes every ancestor of a changed leaf up to the root.
   * WHY: the root must reflect the latest leaf in O(depth) work — this is the only place the root is ever assigned.
   * @param leafHash Hash of the new leaf value (or the zero hash for a removal).
   * @throws Never throws for a validated index.
   * Maps to: internal — MerkleTree.insert / remove / restore.
   * Side effects: mutates the node cache and the root.
   */
  private _updatePath(index: number, leafHash: bigint): void {
    let currentHash = leafHash;
    let currentIndex = index;

    this._setNode(0, currentIndex, currentHash);

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = this._getNode(level, siblingIndex);

      if (currentIndex % 2 === 0) {
        currentHash = this._hashPair(currentHash, sibling);
      } else {
        currentHash = this._hashPair(sibling, currentHash);
      }

      currentIndex = Math.floor(currentIndex / 2);
      this._setNode(level + 1, currentIndex, currentHash);
    }

    this.root = currentHash;
  }

  /**
   * Builds the chain of empty-subtree hashes, one per level.
   * WHY: an empty subtree of height h has a fixed hash; precomputing the chain makes sparse proofs and the empty-tree root O(1) lookups.
   * @param depth Tree depth; the returned array has depth+1 entries (level 0 through depth).
   * @returns Zero hashes indexed by level; entry [depth] is the empty-tree root.
   * @throws Never throws.
   * Maps to: internal — MerkleTree constructor (only caller).
   * Side effects: none.
   */
  private _computeZeroHashes(depth: number): bigint[] {
    const zeros: bigint[] = [];
    let current = this._hash('0');
    zeros.push(current);

    for (let i = 1; i <= depth; i++) {
      current = this._hashPair(current, current);
      zeros.push(current);
    }

    return zeros;
  }
}
