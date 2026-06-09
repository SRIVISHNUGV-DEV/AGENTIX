import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.resolve(__dirname, "../..")
const WSL_CACHE_DIR = "/tmp/agentix-circuits"
let wslCacheReady = false

function resolveCircuitDir(): string | null {
  const candidates = [
    path.resolve(ROOT_DIR, "circuits", "build"),
    path.resolve(__dirname, "..", "circuits"),
    process.env.CIRCUIT_DIR || process.env.CIRCUITS_DIR || null,
    path.resolve(process.cwd(), "circuits", "build"),
  ].filter(Boolean) as string[]

  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir
  }
  return null
}

const CIRCUIT_DIR = resolveCircuitDir()

let resolvedWasmPath = ""
let resolvedZkeyPath: string | null = null
let cachedStatus: { wasm: boolean; zkey: boolean } | null = null
let rapidsnarkAvailable: boolean | null = null

function resolveWasm(): string {
  if (resolvedWasmPath) return resolvedWasmPath
  if (!CIRCUIT_DIR) return ""

  const jsDir = path.resolve(CIRCUIT_DIR, "credential_js")
  const wasmInJsDir = path.resolve(jsDir, "credential.wasm")
  if (fs.existsSync(wasmInJsDir)) {
    resolvedWasmPath = wasmInJsDir
    return resolvedWasmPath
  }

  const wasmFiles = fs.readdirSync(CIRCUIT_DIR).filter(f => f.endsWith(".wasm"))
  if (wasmFiles.length > 0) {
    resolvedWasmPath = path.resolve(CIRCUIT_DIR, wasmFiles[0])
    return resolvedWasmPath
  }

  return ""
}

function resolveZkey(): string | null {
  if (resolvedZkeyPath) return resolvedZkeyPath
  if (!CIRCUIT_DIR || !fs.existsSync(CIRCUIT_DIR)) return null
  const files = fs.readdirSync(CIRCUIT_DIR)
  const z = files.find(f => f.endsWith(".zkey"))
  resolvedZkeyPath = z ? path.join(CIRCUIT_DIR, z) : null
  return resolvedZkeyPath
}

