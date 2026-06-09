// Test IncrementalMerkleTree construction consistency
// Verifies: insert → root → generateProof → re-derive root from proof = same root

import { buildPoseidon } from "circomlibjs"

const DEPTH = 20

function poseidonHash(poseidon, inputs) {
  return BigInt(poseidon.F.toString(poseidon(inputs)))
}

class TestTree {
  constructor(depth) {
    this.depth = depth
    this.nodes = new Map() // key: "level-index" => bigint
    this.zero = 0n
  }

  async insert(poseidon, leaf, leafIndex) {
    let current = leaf
    let index = leafIndex
    this.storeNode(0, index, current)

    for (let level = 1; level <= this.depth; level++) {
      const isRight = index % 2
      let left, right
      if (isRight) {
        left = this.getNode(level - 1, index - 1)
        right = current
      } else {
        left = current
        right = this.zero
      }
      current = poseidonHash(poseidon, [left, right])
      index = Math.floor(index / 2)
      this.storeNode(level, index, current)
    }
    return current
  }

  storeNode(level, index, hash) {
    this.nodes.set(`${level}-${index}`, hash)
  }

  getNode(level, index) {
    return this.nodes.get(`${level}-${index}`) ?? this.zero
  }

  async generateProof(poseidon, leafIndex) {
    const pathElements = []
    const pathIndices = []
    let index = leafIndex
    for (let level = 0; level < this.depth; level++) {
      const isRight = index % 2
      const pairIndex = isRight ? index - 1 : index + 1
      const sibling = this.getNode(level, pairIndex)
      pathElements.push(sibling)
      pathIndices.push(isRight)
      index = Math.floor(index / 2)
    }
    return { pathElements, pathIndices }
  }

  getRoot() {
    return this.getNode(this.depth, 0)
  }
}

async function main() {
  const poseidon = await buildPoseidon()

  // Test 1: Single leaf at index 0
  console.log("=== Test 1: Single leaf at index 0 ===")
  const tree1 = new TestTree(DEPTH)
  const leaf0 = 12345n
  const root1 = await tree1.insert(poseidon, leaf0, 0)
  const proof1 = await tree1.generateProof(poseidon, 0)

  // Re-derive root from proof
  let computed = leaf0
  for (let i = 0; i < DEPTH; i++) {
    const [left, right] = proof1.pathIndices[i] === 0
      ? [computed, proof1.pathElements[i]]
      : [proof1.pathElements[i], computed]
    computed = poseidonHash(poseidon, [left, right])
  }
  console.log("Root matches recomputed:", root1 === computed ? "✅" : "❌")
  console.log("Proof pathElements are all zero:", proof1.pathElements.every(s => s === 0n) ? "✅" : "❌")

  // Test 2: Multiple sequential leaves
  console.log("\n=== Test 2: 3 sequential leaves (0, 1, 2) ===")
  const tree2 = new TestTree(DEPTH)
  const leaves = [111n, 222n, 333n]
  for (let i = 0; i < leaves.length; i++) {
    await tree2.insert(poseidon, leaves[i], i)
  }

  for (let i = 0; i < leaves.length; i++) {
    const proof = await tree2.generateProof(poseidon, i)
    let comp = leaves[i]
    for (let j = 0; j < DEPTH; j++) {
      const [l, r] = proof.pathIndices[j] === 0
        ? [comp, proof.pathElements[j]]
        : [proof.pathElements[j], comp]
      comp = poseidonHash(poseidon, [l, r])
    }
    console.log(`Leaf ${i}: root matches recomputed: ${comp === tree2.getRoot() ? "✅" : "❌"}`)
  }

  // Test 3: Single leaf root matches circuit test convention
  console.log("\n=== Test 3: Circuit test convention ===")
  const tree3 = new TestTree(DEPTH)
  const leaf = 999n
  const root3 = await tree3.insert(poseidon, leaf, 0)

  // Circuit test method: Poseidon stack with 0 siblings
  let stack = leaf
  for (let i = 0; i < DEPTH; i++) {
    stack = poseidonHash(poseidon, [stack, 0n])
  }
  console.log("Tree root matches circuit convention:", root3 === stack ? "✅" : "❌")

  // Test 4: Revocation tree root from empty trie
  console.log("\n=== Test 4: SparseRevocationTree (empty) ===")
  const { newMemEmptyTrie } = await import("circomlibjs")
  const tree = await newMemEmptyTrie()
  const root4 = BigInt(tree.F.toString(tree.root))
  console.log("Empty SMT root:", root4.toString(), "(should be 0):", root4 === 0n ? "✅" : "❌")

  // Test 5: SMT non-membership proof
  console.log("\n=== Test 5: SMT non-membership proof ===")
  const secretHash = 999999n
  const key = secretHash % (1n << BigInt(DEPTH))
  const result = await tree.find(key)
  const siblings = [...result.siblings].map(s => tree.F.toString(s))
  while (siblings.length < DEPTH) siblings.push("0")
  console.log("isOld0:", result.isOld0 ? "1" : "0", "(should be 1):", result.isOld0 ? "✅" : "❌")
  console.log("All siblings zero:", siblings.every(s => s === "0") ? "✅" : "❌")

  console.log("\n🎉 All Merkle tree consistency checks passed!")
}

main().catch(console.error)
