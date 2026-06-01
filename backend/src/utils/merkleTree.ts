import { ethers } from "ethers"

export function hashPair(a: string, b: string): string {
  const [first, second] =
    a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "bytes32"], [first, second])
  )
}

export class MerkleTree {
  private leaves: string[]
  private levels: string[][]

  constructor(leaves: string[]) {
    this.leaves = [...leaves].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    )
    this.levels = [this.leaves]
    this.build()
  }

  private build(): void {
    let level = this.leaves
    while (level.length > 1) {
      const nextLevel: string[] = []
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) {
          nextLevel.push(hashPair(level[i], level[i + 1]))
        } else {
          nextLevel.push(level[i])
        }
      }
      this.levels.push(nextLevel)
      level = nextLevel
    }
  }

  get root(): string {
    if (this.leaves.length === 0) return ethers.ZeroHash
    return this.levels[this.levels.length - 1][0]
  }

  getProof(leaf: string): string[] {
    let idx = this.leaves.indexOf(leaf)
    if (idx === -1) throw new Error("Leaf not found in tree")

    const proof: string[] = []
    for (let i = 0; i < this.levels.length - 1; i++) {
      const siblings = this.levels[i]
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1
      if (siblingIdx < siblings.length) {
        proof.push(siblings[siblingIdx])
      }
      idx = Math.floor(idx / 2)
    }
    return proof
  }
}
