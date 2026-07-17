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

function isCircuitsDir(dir: string): boolean {
  return (
    existsSync(join(dir, MANIFEST_REL)) ||
    existsSync(join(dir, "prover", "credential_V1_final.zkey"))
  );
}

/**
 * Locate the `circuits/` directory that holds the prover artifacts.
 * Honors AGENTIX_CIRCUITS_DIR, then walks up from __dirname looking for a
 * `circuits/` subdir, then checks a few packaged fallbacks. Returns the
 * resolved circuits dir (may not exist — callers validate via verifyArtifacts).
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

/** Reduce a value into the BN254 scalar field and return as decimal string. */
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
async function getPoseidon() {
  if (!_poseidon) {
    const circomlibjs = await import("circomlibjs");
    _poseidon = await circomlibjs.buildPoseidon();
  }
  return _poseidon;
}

/**
 * Compute the credential commitment exactly as the circuit does:
 *   Poseidon7(agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret)
 * Input ORDER must match the circuit's commitmentHash (credential_V1.circom:136-143).
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
 * Compute the nullifier exactly as the circuit does:
 *   Poseidon3(orgId, secret, sessionNonce)
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
 * Compute the revocation key as the circuit does:
 *   secretHash = Poseidon2(secret, 0); revocationKey = secretHash mod 2^64
 * (circuit: secretHashComp then TruncateToNBits(64))
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
 * Build the exact JSON object the circom witness calculator expects.
 * Every value is a decimal string (snarkjs/ffjavascript convention).
 * Arrays are length `depth` (20).
 */
export function buildWitnessInput(w: CredentialWitness): Record<string, any> {
  const depth = 20;
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

/** Verify the prover artifacts exist on disk. Returns descriptive errors. */
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

function sha256File(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

/** Load the artifact manifest if present. Returns null when absent/unparseable. */
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
 * Hash-verified preflight: confirm each artifact exists AND its sha256 + byte
 * length match the manifest. This is the guard that catches a corrupted,
 * truncated, or swapped zkey/wasm/vk BEFORE it silently produces a bogus proof.
 *
 * If no manifest is found, degrades to existence-only checks (manifestUsed=false)
 * so a monorepo without a manifest still functions — but a shipped package always
 * carries the manifest and gets full integrity enforcement.
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
 * Generate a real Groth16 proof from a witness.
 * Throws on witness-generation or proving failure.
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

/** Verify a Groth16 proof off-chain against the trusted verification key. */
export async function verifyLocally(p: Groth16Proof): Promise<boolean> {
  const art = verifyArtifacts();
  if (!art.ok) throw new Error(`VK missing: ${art.missing.join(", ")}`);
  const vk = JSON.parse(readFileSync(VK_PATH, "utf-8"));
  const sn = await snarkjs();
  return Boolean(await sn.groth16.verify(vk, p.publicSignals, p.proof));
}

/**
 * Convert a Groth16 proof into the calldata shape the on-chain verifier expects:
 *   verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[7] pubSignals)
 * Uses snarkjs.exportSolidityCallData then parses it into clean arrays.
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
