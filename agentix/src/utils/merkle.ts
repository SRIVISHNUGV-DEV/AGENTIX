import { buildPoseidon } from "circomlibjs";

const TREE_DEPTH = 20;
const ZERO_VALUE = BigInt(0);

let _poseidon: any = null;
let _zeroHashes: bigint[] | null = null;

async function getPoseidon() {
  if (!_poseidon) {
    const p = await import("circomlibjs");
    _poseidon = await p.buildPoseidon();
  }
  return _poseidon;
}

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

export async function initMerkleCrypto() {
  await getPoseidon();
}

export function hashPair(left: bigint, right: bigint): bigint {
  return poseidonHash([left, right]);
}

export function hashLeaf(key: bigint, value: bigint): bigint {
  return poseidonHash([key, value]);
}

export function buildZeroHashes(depth: number = TREE_DEPTH): bigint[] {
  if (_zeroHashes && _zeroHashes.length === depth + 1) return _zeroHashes;
  const zeros: bigint[] = [ZERO_VALUE];
  for (let i = 1; i <= depth; i++) {
    zeros[i] = hashPair(zeros[i - 1], zeros[i - 1]);
  }
  _zeroHashes = zeros;
  return zeros;
}

export function buildMerkleTree(
  leaves: Map<bigint, bigint>,
  depth: number = TREE_DEPTH
): { root: bigint; layers: bigint[][]; zeroHashes: bigint[] } {
  return buildMerkleTreeImpl(leaves, depth, false);
}

/**
 * Raw-leaf Merkle tree: leaf value is inserted directly WITHOUT hashing
 * (no hashLeaf step). The credential_V1 circuit uses the commitment itself
 * as the leaf (activeMerkle.leaf <== commitment), so the active tree MUST
 * be built this way or the computed root will not match the circuit's.
 *
 * Key = positional index = Number(commitment % 2^depth).
 */
export function buildMerkleTreeRaw(
  leaves: Map<bigint, bigint>,
  depth: number = TREE_DEPTH
): { root: bigint; layers: bigint[][]; zeroHashes: bigint[] } {
  return buildMerkleTreeImpl(leaves, depth, true);
}

/**
 * Generate a Merkle proof for a leaf, returning siblings + indices in the
 * exact format the credential_V1 circuit's MerkleProof template expects:
 *   pathIndices[i] = 0 means sibling is on the RIGHT (current is left child)
 *   pathIndices[i] = 1 means sibling is on the LEFT  (current is right child)
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

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.zeros = buildZeroHashes(depth);
    this.nodes = Array.from({ length: depth + 1 }, () => new Map<number, bigint>());
    this._root = this.zeros[depth];
  }

  /** Insert or overwrite the leaf at `index` (a raw commitment value) in O(depth). */
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

  /** Remove the leaf at `index` (resets it to the empty/zero value) in O(depth). */
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
   * Circuit-compatible proof for the leaf at `index` in O(depth):
   *   pathIndices[i] = 0 → sibling on the RIGHT (current is left child)
   *   pathIndices[i] = 1 → sibling on the LEFT  (current is right child)
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

  root(): bigint {
    return this._root;
  }

  get size(): number {
    return this.nodes[0].size;
  }

  /** Bulk-load dense leaves (index→value). Clears any existing state first. */
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
 * Build a fresh Poseidon SMT (circomlib reference). Returns the raw smt object.
 * Callers insert keys then ask for non-membership proofs.
 */
export async function buildRevokedSmt(): Promise<any> {
  const circomlibjs = await import("circomlibjs");
  // newMemEmptyTrie is exported as a top-level function in circomlibjs
  return (circomlibjs as any).newMemEmptyTrie();
}

/**
 * Produce a non-membership proof for `key` from a circomlibjs SMT.
 * The proof fields map directly onto SMTVerifier's inputs:
 *   siblings[level], oldKey, oldValue, isOld0
 *
 * Internally uses smt.find(key) which returns, for a non-present key:
 *   { found: false, siblings, notFoundKey, notFoundValue, isOld0 }
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
 * Build an SMT from a set of revoked keys (value=1) and return the SMT object.
 * Caller can then query root / proofs.
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
