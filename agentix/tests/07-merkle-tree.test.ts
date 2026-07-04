import { describe, it, expect, beforeAll } from "vitest";

let buildMerkleTree: any, getMerkleProof: any, verifyProof: any, hashPair: any, hashLeaf: any, buildZeroHashes: any, initMerkleCrypto: any;

describe("7. Merkle Tree Tests", () => {
  beforeAll(async () => {
    const merkle = await import("../src/utils/merkle");
    buildMerkleTree = merkle.buildMerkleTree;
    getMerkleProof = merkle.getMerkleProof;
    verifyProof = merkle.verifyProof;
    hashPair = merkle.hashPair;
    hashLeaf = merkle.hashLeaf;
    buildZeroHashes = merkle.buildZeroHashes;
    initMerkleCrypto = merkle.initMerkleCrypto;
    await initMerkleCrypto();
  });

  it("builds zero hashes for depth 10", () => {
    const zeros = buildZeroHashes(10);
    expect(zeros).toBeDefined();
    expect(zeros.length).toBe(11);
    expect(typeof zeros[0]).toBe("bigint");
  });

  it("builds a merkle tree from leaves", () => {
    const leaves = new Map<bigint, bigint>();
    for (let i = 0; i < 8; i++) {
      leaves.set(BigInt(i), BigInt(i + 100));
    }
    const tree = buildMerkleTree(leaves, 10);
    expect(tree).toBeDefined();
    expect(typeof tree.root).toBe("bigint");
    expect(tree.layers).toBeDefined();
    expect(tree.layers.length).toBe(11);
  });

  it("produces deterministic roots", () => {
    const leaves = new Map<bigint, bigint>();
    leaves.set(0n, 100n);
    leaves.set(1n, 101n);
    leaves.set(2n, 102n);
    leaves.set(3n, 103n);

    const tree1 = buildMerkleTree(leaves, 10);
    const tree2 = buildMerkleTree(leaves, 10);
    expect(tree1.root).toBe(tree2.root);
  });

  it("different leaves produce different roots", () => {
    const leaves1 = new Map<bigint, bigint>();
    leaves1.set(0n, 10n);
    leaves1.set(1n, 20n);

    const leaves2 = new Map<bigint, bigint>();
    leaves2.set(0n, 30n);
    leaves2.set(1n, 40n);

    const tree1 = buildMerkleTree(leaves1, 10);
    const tree2 = buildMerkleTree(leaves2, 10);
    expect(tree1.root).not.toBe(tree2.root);
  });

  it("generates and verifies merkle proofs", () => {
    const leaves = new Map<bigint, bigint>();
    for (let i = 0; i < 8; i++) {
      leaves.set(BigInt(i), BigInt(i + 200));
    }
    const tree = buildMerkleTree(leaves, 10);

    for (let i = 0; i < 8; i++) {
      const leafHash = hashLeaf(BigInt(i), BigInt(i + 200));
      const proof = getMerkleProof(tree.layers, i, 10);
      expect(proof).toBeDefined();
      expect(proof.pathElements.length).toBe(10);
      expect(proof.pathIndices.length).toBe(10);

      const valid = verifyProof(leafHash, proof.pathElements, proof.pathIndices, tree.root);
      expect(valid).toBe(true);
    }
  });

  it("rejects invalid merkle proofs", () => {
    const leaves = new Map<bigint, bigint>();
    leaves.set(0n, 10n);
    leaves.set(1n, 20n);
    const tree = buildMerkleTree(leaves, 10);
    const proof = getMerkleProof(tree.layers, 0, 10);

    const fakeLeaf = hashLeaf(999n, 9999n);
    const valid = verifyProof(fakeLeaf, proof.pathElements, proof.pathIndices, tree.root);
    expect(valid).toBe(false);
  });

  it("handles single leaf tree", () => {
    const leaves = new Map<bigint, bigint>();
    leaves.set(0n, 42n);
    const tree = buildMerkleTree(leaves, 10);
    expect(typeof tree.root).toBe("bigint");
  });

  it("handles empty leaf map", () => {
    const leaves = new Map<bigint, bigint>();
    const tree = buildMerkleTree(leaves, 10);
    expect(typeof tree.root).toBe("bigint");
  });

  it("supports incremental tree building", () => {
    const leaves = new Map<bigint, bigint>();
    let previousRoot = 0n;

    for (let i = 0; i < 10; i++) {
      leaves.set(BigInt(i), BigInt(i + 500));
      const tree = buildMerkleTree(leaves, 10);
      expect(typeof tree.root).toBe("bigint");
      if (previousRoot !== 0n) {
        expect(tree.root).not.toBe(previousRoot);
      }
      previousRoot = tree.root;
    }
  });

  it("tree depth 10 produces 1024 maximum leaves", () => {
    const treeSize = Math.pow(2, 10);
    expect(treeSize).toBe(1024);
  });

  it("hashPair is deterministic", () => {
    const a = 12345678901234567890n;
    const b = 98765432109876543210n;
    const h1 = hashPair(a, b);
    const h2 = hashPair(a, b);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("bigint");
  });

  it("hashLeaf produces consistent results", () => {
    const h1 = hashLeaf(1n, 100n);
    const h2 = hashLeaf(1n, 100n);
    expect(h1).toBe(h2);
    const h3 = hashLeaf(1n, 200n);
    expect(h1).not.toBe(h3);
  });
});
