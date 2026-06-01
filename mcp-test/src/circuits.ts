import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CIRCUIT_WASM_PATH = path.resolve(
  __dirname, "../../circuits/build/credential_js/credential.wasm"
)

let resolvedZkeyPath: string | null = null
let cachedStatus: { wasm: boolean; zkey: boolean } | null = null

function resolveZkey(): string | null {
  if (resolvedZkeyPath) return resolvedZkeyPath
  const dir = path.resolve(__dirname, "../../circuits/build")
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
  const z = files.find((f) => f.endsWith(".zkey"))
  resolvedZkeyPath = z ? path.join(dir, z) : null
  return resolvedZkeyPath
}

export function checkCircuits(): { wasm: boolean; zkey: boolean } {
  if (cachedStatus) return cachedStatus
  const zkeyPath = resolveZkey()
  cachedStatus = {
    wasm: fs.existsSync(CIRCUIT_WASM_PATH),
    zkey: !!zkeyPath && fs.existsSync(zkeyPath),
  }
  return cachedStatus
}

export function getProverStatus() {
  const { wasm, zkey } = checkCircuits()
  return {
    available: wasm && zkey,
    wasmPath: CIRCUIT_WASM_PATH,
    zkeyPath: resolvedZkeyPath,
  }
}

export async function generateProof(input: Record<string, unknown>): Promise<{
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string }
  publicSignals: string[]
}> {
  const { wasm, zkey } = checkCircuits()
  if (!wasm) throw new Error(`Circuit WASM not found at ${CIRCUIT_WASM_PATH}`)
  if (!zkey || !resolvedZkeyPath) throw new Error("No .zkey file found in circuits/build/")

  // @ts-ignore — snarkjs may or may not be installed; checked lazily
  const { groth16 } = await import("snarkjs")
  const result = await groth16.fullProve(input, CIRCUIT_WASM_PATH, resolvedZkeyPath)

  return {
    proof: result.proof,
    publicSignals: result.publicSignals.map((s: unknown) => String(s)),
  }
}
