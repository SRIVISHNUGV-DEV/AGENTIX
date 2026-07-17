/**
 * validate-zk.mjs — Standalone end-to-end validation of the ZK proving pipeline.
 *
 * Builds a valid witness from scratch (no DB, no chain):
 *   1. Pick a credential (agentId, orgId, budgetLimit, wallet, expiry, secret)
 *   2. Compute commitment = Poseidon7(...) exactly like the circuit
 *   3. Build a raw-leaf Merkle tree with that commitment, get path proof
 *   4. Build an SMT, get non-membership proof for the revocation key
 *   5. prove() → fullProve + local verify against the VK
 *
 * If this prints "PROOF VERIFIED", the prover + circuit + VK are wired correctly.
 * Run: node --experimental-vm-modules scripts/validate-zk.mjs  (or via tsx)
 */
import { ethers } from "ethers";
import {
  initMerkleCrypto,
  buildMerkleTreeRaw,
  getMerkleProof,
  hashPair,
  buildRevokedSmt,
  smtNonMembershipProof,
} from "../src/utils/merkle.ts";
import {
  computeCommitment,
  computeRevocationKey,
  computeNullifier,
  buildWitnessInput,
  prove,
  verifyArtifacts,
} from "../src/core/zk-prover.ts";

const TREE_DEPTH = 20;

async function main() {
  console.log("=== AgentIX ZK Pipeline Validator ===\n");

  // 0. Artifact check
  const art = verifyArtifacts();
  if (!art.ok) {
    console.error("❌ Missing artifacts:", art.missing);
    process.exit(1);
  }
  console.log("✓ Proving artifacts present\n");

  await initMerkleCrypto();

  // 1. Credential fields
  const agentId = 1n;
  const orgId = 1n;
  const budgetLimit = ethers.parseEther("1"); // 1 ETH budget
  const wallet = BigInt("0x6C826A49aD8447FD94d61f515013ea93066e94C5");
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now
  const secret = 0x1234567890abcdefn;
  const credentialVersion = 1n;

  console.log("Credential:");
  console.log("  agentId:", agentId.toString());
  console.log("  orgId:", orgId.toString());
  console.log("  wallet:", "0x" + wallet.toString(16));
  console.log("  budgetLimit (wei):", budgetLimit.toString());
  console.log("");

  // 2. Commitment
  const commitment = await computeCommitment({
    agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret,
  });
  console.log("✓ commitment:", commitment.toString().slice(0, 40) + "...");

  // 3. Active tree (raw-leaf: leaf = commitment directly)
  const leaves = new Map();
  const leafIndex = Number(commitment % (1n << BigInt(TREE_DEPTH)));
  leaves.set(BigInt(leafIndex), commitment);
  const tree = buildMerkleTreeRaw(leaves, TREE_DEPTH);
  const activeRoot = tree.root;
  const mp = getMerkleProof(tree.layers, leafIndex, TREE_DEPTH);
  console.log("✓ activeRoot:", activeRoot.toString().slice(0, 40) + "...");
  console.log("  leafIndex:", leafIndex, "proof depth:", mp.pathElements.length);

  // sanity: re-verify the merkle proof off-circuit
  // (pathIndices: 1 = right child, sibling on left)
  let cur = commitment;
  for (let i = 0; i < TREE_DEPTH; i++) {
    cur = mp.pathIndices[i] === 1
      ? hashPair(mp.pathElements[i], cur)
      : hashPair(cur, mp.pathElements[i]);
  }
  if (cur !== activeRoot) {
    console.error("❌ Merkle proof self-check FAILED");
    process.exit(1);
  }
  console.log("✓ Merkle proof self-check passed");

  // 4. Revoked SMT — empty tree (credential NOT revoked)
  const smt = await buildRevokedSmt();
  const revocationKey = await computeRevocationKey(secret);
  console.log("✓ revocationKey:", revocationKey.toString());
  const nmp = await smtNonMembershipProof(smt, revocationKey, TREE_DEPTH);
  console.log("✓ revokedRoot:", nmp.root.toString().slice(0, 40) + "...");
  console.log("  isOld0:", nmp.isOld0, "siblings non-zero:",
    nmp.siblings.filter((s) => s !== 0n).length);

  // 5. Session params (must satisfy circuit constraints: maxValue <= budgetLimit, sessionExpiry <= expiry)
  const maxValue = ethers.parseEther("0.5"); // 0.5 ETH <= 1 ETH budget
  const sessionExpiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1h < 1d
  const sessionNonce = BigInt(Math.floor(Date.now() / 1000));
  const nullifier = await computeNullifier(orgId, secret, sessionNonce);
  console.log("✓ nullifier:", nullifier.toString().slice(0, 40) + "...");

  // 6. Assemble witness
  const witnessInput = buildWitnessInput({
    agentId, orgId, budgetLimit, expiry, secret, sessionNonce,
    activePathElements: mp.pathElements,
    activePathIndices: mp.pathIndices.map((x) => BigInt(x)),
    revokedSiblings: nmp.siblings,
    revokedOldKey: nmp.oldKey,
    revokedOldValue: nmp.oldValue,
    revokedIsOld0: nmp.isOld0,
    wallet, activeRoot, revokedRoot: nmp.root,
    maxValue, sessionExpiry, credentialVersion,
  });
  console.log("\n✓ witness input assembled\n");

  // 7. Prove
  console.log("Generating Groth16 proof (may take 5-15s)...");
  const t0 = Date.now();
  const { proof, publicSignals } = await prove({
    agentId, orgId, budgetLimit, expiry, secret, sessionNonce,
    activePathElements: mp.pathElements,
    activePathIndices: mp.pathIndices.map((x) => BigInt(x)),
    revokedSiblings: nmp.siblings,
    revokedOldKey: nmp.oldKey,
    revokedOldValue: nmp.oldValue,
    revokedIsOld0: nmp.isOld0,
    wallet, activeRoot, revokedRoot: nmp.root,
    maxValue, sessionExpiry, credentialVersion,
  });
  const ms = Date.now() - t0;
  console.log(`\n✓ Proof generated in ${ms}ms`);
  console.log("  publicSignals (7):");
  console.log("    [0] activeRoot:", publicSignals[0].slice(0, 30) + "...");
  console.log("    [1] revokedRoot:", publicSignals[1]);
  console.log("    [2] maxValue:", publicSignals[2]);
  console.log("    [3] sessionExpiry:", publicSignals[3]);
  console.log("    [4] wallet:", publicSignals[4]);
  console.log("    [5] credentialVersion:", publicSignals[5]);
  console.log("    [6] nullifier:", publicSignals[6].slice(0, 30) + "...");

  // 8. Cross-check: computed nullifier must equal publicSignals[6]
  if (publicSignals[6] !== nullifier.toString()) {
    console.error("❌ NULLIFIER MISMATCH: computed", nullifier.toString(),
      "but circuit output", publicSignals[6]);
    process.exit(1);
  }
  console.log("\n✓ Nullifier cross-check PASSED");
  console.log("\n=== ✅ PROOF VERIFIED — ZK pipeline is correctly wired ===\n");
}

main().catch((e) => {
  console.error("\n❌ VALIDATION FAILED:", e.message);
  console.error(e.stack);
  process.exit(1);
});
