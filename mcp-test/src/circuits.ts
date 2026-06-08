import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function resolveCircuitDir(): string | null {
  const packageDir = path.resolve(__dirname, "..", "circuits")
  if (fs.existsSync(packageDir)) return packageDir

  const envDir = process.env.CIRCUIT_DIR || process.env.CIRCUITS_DIR
  if (envDir && fs.existsSync(envDir)) return envDir

  const cwdDir = path.resolve(process.cwd(), "circuits", "build")
  if (fs.existsSync(cwdDir)) return cwdDir

  return null
}

const CIRCUIT_DIR = resolveCircuitDir()

let resolvedWasmPath = ""
let resolvedZkeyPath: string | null = null
let cachedStatus: { wasm: boolean; zkey: boolean } | null = null

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
  }
}

export async function generateProof(input: Record<string, unknown>): Promise<{
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string }
  publicSignals: string[]
}> {
  const { wasm, zkey } = checkCircuits()
  if (!wasm) throw new Error("Circuit WASM not found")
  if (!zkey || !resolvedZkeyPath) throw new Error("No .zkey file found")

  let groth16: any
  try {
    // @ts-expect-error — snarkjs is optional; caught gracefully at runtime
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
