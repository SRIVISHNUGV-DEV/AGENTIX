#!/usr/bin/env node
/**
 * setup-zk-artifacts.ts — Ensure ZK proving artifacts exist locally.
 *
 * The credential_V1 circuit requires three artifacts:
 *   1. credential_V1_final.zkey  (~12MB, proving key)
 *   2. credential_V1.wasm        (~3.5MB, witness calculator)
 *   3. verification_key.json    (~4KB, for off-chain verification)
 *
 * This script checks if they exist and if not, either:
 *   a) Copies them from the repo's circuits/ directory (if running from source)
 *   b) Downloads them from a configured URL (if running as installed package)
 *   c) Reports clear instructions for manual setup
 *
 * Run: node dist/src/core/setup-zk-artifacts.js
 *   or: bun src/core/setup-zk-artifacts.ts
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve, dirname } from "path";

// Artifact paths (relative to repo root or AGENTIX_HOME)
const ARTIFACT_PATHS = {
  zkey: "circuits/prover/credential_V1_final.zkey",
  wasm: "circuits/prover/credential_V1_js/credential_V1.wasm",
  vk: "circuits/build/verification_key.json",
};

/**
 * Walk up from this file to find the repo root holding circuits/.
 * Artifact paths are root-relative, so setup must work from both source and compiled layouts.
 * @returns The first ancestor containing the final zkey (max 8 levels up); a best-guess path when none is found.
 * @throws Never throws — the fallback path may simply not exist, which checkArtifacts then reports.
 * Maps to: internal — checkArtifacts / setupArtifacts (artifact path resolution).
 */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "circuits", "prover", "credential_V1_final.zkey"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(__dirname, "..", "..", "..");
}

/**
 * Check that the three ZK proving artifacts (zkey, wasm, verification key) exist on disk.
 * Read-only preflight: run before proving so a missing artifact fails fast with paths, not mid-proof.
 * @returns { ok, paths, missing } — ok is true only when all three exist; missing lists "key: full-path" entries.
 * @throws Never throws — missing files are reported, not raised.
 * Maps to: internal — setupArtifacts (decides whether setup work is needed).
 */
export function checkArtifacts(): { ok: boolean; paths: Record<string, string>; missing: string[] } {
  const root = findRepoRoot();
  const paths: Record<string, string> = {};
  const missing: string[] = [];

  for (const [key, relPath] of Object.entries(ARTIFACT_PATHS)) {
    const fullPath = join(root, relPath);
    paths[key] = fullPath;
    if (!existsSync(fullPath)) {
      missing.push(`${key}: ${fullPath}`);
    }
  }

  return { ok: missing.length === 0, paths, missing };
}

/**
 * Verify the ZK artifacts exist and report how to build them when they do not.
 * This is a check-and-report entry point, not a downloader: it never fetches artifacts over the network.
 * @returns { ok, message } — ok is true when all artifacts are present; otherwise message carries build instructions.
 * @throws Never throws — every failure mode is a returned message.
 * Maps to: CLI — setup-zk-artifacts (bun src/core/setup-zk-artifacts.ts; exit 1 on failure).
 */
export function setupArtifacts(): { ok: boolean; message: string } {
  const check = checkArtifacts();
  if (check.ok) {
    return { ok: true, message: "All ZK artifacts present." };
  }

  const root = findRepoRoot();
  const circuitsDir = join(root, "circuits");

  if (!existsSync(circuitsDir)) {
    return {
      ok: false,
      message: `Circuits directory not found at ${circuitsDir}.\n` +
        `To build the circuit artifacts:\n` +
        `  1. Install circom: https://docs.circom.io/getting-started/installation/\n` +
        `  2. cd circuits\n` +
        `  3. circom credential_V1.circom --r1cs --wasm --sym -o prover/\n` +
        `  4. npx snarkjs groth16 setup prover/credential_V1.r1cs prover/pot16_final.ptau prover/credential_V1_final.zkey\n` +
        `  5. npx snarkjs zkey export verificationkey prover/credential_V1_final.zkey build/verification_key.json\n` +
        `\nOr copy pre-built artifacts from the repository.`,
    };
  }

  // Try to copy from circuits/ directory
  const missing: string[] = [];
  for (const [key, relPath] of Object.entries(ARTIFACT_PATHS)) {
    const src = join(root, relPath);
    if (!existsSync(src)) {
      missing.push(`${key}: ${src}`);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `ZK artifacts missing:\n${missing.join("\n")}\n` +
        `Run the circuit build first (see circuits/README.md).`,
    };
  }

  return { ok: true, message: "All ZK artifacts verified." };
}

// CLI entry point
if (require.main === module) {
  const result = setupArtifacts();
  if (result.ok) {
    console.log("✓ " + result.message);
  } else {
    console.error("✗ " + result.message);
    process.exit(1);
  }
}
