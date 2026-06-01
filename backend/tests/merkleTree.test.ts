import { describe, it, expect } from "bun:test"
import { ethers } from "ethers"
import { MerkleTree, hashPair } from "../src/utils/merkleTree"

function verifyProof(root: string, leaf: string, proof: string[]): boolean {
  let current = leaf
  for (const sibling of proof) {
    current = hashPair(current, sibling)
  }
  return current === root
}

describe("MerkleTree", () => {
  it("should return ZeroHash for empty tree", () => {
    const tree = new MerkleTree([])
    expect(tree.root).toBe(ethers.ZeroHash)
  })

  it("should handle a single leaf", () => {
    const leaf = ethers.keccak256(ethers.toUtf8Bytes("hello"))
    const tree = new MerkleTree([leaf])
    // Single leaf tree: root is the leaf itself (no siblings)
    expect(tree.root).toBe(leaf)
  })

  it("should produce verifiable proof for two leaves", () => {
    const leafA = ethers.keccak256(ethers.toUtf8Bytes("alpha"))
    const leafB = ethers.keccak256(ethers.toUtf8Bytes("beta"))
    const tree = new MerkleTree([leafA, leafB])

    const proofA = tree.getProof(leafA)
    const proofB = tree.getProof(leafB)

    expect(proofA.length).toBe(1)
    expect(proofB.length).toBe(1)
    expect(verifyProof(tree.root, leafA, proofA)).toBe(true)
    expect(verifyProof(tree.root, leafB, proofB)).toBe(true)
  })

  it("should produce verifiable proof for three leaves", () => {
    const leaves = ["a", "b", "c"].map(s => ethers.keccak256(ethers.toUtf8Bytes(s)))
    const tree = new MerkleTree(leaves)

    for (const leaf of leaves) {
      const proof = tree.getProof(leaf)
      expect(verifyProof(tree.root, leaf, proof)).toBe(true)
    }
  })

  it("should produce verifiable proof for seven leaves", () => {
    const leaves = Array.from({ length: 7 }, (_, i) =>
      ethers.keccak256(ethers.toUtf8Bytes(`leaf-${i}`))
    )
    const tree = new MerkleTree(leaves)

    for (const leaf of leaves) {
      const proof = tree.getProof(leaf)
      expect(verifyProof(tree.root, leaf, proof)).toBe(true)
    }
  })

  it("should sort leaves deterministically", () => {
    const a = ethers.keccak256(ethers.toUtf8Bytes("apple"))
    const b = ethers.keccak256(ethers.toUtf8Bytes("banana"))

    const tree1 = new MerkleTree([a, b])
    const tree2 = new MerkleTree([b, a])

    expect(tree1.root).toBe(tree2.root)
  })

  it("should throw for unknown leaf", () => {
    const tree = new MerkleTree([
      ethers.keccak256(ethers.toUtf8Bytes("known")),
    ])
    const unknown = ethers.keccak256(ethers.toUtf8Bytes("unknown"))
    expect(() => tree.getProof(unknown)).toThrow("Leaf not found")
  })

  it("hashPair sorts inputs deterministically", () => {
    const a = ethers.keccak256(ethers.toUtf8Bytes("first"))
    const b = ethers.keccak256(ethers.toUtf8Bytes("second"))

    const h1 = hashPair(a, b)
    const h2 = hashPair(b, a)
    expect(h1).toBe(h2)
  })

  it("should produce verifiable proof for 100 leaves", () => {
    const leaves = Array.from({ length: 100 }, (_, i) =>
      ethers.keccak256(ethers.toUtf8Bytes(`payload-${i}`))
    )
    const tree = new MerkleTree(leaves)

    for (let i = 0; i < leaves.length; i += 17) {
      const leaf = leaves[i]
      const proof = tree.getProof(leaf)
      expect(verifyProof(tree.root, leaf, proof)).toBe(true)
    }
  })

  it("should use lowercase comparison for sorting", () => {
    // Uppercase hex letters vs lowercase should sort correctly
    const leafA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const leafB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

    const tree = new MerkleTree([leafA, leafB])
    const proofA = tree.getProof(leafA)
    expect(verifyProof(tree.root, leafA, proofA)).toBe(true)
  })
})

describe("hashPair", () => {
  it("should produce a 66-char hex string", () => {
    const a = ethers.keccak256(ethers.toUtf8Bytes("x"))
    const b = ethers.keccak256(ethers.toUtf8Bytes("y"))
    const result = hashPair(a, b)
    expect(result).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("should be deterministic", () => {
    const a = ethers.keccak256(ethers.toUtf8Bytes("x"))
    const b = ethers.keccak256(ethers.toUtf8Bytes("y"))
    expect(hashPair(a, b)).toBe(hashPair(a, b))
  })
})
