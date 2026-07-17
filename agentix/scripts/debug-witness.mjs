import { initMerkleCrypto, buildMerkleTreeRaw, getMerkleProof } from "../src/utils/merkle.ts";
import { computeCommitment, computeRevocationKey, computeNullifier, buildWitnessInput } from "../src/core/zk-prover.ts";
import { buildRevokedSmt, smtNonMembershipProof } from "../src/utils/merkle.ts";
import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
import { resolve, join } from "path";

const ZKEY = resolve("../circuits/prover/credential_V1_final.zkey");
const WASM = resolve("../circuits/prover/credential_V1_js/credential_V1.wasm");

await initMerkleCrypto();

// Build credential
const agentId = 1n, orgId = 1n;
const budgetLimit = 1000000000000000000n;
const wallet = 0x6C826A49aD8447FD94d61f515013ea93066e94C5n;
const expiry = BigInt(Math.floor(Date.now()/1000)+86400);
const secret = 0x1234567890abcdefn;
const credentialVersion = 1n;

const commitment = await computeCommitment({ agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret });
console.log("commitment:", commitment.toString());

// Active tree
const depth = 20;
const leafIndex = Number(commitment % (1n << BigInt(depth)));
const leaves = new Map([[BigInt(leafIndex), commitment]]);
const tree = buildMerkleTreeRaw(leaves, depth);
const activeRoot = tree.root;
const mp = getMerkleProof(tree.layers, leafIndex, depth);
console.log("activeRoot:", activeRoot.toString());
console.log("leafIndex:", leafIndex);
console.log("pathIndices sample:", mp.pathIndices.slice(0,5));
console.log("pathElements[0]:", mp.pathElements[0].toString(), "(should be 0 for empty sibling)");
console.log("pathElements[1]:", mp.pathElements[1].toString());

// Revoked SMT (empty)
const smt = await buildRevokedSmt();
const revocationKey = await computeRevocationKey(secret);
console.log("revocationKey:", revocationKey.toString());
const nmp = await smtNonMembershipProof(smt, revocationKey, depth);
console.log("revokedRoot:", nmp.root.toString());
console.log("isOld0:", nmp.isOld0);

// Session
const maxValue = 500000000000000000n;
const sessionExpiry = BigInt(Math.floor(Date.now()/1000)+3600);
const sessionNonce = BigInt(Math.floor(Date.now()/1000));

// Expected nullifier
const expectedNullifier = await computeNullifier(orgId, secret, sessionNonce);
console.log("expectedNullifier:", expectedNullifier.toString());

// Build witness input
const input = buildWitnessInput({
  agentId, orgId, budgetLimit, expiry, secret, sessionNonce,
  activePathElements: mp.pathElements,
  activePathIndices: mp.pathIndices.map(x => BigInt(x)),
  revokedSiblings: nmp.siblings,
  revokedOldKey: nmp.oldKey,
  revokedOldValue: nmp.oldValue,
  revokedIsOld0: nmp.isOld0,
  wallet, activeRoot, revokedRoot: nmp.root,
  maxValue, sessionExpiry, credentialVersion,
});

// Print witness for inspection
console.log("\n=== WITNESS INPUT ===");
console.log("agentId:", input.agentId);
console.log("orgId:", input.orgId);
console.log("budgetLimit:", input.budgetLimit);
console.log("expiry:", input.expiry);
console.log("secret:", input.secret);
console.log("sessionNonce:", input.sessionNonce);
console.log("wallet:", input.wallet);
console.log("activeRoot:", input.activeRoot);
console.log("revokedRoot:", input.revokedRoot);
console.log("maxValue:", input.maxValue);
console.log("sessionExpiry:", input.sessionExpiry);
console.log("credentialVersion:", input.credentialVersion);
console.log("activePathIndices[0..4]:", input.activePathIndices.slice(0,5));
console.log("activePathElements[0..4]:", input.activePathElements.slice(0,5));
console.log("revokedSiblings[0..4]:", input.revokedSiblings.slice(0,5));
console.log("revokedOldKey:", input.revokedOldKey);
console.log("revokedOldValue:", input.revokedOldValue);
console.log("revokedIsOld0:", input.revokedIsOld0);

// Generate witness only (not full proof)
console.log("\nGenerating witness...");
const { wtns: wtnsBuffer } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
console.log("Witness generated successfully");

// The public signals from the proof
const { publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
console.log("\n=== CIRCUIT PUBLIC SIGNALS ===");
console.log("[0] activeRoot:", publicSignals[0].slice(0,40) + "...");
console.log("[1] revokedRoot:", publicSignals[1]);
console.log("[2] maxValue:", publicSignals[2]);
console.log("[3] sessionExpiry:", publicSignals[3]);
console.log("[4] wallet:", publicSignals[4]);
console.log("[5] credentialVersion:", publicSignals[5]);
console.log("[6] nullifier:", publicSignals[6].slice(0,40) + "...");

console.log("\n=== CROSS-CHECKS ===");
console.log("activeRoot match:", publicSignals[0] === activeRoot.toString());
console.log("nullifier match:", publicSignals[6] === expectedNullifier.toString());
