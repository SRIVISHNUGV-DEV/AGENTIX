/**
 * zk-prover.ts — Real Groth16 proof generation for the credential_V1 circuit.
 *
 * This is the core of the ZK credential system. It takes a credential + its
 * Merkle/SMT proofs and produces a real Groth16 proof that verifies on-chain
 * against the deployed Groth16Verifier contract.
 *
 * Circuit: credential_V1.circom (depth-20 Merkle + SMT revocation, Poseidon hashes)
 * Public signals order (verified against verification_key.json, nPublic=7):
 *   [0] activeRoot      [1] revokedRoot     [2] maxValue
 *   [3] sessionExpiry   [4] wallet          [5] credentialVersion (=1)
 *   [6] nullifier (circuit OUTPUT, appended by snarkjs)
 *
 * Never trust a keccak-of-JSON. This module proves in BN254.
 */

import { readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { createHash } from "crypto";
import { logger } from "./logger";

// snarkjs ships as ESM/CJS; dynamic import keeps us robust to both
let _snarkjs: any = null;
/**
 * Lazily load snarkjs (ESM/CJS-safe dynamic import) and cache it for the process.
 * The proving library is big and only needed for proof work, so it is never loaded at module import time.
 * @returns The snarkjs module (same cached object on repeat calls).
 * @throws Throws when snarkjs cannot be imported (missing dependency).
 * Maps to: internal — prove / verifyLocally / formatCalldata (all Groth16 operations).
 * Side effects: caches the module in module memory on first call.
 */
async function snarkjs(): Promise<any> {
  if (!_snarkjs) {
    // @ts-ignore - snarkjs has no bundled type declarations
    _snarkjs = await import("snarkjs");
  }
  return _snarkjs;
}

// ─── Artifact resolution ──────────────────────────────────────────────────────
// Circuit artifacts must be locatable in three deployment shapes:
//   1. Monorepo dev (tsx):    <repo>/circuits/{prover,build}
//   2. Compiled dist:         <repo>/dist/src/core → walk up to <repo>/circuits
//   3. Standalone install:    artifacts bundled next to the package, or supplied
//                             via the AGENTIX_CIRCUITS_DIR env var.
// A `circuits/` dir is identified by the presence of the artifacts manifest OR
// the final zkey. Resolution order: env override → walk-up → packaged fallback.
const MANIFEST_REL = "artifacts.manifest.json";

/**
 * Check whether a directory holds circuit artifacts (manifest present, or the final zkey).
 * The directory-recognition test behind artifact resolution: a folder is a circuits dir iff it can prove.
 * @param dir — the candidate directory; non-existent paths return false.
 * @returns True when the manifest or the final zkey exists inside.
 * @throws Never throws.
 * Maps to: internal — findCircuitsDir (candidate testing).
 */
function isCircuitsDir(dir: string): boolean {
  return (
    existsSync(join(dir, MANIFEST_REL)) ||
    existsSync(join(dir, "prover", "credential_V1_final.zkey"))
  );
}

/**
 * Locate the circuits/ directory holding the prover artifacts.
 * Resolution order: AGENTIX_CIRCUITS_DIR, walk-up from __dirname, then packaged fallbacks; a wrong env dir warns and falls through.
 * @returns The resolved circuits dir — which may not exist; callers must validate via verifyArtifacts.
 * @throws Never throws — the last resort is a conventional path, not an error.
 * Maps to: internal — module artifact paths (ZKEY_PATH / WASM_PATH / VK_PATH / MANIFEST_PATH).
 * Side effects: logs a warning when an explicit AGENTIX_CIRCUITS_DIR contains no artifacts.
 */
function findCircuitsDir(): string {
  // 1. Explicit override — highest priority, for standalone/CI deployments.
  const envDir = process.env.AGENTIX_CIRCUITS_DIR;
  if (envDir) {
    const abs = resolve(envDir);
    if (isCircuitsDir(abs)) return abs;
    logger.warn(
      "zk-prover",
      `AGENTIX_CIRCUITS_DIR=${envDir} does not contain circuit artifacts; falling back to auto-detect.`
    );
  }

  // 2. Walk up from __dirname looking for a sibling `circuits/` dir.
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "circuits");
    if (isCircuitsDir(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // 3. Packaged fallbacks: artifacts shipped alongside the bundle.
  const fallbacks = [
    join(__dirname, "circuits"),
    join(__dirname, "..", "circuits"),
    join(__dirname, "..", "..", "circuits"),
    resolve(__dirname, "..", "..", "..", "circuits"),
  ];
  for (const f of fallbacks) {
    if (isCircuitsDir(f)) return f;
  }

  // Last resort: assume two levels up from src/core (monorepo layout) so the
  // error messages point at the conventional location.
  return resolve(__dirname, "..", "..", "..", "circuits");
}

const CIRCUITS_DIR = findCircuitsDir();
export const MANIFEST_PATH = join(CIRCUITS_DIR, MANIFEST_REL);
export const ZKEY_PATH = join(CIRCUITS_DIR, "prover", "credential_V1_final.zkey");
export const WASM_PATH = join(CIRCUITS_DIR, "prover", "credential_V1_js", "credential_V1.wasm");
export const VK_PATH = join(CIRCUITS_DIR, "build", "verification_key.json");

// Backwards-compat: some modules import REPO_ROOT. It's the parent of circuits/.
const REPO_ROOT = resolve(CIRCUITS_DIR, "..");

// ─── Field-element helpers (BN254, must be decimal strings for snarkjs) ───────
const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Reduce a value into the BN254 scalar field and return it as a decimal string.
 * snarkjs/ffjavascript require field elements as decimal strings; negative inputs wrap into range.
 * @param v — bigint, decimal string, or number; hex strings and non-numeric input throw from BigInt().
 * @returns The field element as a decimal string in [0, FIELD_PRIME).
 * @throws Throws when the input cannot be parsed as a bigint.
 * Maps to: internal — buildWitnessInput (every witness value is reduced through this).
 */
export function fe(v: bigint | string | number): string {
  const b = typeof v === "bigint" ? v : BigInt(v);
  return ((((b % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME)).toString();
}

const MASK_64 = (1n << 64n) - 1n;
const MASK_128 = (1n << 128n) - 1n;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CredentialWitness {
  // Private scalar inputs
  agentId: bigint;
  orgId: bigint;
  budgetLimit: bigint;
  expiry: bigint;
  secret: bigint;
  sessionNonce: bigint;
  // Active tree membership proof
  activePathElements: bigint[]; // length = depth (20)
  activePathIndices: bigint[];  // length = depth (20), each 0 or 1
  // Revoked SMT non-membership proof
  revokedSiblings: bigint[];    // length = depth (20)
  revokedOldKey: bigint;
  revokedOldValue: bigint;
  revokedIsOld0: bigint;        // 0 or 1
  // Public inputs (also echoed in publicSignals)
  wallet: bigint;
  activeRoot: bigint;
  revokedRoot: bigint;
  maxValue: bigint;
  sessionExpiry: bigint;
  credentialVersion: bigint;    // MUST be 1
}

export interface Groth16Proof {
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
    protocol?: string;
    curve?: string;
  };
  publicSignals: string[]; // length 7
}

export interface SolidityCalldata {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[]; // length 7
}

export interface ProveOptions {
  /** Skip the local snarkjs verification step (faster, less safe). */
  skipLocalVerify?: boolean;
  /** Skip the hash-verified artifact integrity preflight (falls back to existence-only). */
  skipIntegrityCheck?: boolean;
}

// ─── Poseidon helper (for computing commitment / nullifier off-circuit) ───────
let _poseidon: any = null;
/**
 * Lazily build the circomlibjs Poseidon hasher and cache it for the process.
 * Poseidon is needed for off-circuit commitment/nullifier computation; building it is expensive, so it happens once.
 * @returns The Poseidon instance (with its field object F).
 * @throws Throws when circomlibjs cannot be imported or the hasher cannot be built.
 * Maps to: internal — computeCommitment / computeNullifier / computeRevocationKey.
 * Side effects: caches the hasher in module memory on first call.
 */
async function getPoseidon() {
  if (!_poseidon) {
    const circomlibjs = await import("circomlibjs");
    _poseidon = await circomlibjs.buildPoseidon();
  }
  return _poseidon;
}

/**
 * Compute the credential commitment exactly as the circuit does: Poseidon7(agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret).
 * Input ORDER must match the circuit's commitmentHash — reordering silently produces a commitment the circuit will never accept.
 * @param params — the seven inputs; credentialVersion defaults to 1n when omitted.
 * @returns The commitment as a bigint.
 * @throws Throws when Poseidon cannot be built.
 * Maps to: contract CredentialRegistry — credential commitment (Merkle leaf; see src/tools/credential.ts).
 */
export async function computeCommitment(params: {
  agentId: bigint;
  orgId: bigint;
  budgetLimit: bigint;
  wallet: bigint;
  expiry: bigint;
  credentialVersion?: bigint;
  secret: bigint;
}): Promise<bigint> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  const v = params.credentialVersion ?? 1n;
  const inputs = [
    F.e(params.agentId.toString()),
    F.e(params.orgId.toString()),
    F.e(params.budgetLimit.toString()),
    F.e(params.wallet.toString()),
    F.e(params.expiry.toString()),
    F.e(v.toString()),
    F.e(params.secret.toString()),
  ];
  // circomlibjs poseidon takes inputs as ONE array arg (poseidon(inputs, initState, nOut)).
  // Spreading would mis-bind and diverge from the circuit's Poseidon.
  return BigInt(F.toString(poseidon(inputs)));
}

/**
 * Compute the nullifier exactly as the circuit does: Poseidon3(orgId, secret, sessionNonce).
 * The nullifier is the circuit's public output and the double-spend marker: the same credential + nonce always yields the same nullifier.
 * @param orgId — the organization; `secret` — the credential secret; `sessionNonce` — the per-session nonce.
 * @returns The nullifier as a bigint.
 * @throws Throws when Poseidon cannot be built.
 * Maps to: contract CredentialRegistry — nullifier (checked by MCP tool agentix_cred_verify).
 */
export async function computeNullifier(orgId: bigint, secret: bigint, sessionNonce: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  const inputs = [
    F.e(orgId.toString()),
    F.e(secret.toString()),
    F.e(sessionNonce.toString()),
  ];
  // Array-arg form (canonical). See computeCommitment note.
  return BigInt(F.toString(poseidon(inputs)));
}

/**
 * Compute the revocation key as the circuit does: Poseidon2(secret, 0), truncated to 64 bits.
 * The key indexes the revocation SMT: a credential is revoked when its key is present in the revoked tree.
 * @param secret — the credential secret.
 * @returns secretHash mod 2^64 as a bigint.
 * @throws Throws when Poseidon cannot be built.
 * Maps to: contract CredentialRegistry — revocation SMT key (see src/tools/credential.ts).
 */
export async function computeRevocationKey(secret: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  // Array-arg form (canonical). Spreading (F.e(secret), F.e("0")) mis-binds the
  // 2nd input as initState — this is the n=2 case that diverges from the circuit.
  const secretHash = BigInt(F.toString(poseidon([F.e(secret.toString()), F.e("0")])));
  return secretHash & MASK_64;
}

// ─── Witness input assembly ───────────────────────────────────────────────────
/**
 * Build the exact JSON object the circom witness calculator expects from a typed witness.
 * Every value is a decimal string and the three proof arrays must be exactly depth 20; bounds the circuit enforces are pre-checked here for a clear error instead of a wasm crash.
 * @param w — the full witness; credentialVersion must be 1, arrays length 20, values within their bit bounds.
 * @returns The witness input record for snarkjs fullProve.
 * @throws Throws on a wrong-length array, a negative value, or a value over its bit bound.
 * Maps to: internal — prove (witness assembly before fullProve).
 */
export function buildWitnessInput(w: CredentialWitness): Record<string, any> {
  const depth = 20;
  /**
   * Assert one witness array has exactly the circuit depth (20).
   * A wrong-length proof path would otherwise fail deep inside wasm with an opaque error.
   * @param arr — the array to check; `name` — used in the error message.
   * @returns Nothing on success.
   * @throws Throws `<name> must have length 20, got <n>` on mismatch.
   * Maps to: internal — buildWitnessInput (validates activePathElements / activePathIndices / revokedSiblings).
   */
  const assertLen = (arr: bigint[], name: string) => {
    if (arr.length !== depth) {
      throw new Error(`${name} must have length ${depth}, got ${arr.length}`);
    }
  };
  assertLen(w.activePathElements, "activePathElements");
  assertLen(w.activePathIndices, "activePathIndices");
  assertLen(w.revokedSiblings, "revokedSiblings");

  // Sanity: bound checks that the circuit enforces via Num2Bits. Catch bad
  // inputs early with a clear error instead of a wasm witness-generation crash.
  const bounds: Array<[string, bigint, bigint]> = [
    ["agentId", w.agentId, MASK_128],
    ["orgId", w.orgId, MASK_128],
    ["budgetLimit", w.budgetLimit, MASK_128],
    ["maxValue", w.maxValue, MASK_128],
    ["expiry", w.expiry, (1n << 64n) - 1n],
    ["sessionExpiry", w.sessionExpiry, (1n << 64n) - 1n],
    ["sessionNonce", w.sessionNonce, (1n << 64n) - 1n],
    ["wallet", w.wallet, (1n << 160n) - 1n],
    ["credentialVersion", w.credentialVersion, (1n << 16n) - 1n],
  ];
  for (const [name, val, max] of bounds) {
    if (val < 0n) throw new Error(`${name} is negative: ${val}`);
    if (val > max) throw new Error(`${name} exceeds ${name} bit bound (${val} > ${max})`);
  }

  return {
    agentId: fe(w.agentId),
    orgId: fe(w.orgId),
    budgetLimit: fe(w.budgetLimit),
    expiry: fe(w.expiry),
    secret: fe(w.secret),
    sessionNonce: fe(w.sessionNonce),
    activePathElements: w.activePathElements.map((e) => fe(e)),
    activePathIndices: w.activePathIndices.map((e) => fe(e)),
    revokedSiblings: w.revokedSiblings.map((e) => fe(e)),
    revokedOldKey: fe(w.revokedOldKey),
    revokedOldValue: fe(w.revokedOldValue),
    revokedIsOld0: fe(w.revokedIsOld0),
    // Public inputs
    wallet: fe(w.wallet),
    activeRoot: fe(w.activeRoot),
    revokedRoot: fe(w.revokedRoot),
    maxValue: fe(w.maxValue),
    sessionExpiry: fe(w.sessionExpiry),
    credentialVersion: fe(w.credentialVersion),
  };
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Check that the three prover artifacts (zkey, wasm, verification key) exist on disk.
 * Existence-only preflight: for hash verification use verifyIntegrity instead.
 * @returns { ok, missing } — ok is true only when all three exist; missing lists "key: full-path" entries.
 * @throws Never throws — missing files are reported, not raised.
 * Maps to: internal — prove (existence fallback) and REST diagnostics (artifact status).
 */
export function verifyArtifacts(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!existsSync(ZKEY_PATH)) missing.push(`zkey: ${ZKEY_PATH}`);
  if (!existsSync(WASM_PATH)) missing.push(`wasm: ${WASM_PATH}`);
  if (!existsSync(VK_PATH)) missing.push(`vk: ${VK_PATH}`);
  return { ok: missing.length === 0, missing };
}

// ─── Integrity verification (hash-verified preflight) ─────────────────────────
export interface ArtifactManifest {
  circuit: string;
  protocol: string;
  curve: string;
  nPublic: number;
  publicSignals: string[];
  merkleDepth: number;
  generatedAt: string;
  artifacts: Record<string, { relPath: string; sha256: string; bytes: number }>;
}

export interface IntegrityResult {
  ok: boolean;
  /** Per-artifact status. status: "ok" | "missing" | "hash-mismatch" | "size-mismatch" */
  checks: Array<{
    name: string;
    path: string;
    status: "ok" | "missing" | "hash-mismatch" | "size-mismatch";
    expected?: string;
    actual?: string;
  }>;
  /** True when a manifest was found and used; false means existence-only fallback. */
  manifestUsed: boolean;
  errors: string[];
}

/**
 * Hash a file's full contents with SHA-256 and return the hex digest.
 * The integrity primitive: a single changed byte in a zkey must change the digest.
 * @param path — the file to hash; a missing file throws from readFileSync (callers check existence first).
 * @returns The lowercase hex digest.
 * @throws Throws on unreadable/missing files.
 * Maps to: internal — verifyIntegrity (artifact hash check).
 */
function sha256File(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

/**
 * Load the artifact manifest (expected hashes/sizes) when present.
 * Without a manifest, integrity checks degrade to existence-only — the manifest is what makes them hash-verified.
 * @returns The parsed manifest, or null when absent or unparseable (a warning is logged on parse failure).
 * @throws Never throws — parse failures return null.
 * Maps to: internal — verifyIntegrity (manifest source) and REST diagnostics.
 */
export function loadManifest(): ArtifactManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as ArtifactManifest;
  } catch (e: any) {
    logger.warn("zk-prover", `Failed to parse artifact manifest at ${MANIFEST_PATH}: ${e?.message}`);
    return null;
  }
}

/**
 * Hash-verify every artifact against the manifest (size first, then SHA-256).
 * The guard that catches a corrupted, truncated, or swapped zkey/wasm/vk BEFORE it silently produces a bogus proof.
 * @returns { ok, checks, manifestUsed, errors } — manifestUsed is false when no manifest exists (existence-only fallback).
 * @throws Never throws — every failure is a checks entry / error string.
 * Maps to: internal — prove (preflight gate) and REST diagnostics.
 * Security: a hash mismatch means the proving key is untrusted — prove() refuses to run on it.
 */
export function verifyIntegrity(): IntegrityResult {
  const manifest = loadManifest();
  const pathByKey: Record<string, string> = {
    zkey: ZKEY_PATH,
    wasm: WASM_PATH,
    vkey: VK_PATH,
  };

  if (!manifest) {
    // Fallback: existence-only. Still report clearly that integrity was NOT checked.
    const base = verifyArtifacts();
    return {
      ok: base.ok,
      manifestUsed: false,
      errors: base.ok ? [] : base.missing.map((m) => `missing artifact — ${m}`),
      checks: Object.entries(pathByKey).map(([name, p]) => ({
        name,
        path: p,
        status: existsSync(p) ? ("ok" as const) : ("missing" as const),
      })),
    };
  }

  const checks: IntegrityResult["checks"] = [];
  const errors: string[] = [];

  for (const [name, meta] of Object.entries(manifest.artifacts)) {
    const p = pathByKey[name];
    if (!p) continue; // manifest lists an artifact we don't track — ignore
    if (!existsSync(p)) {
      checks.push({ name, path: p, status: "missing" });
      errors.push(`missing artifact ${name}: ${p}`);
      continue;
    }
    // Size check first (cheap) — catches truncation without hashing.
    const actualBytes = statSync(p).size;
    if (typeof meta.bytes === "number" && actualBytes !== meta.bytes) {
      checks.push({
        name,
        path: p,
        status: "size-mismatch",
        expected: String(meta.bytes),
        actual: String(actualBytes),
      });
      errors.push(
        `size mismatch for ${name}: expected ${meta.bytes} bytes, got ${actualBytes} (${p})`
      );
      continue;
    }
    // Hash check (authoritative).
    const actualHash = sha256File(p);
    if (actualHash.toLowerCase() !== meta.sha256.toLowerCase()) {
      checks.push({
        name,
        path: p,
        status: "hash-mismatch",
        expected: meta.sha256,
        actual: actualHash,
      });
      errors.push(
        `sha256 mismatch for ${name}: artifact does not match manifest — refusing to prove (${p})`
      );
      continue;
    }
    checks.push({ name, path: p, status: "ok" });
  }

  return { ok: errors.length === 0, manifestUsed: true, errors, checks };
}

/**
 * Generate a real Groth16 proof for a credential witness (integrity preflight, then snarkjs fullProve, then local verification).
 * The core proving entry point: refuse to prove against unverified artifacts, and refuse to return a proof that does not verify locally.
 * @param witness — the full credential witness (see buildWitnessInput for bounds).
 * @param opts — skipLocalVerify / skipIntegrityCheck; both default to false and should stay false outside tests.
 * @returns { proof, publicSignals } — publicSignals has exactly 7 entries or the call throws.
 * @throws Throws on integrity failure, missing artifacts, witness/proving failure, a wrong public-signal count, or a failed local verification.
 * Maps to: contract Groth16Verifier.verifyProof (via formatCalldata) and src/tools/proof.ts.
 * Side effects: reads the zkey/wasm/vk from disk; logs proving time.
 */
export async function prove(
  witness: CredentialWitness,
  opts: ProveOptions = {}
): Promise<Groth16Proof> {
  // Hash-verified preflight: refuse to prove against corrupted/swapped artifacts.
  // Degrades to existence-only when no manifest is present (monorepo dev).
  if (!opts.skipIntegrityCheck) {
    const integ = verifyIntegrity();
    if (!integ.ok) {
      throw new Error(
        `ZK artifact integrity check FAILED — refusing to prove.\n` +
          integ.errors.map((e) => `  • ${e}`).join("\n") +
          `\nRegenerate artifacts (cd circuits && ...) or set AGENTIX_CIRCUITS_DIR to a valid bundle.`
      );
    }
    if (!integ.manifestUsed) {
      logger.warn(
        "zk-prover",
        "No artifact manifest found — proving with existence-only checks (integrity NOT verified)."
      );
    }
  } else {
    const art = verifyArtifacts();
    if (!art.ok) {
      throw new Error(
        `ZK proving artifacts missing: ${art.missing.join(", ")}. ` +
          `Run the circuit build (see circuits/prover) or set the artifact path.`
      );
    }
  }

  const input = buildWitnessInput(witness);
  const sn = await snarkjs();

  const t0 = Date.now();
  logger.info("zk-prover", "Generating Groth16 proof (this takes a few seconds)...");

  // fullProve(input, wasmPath, zkeyPath) → { proof, publicSignals }
  const { proof, publicSignals } = await sn.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
  const ms = Date.now() - t0;
  logger.info("zk-prover", `Proof generated in ${ms}ms; publicSignals.length=${publicSignals.length}`);

  if (!publicSignals || publicSignals.length !== 7) {
    throw new Error(
      `Expected 7 public signals, got ${publicSignals?.length ?? 0}. ` +
        `Circuit/VK mismatch — recompile circuit or check zkey.`
    );
  }

  if (!opts.skipLocalVerify) {
    const ok = await verifyLocally({ proof, publicSignals });
    if (!ok) {
      throw new Error(
        "Local Groth16 verification FAILED. The proof was generated but does not verify " +
          "against the verification key — witness/circuit mismatch."
      );
    }
    logger.info("zk-prover", "Local verification PASSED (off-chain).");
  }

  return { proof, publicSignals };
}

/**
 * Verify a Groth16 proof off-chain against the trusted verification key.
 * The safety net inside prove(): a proof that fails here is never handed to the chain.
 * @param p — the proof + public signals; the VK must exist on disk.
 * @returns True when snarkjs verification passes; false when it fails (not an exception).
 * @throws Throws when the verification key is missing.
 * Maps to: internal — prove (post-prove check) and src/tools/proof.ts (proof verification).
 */
export async function verifyLocally(p: Groth16Proof): Promise<boolean> {
  const art = verifyArtifacts();
  if (!art.ok) throw new Error(`VK missing: ${art.missing.join(", ")}`);
  const vk = JSON.parse(readFileSync(VK_PATH, "utf-8"));
  const sn = await snarkjs();
  return Boolean(await sn.groth16.verify(vk, p.publicSignals, p.proof));
}

/**
 * Convert a Groth16 proof into the calldata shape the on-chain verifier expects.
 * Parses snarkjs exportSolidityCallData output into clean a/b/c arrays plus the 7 public signals.
 * @param p — the proof + public signals.
 * @returns { a, b, c, publicSignals } for verifyProof(uint[2], uint[2][2], uint[2], uint[7]).
 * @throws Throws when the export yields fewer than 15 tokens (wrong proof shape).
 * Maps to: contract Groth16Verifier.verifyProof (on-chain verification calldata).
 */
export async function formatCalldata(p: Groth16Proof): Promise<SolidityCalldata> {
  const sn = await snarkjs();
  const raw: string = await sn.groth16.exportSolidityCallData(p.proof, p.publicSignals);
  // exportSolidityCallData returns a string like:
  //   "a0 a1, [[b00,b01],[b10,b11]], c0 c1, ps0 ps1 ... ps6"
  const tokens = raw
    .replace(/[\[\]]/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);

  // After stripping brackets/commas: a0 a1 b00 b01 b10 b11 c0 c1 ps0..ps6  (15 tokens)
  if (tokens.length < 15) {
    throw new Error(`Unexpected calldata token count: ${tokens.length}\nraw=${raw}`);
  }

  const a: [string, string] = [tokens[0], tokens[1]];
  const b: [[string, string], [string, string]] = [
    [tokens[2], tokens[3]],
    [tokens[4], tokens[5]],
  ];
  const c: [string, string] = [tokens[6], tokens[7]];
  const publicSignals = tokens.slice(8, 15);

  return { a, b, c, publicSignals };
}

export { REPO_ROOT };