function toWslPath(winPath: string): string {
  const match = /^(\w):\\(.*)$/.exec(winPath)
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`
  }
  const match2 = /^(\w):\/(.*)$/.exec(winPath)
  if (match2) {
    return `/mnt/${match2[1].toLowerCase()}/${match2[2]}`
  }
  return winPath.replace(/\\/g, "/")
}

function checkRapidsnarkWSL(): boolean {
  if (rapidsnarkAvailable !== null) return rapidsnarkAvailable
  try {
    execSync("wsl command -v rapidsnark", {
      timeout: 5000,
      stdio: "pipe",
    })
    rapidsnarkAvailable = true
  } catch {
    rapidsnarkAvailable = false
  }
  return rapidsnarkAvailable
}

function ensureWslCircuitCache(): void {
  if (wslCacheReady) return
  const wasm = resolvedWasmPath
  const zkey = resolvedZkeyPath
  if (!wasm || !zkey) return

  try {
    execSync(`wsl test -f ${WSL_CACHE_DIR}/credential_final.zkey`, { timeout: 5000, stdio: "pipe" })
    execSync(`wsl test -f ${WSL_CACHE_DIR}/credential_js/credential.wasm`, { timeout: 5000, stdio: "pipe" })
    wslCacheReady = true
    return
  } catch {}

  execSync(`wsl mkdir -p ${WSL_CACHE_DIR}/credential_js`, { timeout: 5000, stdio: "pipe" })
  execSync(`wsl cp "${toWslPath(zkey)}" ${WSL_CACHE_DIR}/credential_final.zkey`, { timeout: 30000, stdio: "pipe" })
  execSync(`wsl cp "${toWslPath(wasm)}" ${WSL_CACHE_DIR}/credential_js/credential.wasm`, { timeout: 30000, stdio: "pipe" })

  const jsDir = path.dirname(wasm)
  execSync(`wsl cp "${toWslPath(path.resolve(jsDir, "generate_witness.js"))}" ${WSL_CACHE_DIR}/credential_js/generate_witness.js`, { timeout: 30000, stdio: "pipe" })
  execSync(`wsl cp "${toWslPath(path.resolve(jsDir, "witness_calculator.js"))}" ${WSL_CACHE_DIR}/credential_js/witness_calculator.js`, { timeout: 30000, stdio: "pipe" })

  wslCacheReady = true
}

function createWslTempDir(): string {
  try {
    return execSync("wsl mktemp -d --tmpdir=/tmp agentix-XXXXX", {
      timeout: 5000, stdio: "pipe",
    }).toString().trim()
  } catch {
    const dir = `/tmp/agentix-${Date.now()}`
    execSync(`wsl mkdir -p "${dir}"`, { timeout: 5000, stdio: "pipe" })
    return dir
  }
}

export function checkCircuits(): { wasm: boolean; zkey: boolean } {
  if (cachedStatus) return cachedStatus
  if (!CIRCUIT_DIR) {
    cachedStatus = { wasm: false, zkey: false }
    return cachedStatus
  }
  const wasm = resolveWasm()
  const zkey = resolveZkey()
  cachedStatus = {
    wasm: !!wasm && fs.existsSync(wasm),
    zkey: !!zkey && fs.existsSync(zkey),
  }
  return cachedStatus
}

export function getProverStatus() {
  const { wasm, zkey } = checkCircuits()
  return {
    available: wasm && zkey,
    wasmPath: resolvedWasmPath || "(not found)",
    zkeyPath: resolvedZkeyPath,
    rapidsnarkWSL: checkRapidsnarkWSL(),
    circuitDir: CIRCUIT_DIR,
  }
}

async function proveWithRapidsnarkWSL(input: Record<string, unknown>): Promise<{
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string }
  publicSignals: string[]
}> {
  const zkey = resolvedZkeyPath
  if (!zkey) throw new Error("No .zkey file found")

  ensureWslCircuitCache()

  const wslTmp = createWslTempDir()
  const winTmp = path.resolve(__dirname, "..", "tmp", `input_${Date.now()}.json`)
  if (!fs.existsSync(path.dirname(winTmp))) fs.mkdirSync(path.dirname(winTmp), { recursive: true })
  fs.writeFileSync(winTmp, JSON.stringify(input), "utf-8")

  try {
    execSync(`wsl cp "${toWslPath(winTmp)}" "${wslTmp}/input.json"`, { timeout: 5000, stdio: "pipe" })

    execSync(
      `wsl node "${WSL_CACHE_DIR}/credential_js/generate_witness.js" "${WSL_CACHE_DIR}/credential_js/credential.wasm" "${wslTmp}/input.json" "${wslTmp}/witness.wtns"`,
      { timeout: 120000, stdio: "pipe" }
    )

    execSync(
      `wsl rapidsnark "${WSL_CACHE_DIR}/credential_final.zkey" "${wslTmp}/witness.wtns" "${wslTmp}/proof.json" "${wslTmp}/public.json"`,
      { timeout: 120000, stdio: "pipe" }
    )

    const proofData = JSON.parse(
      execSync(`wsl cat "${wslTmp}/proof.json"`, { timeout: 5000, stdio: "pipe" }).toString()
    )
    const pubData = JSON.parse(
      execSync(`wsl cat "${wslTmp}/public.json"`, { timeout: 5000, stdio: "pipe" }).toString()
    )

    return {
      proof: {
        pi_a: [proofData.pi_a[0], proofData.pi_a[1], proofData.pi_a[2] || "1"],
        pi_b: [
          [proofData.pi_b[0][0], proofData.pi_b[0][1]],
          [proofData.pi_b[1][0], proofData.pi_b[1][1]],
          [proofData.pi_b[2][0] || "0", proofData.pi_b[2][1] || "0"],
        ],
        pi_c: [proofData.pi_c[0], proofData.pi_c[1], proofData.pi_c[2] || "1"],
        protocol: "groth16",
        curve: "bn128",
      },
      publicSignals: pubData,
    }
  } finally {
    execSync(`wsl rm -rf "${wslTmp}"`, { timeout: 5000, stdio: "pipe" })
    try { if (fs.existsSync(winTmp)) fs.unlinkSync(winTmp) } catch {}
  }
}

export async function generateProof(input: Record<string, unknown>): Promise<{
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string }
  publicSignals: string[]
}> {
  const { wasm, zkey } = checkCircuits()
  if (!wasm) throw new Error("Circuit WASM not found")
  if (!zkey || !resolvedZkeyPath) throw new Error("No .zkey file found")

  if (checkRapidsnarkWSL()) {
    try {
      return await proveWithRapidsnarkWSL(input)
    } catch (err) {
      console.warn("[circuits] rapidsnark WSL failed, falling back to snarkjs:", err)
    }
  }

  let groth16: any
  try {
    groth16 = (await import("snarkjs")).groth16
  } catch {
    throw new Error("snarkjs is not installed. Run: npm install snarkjs")
  }

  const result = await groth16.fullProve(input, resolvedWasmPath, resolvedZkeyPath)
  return {
    proof: result.proof,
    publicSignals: result.publicSignals.map((s: unknown) => String(s)),
  }
}
