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
  const hash = p.F.toString(p(...converted));
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
  const zeros = buildZeroHashes(depth);
  const size = 2 ** depth;
  const leavesArray: bigint[] = new Array(size).fill(ZERO_VALUE);

  for (const [key, value] of leaves) {
    const idx = Number(key % BigInt(size));
    leavesArray[idx] = hashLeaf(key, value);
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
      } else if (left === ZERO_VALUE) {
        curr[i] = hashPair(ZERO_VALUE, right);
      } else if (right === ZERO_VALUE) {
        curr[i] = hashPair(left, ZERO_VALUE);
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
    pathElements.push(layers[level][siblingIdx] || ZERO_VALUE);
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
