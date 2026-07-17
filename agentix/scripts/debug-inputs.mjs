/**
 * debug-inputs.mjs — Determine which version of the circuit the .wasm expects.
 * Try the OLD test input format (5-input Poseidon) and the NEW format (7-input Poseidon).
 */
import { readFileSync } from "fs";
import { join, resolve } from "path";

// Load the witness calculator manually to inspect expected inputs
const wcSource = readFileSync(
  resolve("../circuits/prover/credential_V1_js/witness_calculator.js"),
  "utf-8"
);

// The witness calculator reads the .wasm and extracts input signal names.
// Let's just try generating a witness with each format.

// Format A: OLD (from credential.test.js) — Poseidon(5)
const inputOld = {
  agentId: "1",
  orgId: "1",
  permissions: "7",
  expiry: "2000000000",
  secret: "123456",
  sessionNonce: "999",
  activePathElements: Array(20).fill("0"),
  activePathIndices: Array(20).fill("0"),
  revokedSiblings: Array(20).fill("0"),
  revokedOldKey: "0",
  revokedOldValue: "0",
  revokedIsOld0: 1,
  activeRoot: "12345",  // dummy
  revokedRoot: "0",
  maxValue: "7",
  sessionExpiry: "1500000000",
};

// Format B: NEW (from current .circom) — Poseidon(7)
const inputNew = {
  agentId: "1",
  orgId: "1",
  budgetLimit: "1000000000000000000",
  expiry: "2000000000",
  secret: "123456",
  sessionNonce: "999",
  activePathElements: Array(20).fill("0"),
  activePathIndices: Array(20).fill("0"),
  revokedSiblings: Array(20).fill("0"),
  revokedOldKey: "0",
  revokedOldValue: "0",
  revokedIsOld0: 1,
  wallet: "619479359098348488038218215246396008468717671621",
  activeRoot: "12345",
  revokedRoot: "0",
  maxValue: "500000000000000000",
  sessionExpiry: "1500000000",
  credentialVersion: "1",
};

async function tryWitness(label, input) {
  try {
    const wc = require("../circuits/prover/credential_V1_js/witness_calculator.js");
    const buffer = readFileSync("../circuits/prover/credential_V1.wasm");
    const calc = await wc(buffer);
    await calc.calculateWTNSBin(input, 0);
    console.log(`✓ ${label}: witness generated (field names accepted)`);
    return true;
  } catch (e) {
    console.log(`✗ ${label}: ${e.message.split("\n")[0]}`);
    return false;
  }
}

console.log("=== Testing which circuit version the .wasm expects ===\n");
const oldOk = await tryWitness("OLD (permissions, no wallet, no credentialVersion)", inputOld);
const newOk = await tryWitness("NEW (budgetLimit, wallet, credentialVersion)", inputNew);

console.log("\nConclusion:", oldOk ? "WASM is OLD circuit (5-input Poseidon)" : "");
console.log("         ", newOk ? "WASM is NEW circuit (7-input Poseidon)" : "");
if (!oldOk && !newOk) console.log("         ", "NEITHER format accepted — investigate further");
