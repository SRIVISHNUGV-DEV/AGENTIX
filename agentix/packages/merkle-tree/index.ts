import { runQuery, runSingle, runExecute } from '@agentix/database';

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

  constructor(name: string, depth: number = 20, hashFunction: 'poseidon' | 'keccak256' | 'sha256' = 'keccak256') {
    this.name = name;
    this.depth = depth;
    this.hashFunction = hashFunction;
    this.zeroHashes = this._computeZeroHashes(depth);
    this.root = this.zeroHashes[depth];
  }

  insert(index: number, value: T): void {
    this._validateIndex(index);
    const leafHash = this._hash(JSON.stringify(value));
    this.leaves.set(index, leafHash);
    this._updatePath(index, leafHash);
    this.epoch++;
  }

  remove(index: number): void {
    this._validateIndex(index);
    this.leaves.delete(index);
    const zeroHash = this.zeroHashes[0];
    this._updatePath(index, zeroHash);
    this.epoch++;
  }

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

  getRoot(): string {
    return this.root.toString();
  }

  getEpoch(): number {
    return this.epoch;
  }

  getLeafCount(): number {
    return this.leaves.size;
  }

  getLeaf(index: number): T | undefined {
    const hash = this.leaves.get(index);
    if (!hash) return undefined;
    try {
      return JSON.parse(hash.toString()) as T;
    } catch {
      return undefined;
    }
  }

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

  exportBinary(): Buffer {
    const snapshot = this.snapshot();
    return Buffer.from(JSON.stringify(snapshot, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ));
  }

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

  verifyConsistency(): boolean {
    const computed = this.root.toString();
    const stored = this.getRoot();
    return computed === stored;
  }

  private _validateIndex(index: number): void {
    const maxIndex = 2 ** this.depth - 1;
    if (index < 0 || index > maxIndex) {
      throw new Error(`Index ${index} out of range [0, ${maxIndex}] for depth ${this.depth}`);
    }
  }

  private _hash(data: string): bigint {
    const crypto = require('crypto');
    if (this.hashFunction === 'keccak256') {
      return BigInt('0x' + crypto.createHash('sha3-256').update(data).digest('hex')) % (2n ** 254n);
    }
    if (this.hashFunction === 'sha256') {
      return BigInt('0x' + crypto.createHash('sha256').update(data).digest('hex')) % (2n ** 254n);
    }
    return BigInt('0x' + crypto.createHash('sha256').update(data).digest('hex')) % (2n ** 254n);
  }

  private _hashPair(left: bigint, right: bigint): bigint {
    const data = left.toString() + right.toString();
    return this._hash(data);
  }

  private _getNode(level: number, index: number): bigint {
    const key = `${level}_${index}`;
    return this.nodes.get(key) || this.zeroHashes[level];
  }

  private _setNode(level: number, index: number, value: bigint): void {
    const key = `${level}_${index}`;
    this.nodes.set(key, value);
  }

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
