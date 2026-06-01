import fs from "fs"
import path from "path"
import { initDB } from "../db"

export type ProverInput = {
  agentId: string
  orgId: string
  permissions: string
  expiry: string
  secret: string
  sessionNonce: string
  activePathElements: string[]
  activePathIndices: string[]
  revokedSiblings: string[]
  revokedOldKey: string
  revokedOldValue: string
  revokedIsOld0: number
  activeRoot: string
  revokedRoot: string
  maxValue: string
  sessionExpiry: string
}

export type ProofData = {
  proof: {
    pi_a: [string, string, string]
    pi_b: [[string, string], [string, string], [string, string]]
    pi_c: [string, string, string]
    protocol: "groth16"
    curve: string
  }
  publicSignals: string[]
}

const CIRCUIT_WASM_PATH = path.resolve(
  __dirname, "../../../circuits/build/credential_js/credential.wasm"
)
let resolvedZkeyPath: string | null = null

function resolveZkey(): string | null {
  if (resolvedZkeyPath) return resolvedZkeyPath
  const dir = path.resolve(__dirname, "../../../circuits/build")
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
  const z = files.find((f: string) => f.endsWith(".zkey"))
  resolvedZkeyPath = z ? path.join(dir, z) : null
  return resolvedZkeyPath
}

export interface ProverBackend {
  name: string
  available(): boolean
  prove(input: ProverInput): Promise<ProofData>
}

/** snarkjs-based prover (slower, pure JS, always available if circuit files exist) */
export class SnarkjsProver implements ProverBackend {
  name = "snarkjs"

  available(): boolean {
    return fs.existsSync(CIRCUIT_WASM_PATH) && !!resolveZkey()
  }

  async prove(input: ProverInput): Promise<ProofData> {
    const zkey = resolveZkey()
    if (!zkey) throw new Error("No .zkey file found")
    const { groth16 } = await import("snarkjs")
    const result = await groth16.fullProve(input, CIRCUIT_WASM_PATH, zkey)
    return {
      proof: result.proof as ProofData["proof"],
      publicSignals: result.publicSignals.map((s: any) => s.toString()),
    }
  }
}

/** rapidsnark-based prover (C++ native, ~10× faster) — optional dependency */
export class RapidsnarkProver implements ProverBackend {
  name = "rapidsnark"

  available(): boolean {
    try {
      const zkey = resolveZkey()
      if (!zkey || !fs.existsSync(CIRCUIT_WASM_PATH)) return false
      require.resolve("@iden3/rapidsnark")
      return true
    } catch {
      return false
    }
  }

  async prove(input: ProverInput): Promise<ProofData> {
    const zkey = resolveZkey()
    if (!zkey) throw new Error("No .zkey file found")

    let rapid: any
    try {
      rapid = require("@iden3/rapidsnark")
    } catch {
      throw new Error(
        "rapidsnark not installed. Run: npm install @iden3/rapidsnark"
      )
    }

    const wtns: Uint8Array = await rapid.groth16Prover(
      zkey, CIRCUIT_WASM_PATH, JSON.stringify(input)
    )

    const result = await rapid.groth16Prove(zkey, wtns)
    return {
      proof: result.proof as ProofData["proof"],
      publicSignals: result.publicSignals.map((s: any) => s.toString()),
    }
  }
}

let cachedBackend: ProverBackend | null = null

export function getProverBackend(): ProverBackend {
  if (cachedBackend) return cachedBackend

  const mode = process.env.PROVER_MODE || "auto"

  if (mode === "rapidsnark") {
    const r = new RapidsnarkProver()
    if (r.available()) {
      cachedBackend = r
      console.log("[fastProver] Using rapidsnark backend (C++ native)")
      return cachedBackend
    }
    console.warn("[fastProver] rapidsnark requested but unavailable; falling back to snarkjs")
  }

  // Always try snarkjs as fallback, regardless of mode
  const s = new SnarkjsProver()
  if (s.available()) {
    cachedBackend = s
    console.log("[fastProver] Using snarkjs backend (pure JS)")
    return cachedBackend
  }

  throw new Error(
    "No prover backend available. Install circuit files (credential.wasm + .zkey) " +
    "in circuits/build/ or set PROVER_MODE to configure."
  )
}

export function resetProverBackend(): void {
  cachedBackend = null
}

/**
 * Generate a proof, caching results in proof_cache for 24h.
 * If the queue is enabled, delegates to BullMQ; otherwise runs inline.
 */
export async function generateProofWithCache(
  input: ProverInput
): Promise<ProofData> {
  const db = await initDB()
  const cacheKey = JSON.stringify(input)

  const cached = await db.get(
    `SELECT * FROM proof_cache
     WHERE key = $1 AND expires_at > EXTRACT(EPOCH FROM NOW())::INTEGER`,
    cacheKey
  )
  if (cached) {
    return {
      proof: JSON.parse(cached.proof),
      publicSignals: JSON.parse(cached.public_signals),
    }
  }

  const backend = getProverBackend()
  const result = await backend.prove(input)

  await db.run(
    `INSERT INTO proof_cache (key, proof, public_signals, created_at, expires_at)
     VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW())::INTEGER,
             EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::INTEGER)`,
    cacheKey,
    JSON.stringify(result.proof),
    JSON.stringify(result.publicSignals)
  )

  return result
}
