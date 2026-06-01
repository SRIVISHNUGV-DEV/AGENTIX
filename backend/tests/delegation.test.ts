import { describe, it, expect } from "bun:test"
import { ethers } from "ethers"
import { MerkleTree } from "../src/utils/merkleTree"

function sortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(",")}]`
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  const pairs = keys.map(k => `${JSON.stringify(k)}:${sortedStringify((obj as Record<string, unknown>)[k])}`)
  return `{${pairs.join(",")}}`
}

describe("Delegation pure functions", () => {
  it("should compute deterministic delegation leaf hash", () => {
    const delId = ethers.keccak256(ethers.toUtf8Bytes("delegation:1"))
    const delegator = "0x1111111111111111111111111111111111111111"
    const delegate = "0x2222222222222222222222222222222222222222"
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("{}"))
    const expiresAt = 1800000000
    const maxDepth = 5

    const leaf = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "bytes32", "uint64", "uint8"],
        [delId, delegator, delegate, scopeHash, expiresAt, maxDepth]
      )
    )

    expect(leaf).toMatch(/^0x[0-9a-f]{64}$/)

    // Determinism
    const leaf2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "bytes32", "uint64", "uint8"],
        [delId, delegator, delegate, scopeHash, expiresAt, maxDepth]
      )
    )
    expect(leaf).toBe(leaf2)
  })

  it("should compute scope hash deterministically with sorted keys", () => {
    const scope1 = { allowedActions: ["read"], maxValueWei: "100000000000000000" }
    const scope2 = { maxValueWei: "100000000000000000", allowedActions: ["read"] }

    const hash1 = ethers.keccak256(ethers.toUtf8Bytes(sortedStringify(scope1)))
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes(sortedStringify(scope2)))
    expect(hash1).toBe(hash2)

    // Also test nested sorting
    const scope3 = { allowedTargets: ["a", "b"], restrictToResources: ["x", "y"] }
    const scope4 = { restrictToResources: ["y", "x"], allowedTargets: ["b", "a"] }

    const hash3 = ethers.keccak256(ethers.toUtf8Bytes(sortedStringify(scope3)))
    const hash4 = ethers.keccak256(ethers.toUtf8Bytes(sortedStringify(scope4)))
    // Arrays are not sorted (only keys are)
    expect(hash3).not.toBe(hash4)
  })

  it("sortedStringify produces deterministic keys", () => {
    const a = { b: 1, a: 2, c: { z: 3, y: 4 } }
    const b = { c: { y: 4, z: 3 }, a: 2, b: 1 }

    expect(sortedStringify(a)).toBe(sortedStringify(b))
    expect(sortedStringify(a)).toBe('{"a":2,"b":1,"c":{"y":4,"z":3}}')
  })

  it("sortedStringify handles null and primitives", () => {
    expect(sortedStringify(null)).toBe("null")
    expect(sortedStringify("hello")).toBe('"hello"')
    expect(sortedStringify(42)).toBe("42")
    expect(sortedStringify([3, 1, 2])).toBe("[3,1,2]")
  })

  it("merkle tree over delegation leaves produces verifiable proofs", () => {
    const delegatorAddr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const delegateAddr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

    const delegations = [
      { id: 1, scope: { allowedActions: ["read"] }, expires_at: 0, max_depth: 3 },
      { id: 2, scope: { allowedActions: ["write"] }, expires_at: 0, max_depth: 5 },
      { id: 3, scope: { allowedActions: ["execute"], maxValueWei: "100000000000000000" }, expires_at: 1800000000, max_depth: 1 },
    ]

    const leaves = delegations.map(d => {
      const delId = ethers.keccak256(ethers.toUtf8Bytes(`delegation:${d.id}`))
      const scopeHash = ethers.keccak256(ethers.toUtf8Bytes(sortedStringify(d.scope)))
      return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "address", "bytes32", "uint64", "uint8"],
          [delId, delegatorAddr, delegateAddr, scopeHash, d.expires_at, d.max_depth]
        )
      )
    })

    const tree = new MerkleTree(leaves)

    for (const leaf of leaves) {
      const proof = tree.getProof(leaf)
      let current = leaf
      for (const sibling of proof) {
        const [first, second] =
          current.toLowerCase() < sibling.toLowerCase()
            ? [current, sibling]
            : [sibling, current]
        current = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [first, second])
        )
      }
      expect(current).toBe(tree.root)
    }
  })
})
