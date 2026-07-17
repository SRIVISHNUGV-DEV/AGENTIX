import { initMerkleCrypto, buildMerkleTreeRaw, getMerkleProof, hashPair } from "../src/utils/merkle.ts";
import { computeCommitment } from "../src/core/zk-prover.ts";

await initMerkleCrypto();

const commitment = await computeCommitment({
  agentId: 1n, orgId: 1n, budgetLimit: 1000000000000000000n,
  wallet: 0x6C826A49aD8447FD94d61f515013ea93066e94C5n,
  expiry: BigInt(Math.floor(Date.now()/1000)+86400),
  credentialVersion: 1n, secret: 0x1234567890abcdefn,
});
console.log("commitment:", commitment.toString().slice(0, 40));

const TREE_DEPTH = 20;
const leafIndex = Number(commitment % (1n << BigInt(TREE_DEPTH)));
console.log("leafIndex:", leafIndex);

const leaves = new Map([[BigInt(leafIndex), commitment]]);
const tree = buildMerkleTreeRaw(leaves, TREE_DEPTH);
console.log("tree root:", tree.root.toString().slice(0, 40));

const mp = getMerkleProof(tree.layers, leafIndex, TREE_DEPTH);
console.log("first 5 pathIndices:", mp.pathIndices.slice(0, 5));
console.log("first 5 pathElements:", mp.pathElements.slice(0, 5).map(e => e.toString().slice(0, 15)));

// Simulate circuit: hashes[0] = leaf (commitment)
let h = commitment;
for (let i = 0; i < 5; i++) {
  const isRight = mp.pathIndices[i] === 1;
  const sibling = mp.pathElements[i];
  h = isRight ? hashPair(sibling, h) : hashPair(h, sibling);
  console.log(`  level ${i}: idx=${mp.pathIndices[i]} sibling=${sibling.toString().slice(0,15)} hash=${h.toString().slice(0,30)}`);
}
console.log("after 5 levels:", h.toString().slice(0, 30));
console.log("layers[5] at computed position:", tree.layers[5] ? "exists" : "missing");

// Find position in layers[5]
let pos = leafIndex;
for (let i = 0; i < 5; i++) pos = Math.floor(pos / 2);
console.log("position in layer 5:", pos);
console.log("layers[5][pos]:", tree.layers[5][pos].toString().slice(0, 30));
console.log("MATCH at level 5:", h === tree.layers[5][pos]);

// Continue to root
for (let i = 5; i < TREE_DEPTH; i++) {
  const isRight = mp.pathIndices[i] === 1;
  const sibling = mp.pathElements[i];
  h = isRight ? hashPair(sibling, h) : hashPair(h, sibling);
}
console.log("final computed root:", h.toString().slice(0, 40));
console.log("tree root:", tree.root.toString().slice(0, 40));
console.log("MATCH:", h === tree.root);
