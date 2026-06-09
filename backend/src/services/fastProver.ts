import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { initDB } from "../db"
import os from "os"

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

function toWslPath(winPath: string): string {
  const match = /^(\w):\\(.*)$/.exec(winPath)
  if (!match) return winPath.replace(/\\/g, "/")
  const drive = match[1].toLowerCase()
  const rest = match[2].replace(/\\/g, "/")
  return `/mnt/${drive}/${rest}`
}

function checkRapidsnarkWSL(): boolean {
  try {
    execSync("wsl command -v rapidsnark", {
      timeout: 5000,
      stdio: "pipe",
      shell: "powershell",
    })
    return true
  } catch {
    return false
  }
}

export interface ProverBackend {
  name: string
  available(): boolean
  prove(input: ProverInput): Promise<ProofData>
}

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

const WSL_CACHE_DIR = "/tmp/agentix-circuits"
let beWslCacheReady = false

function ensureBackendWslCache(): void {
  if (beWslCacheReady) return
  if (!fs.existsSync(CIRCUIT_WASM_PATH) || !resolveZkey()) return

  try {
    execSync(`wsl test -f ${WSL_CACHE_DIR}/credential_final.zkey`, { timeout: 5000, stdio: "pipe", shell: "powershell" })
    execSync(`wsl test -f ${WSL_CACHE_DIR}/credential_js/credential.wasm`, { timeout: 5000, stdio: "pipe", shell: "powershell" })
    beWslCacheReady = true
    return
  } catch {}

  execSync(`wsl mkdir -p ${WSL_CACHE_DIR}/credential_js`, { timeout: 5000, stdio: "pipe", shell: "powershell" })
  const zkey = resolveZkey()
  execSync(`wsl cp "${toWslPath(CIRCUIT_WASM_PATH)}" ${WSL_CACHE_DIR}/credential_js/credential.wasm`, { timeout: 30000, stdio: "pipe", shell: "powershell" })
  if (zkey) execSync(`wsl cp "${toWslPath(zkey)}" ${WSL_CACHE_DIR}/credential_final.zkey`, { timeout: 30000, stdio: "pipe", shell: "powershell" })

  const wasmDir = path.dirname(CIRCUIT_WASM_PATH)
  for (const f of ["generate_witness.js", "witness_calculator.js"]) {
    const src = path.resolve(wasmDir, f)
    if (fs.existsSync(src)) {
      execSync(`wsl cp "${toWslPath(src)}" ${WSL_CACHE_DIR}/credential_js/${f}`, { timeout: 30000, stdio: "pipe", shell: "powershell" })
    }
  }

  beWslCacheReady = true
}

function createWslTempDir(): string {
  try {
    return execSync("wsl mktemp -d --tmpdir=/tmp agentix-XXXXX", {
      timeout: 5000, stdio: "pipe", shell: "powershell",
    }).toString().trim()
  } catch {
    const dir = `/tmp/agentix-${Date.now()}`
    execSync(`wsl mkdir -p "${dir}"`, { timeout: 5000, stdio: "pipe", shell: "powershell" })
    return dir
  }
}

export class RapidsnarkWSLProver implements ProverBackend {
  name = "rapidsnark-wsl"

  available(): boolean {
    if (!fs.existsSync(CIRCUIT_WASM_PATH) || !resolveZkey()) return false
    return checkRapidsnarkWSL()
  }

  async prove(input: ProverInput): Promise<ProofData> {
    const zkey = resolveZkey()
    if (!zkey) throw new Error("No .zkey file found")

    ensureBackendWslCache()

    const wslTmp = createWslTempDir()
    const tmpDir = path.resolve(os.tmpdir(), "rapidsnark_prover")
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const inputPath = path.resolve(tmpDir, `input_${Date.now()}.json`)
    fs.writeFileSync(inputPath, JSON.stringify(input), "utf-8")

    try {
      execSync(`wsl cp "${toWslPath(inputPath)}" "${wslTmp}/input.json"`, { timeout: 5000, stdio: "pipe", shell: "powershell" })

      execSync(
        `wsl node "${WSL_CACHE_DIR}/credential_js/generate_witness.js" "${WSL_CACHE_DIR}/credential_js/credential.wasm" "${wslTmp}/input.json" "${wslTmp}/witness.wtns"`,
        { timeout: 120000, stdio: "pipe", shell: "powershell" }
      )

      execSync(
        `wsl rapidsnark "${WSL_CACHE_DIR}/credential_final.zkey" "${wslTmp}/witness.wtns" "${wslTmp}/proof.json" "${wslTmp}/public.json"`,
        { timeout: 120000, stdio: "pipe", shell: "powershell" }
      )

      const proofData = JSON.parse(
        execSync(`wsl cat "${wslTmp}/proof.json"`, { timeout: 5000, stdio: "pipe", shell: "powershell" }).toString()
      )
      const pubData = JSON.parse(
        execSync(`wsl cat "${wslTmp}/public.json"`, { timeout: 5000, stdio: "pipe", shell: "powershell" }).toString()
      )

      return {
        proof: {
          pi_a: [
            proofData.pi_a[0]?.toString() ?? "0",
            proofData.pi_a[1]?.toString() ?? "0",
            proofData.pi_a[2]?.toString() ?? "1",
          ],
          pi_b: [
            [proofData.pi_b[0][0]?.toString() ?? "0", proofData.pi_b[0][1]?.toString() ?? "0"],
            [proofData.pi_b[1][0]?.toString() ?? "0", proofData.pi_b[1][1]?.toString() ?? "0"],
            [proofData.pi_b[2][0]?.toString() ?? "0", proofData.pi_b[2][1]?.toString() ?? "0"],
          ],
          pi_c: [
            proofData.pi_c[0]?.toString() ?? "0",
            proofData.pi_c[1]?.toString() ?? "0",
            proofData.pi_c[2]?.toString() ?? "1",
          ],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: pubData.map((s: any) => s.toString()),
      }
    } finally {
      execSync(`wsl rm -rf "${wslTmp}"`, { timeout: 5000, stdio: "pipe", shell: "powershell" })
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch {}
    }
  }
}

let cachedBackend: ProverBackend | null = null

export function getProverBackend(): ProverBackend {
  if (cachedBackend) return cachedBackend

  const mode = process.env.PROVER_MODE || "auto"

  if (mode === "rapidsnark" || mode === "auto") {
    const r = new RapidsnarkWSLProver()
    if (r.available()) {
      cachedBackend = r
      console.log("[fastProver] Using rapidsnark backend (WSL native, ~10x faster)")
      return cachedBackend
    }
    if (mode === "rapidsnark") {
      console.warn("[fastProver] rapidsnark WSL requested but unavailable; falling back to snarkjs")
    }
  }

  const s = new SnarkjsProver()
  if (s.available()) {
    cachedBackend = s
    console.log("[fastProver] Using snarkjs backend (pure JS)")
    return cachedBackend
  }

  throw new Error(
    "No prover backend available. Install circuit files (credential.wasm + .zkey) " +
    "in circuits/build/ or run rapidsnark in WSL."
  )
}

export function resetProverBackend(): void {
  cachedBackend = null
}

export function getProverStatus() {
  const wasm = fs.existsSync(CIRCUIT_WASM_PATH)
  const zkey = resolveZkey()
  const rapidsnark = checkRapidsnarkWSL()
  return {
    available: wasm && !!zkey,
    wasmPath: CIRCUIT_WASM_PATH,
    zkeyPath: zkey,
    rapidsnarkAvailable: rapidsnark,
    snarkjsAvailable: true,
  }
}

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
