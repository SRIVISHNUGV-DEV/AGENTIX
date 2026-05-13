import fs from "fs"
import path from "path"
import { groth16 } from "snarkjs"

// FLAW 4 FIX: Graceful circuit fallback
// Circuit files are checked lazily at proof generation time, not at startup
// This allows the backend to start without circuit files installed

const CIRCUIT_WASM_PATH = path.resolve(
    __dirname,
    "../../../circuits/build/credential_js/credential.wasm"
)

// Cache for resolved paths - null until first proof generation
let circuitZkeyPath: string | null = null
let checkedCircuitFiles = false

function resolveZkeyPath(): string {
    const buildDir = path.resolve(__dirname, "../../../circuits/build")

    if (!fs.existsSync(buildDir)) {
        return ""
    }

    const zkey = fs.readdirSync(buildDir).find((file) => file.endsWith(".zkey"))

    if (!zkey) {
        return ""
    }

    return path.join(buildDir, zkey)
}

function checkCircuitFiles(): { wasm: boolean; zkey: boolean } {
    const wasmExists = fs.existsSync(CIRCUIT_WASM_PATH)

    if (!circuitZkeyPath) {
        circuitZkeyPath = resolveZkeyPath()
    }

    return {
        wasm: wasmExists,
        zkey: !!circuitZkeyPath
    }
}

export function isProverAvailable(): boolean {
    if (!checkedCircuitFiles) {
        const { wasm, zkey } = checkCircuitFiles()
        checkedCircuitFiles = true
        return wasm && zkey
    }
    return !!(circuitZkeyPath && fs.existsSync(CIRCUIT_WASM_PATH))
}

export function getProverStatus(): { available: boolean; wasmPath: string; zkeyPath: string | null } {
    return {
        available: isProverAvailable(),
        wasmPath: CIRCUIT_WASM_PATH,
        zkeyPath: circuitZkeyPath
    }
}

export async function generateProof(db: any, input: any) {
    // Check circuit files lazily when proof is requested
    const { wasm, zkey } = checkCircuitFiles()

    if (!wasm) {
        throw new Error(`Circuit WASM file not found at ${CIRCUIT_WASM_PATH}. Run 'npm run build' in circuits/ directory.`)
    }

    if (!zkey || !circuitZkeyPath) {
        throw new Error(`No .zkey file found. Run 'npm run build' in circuits/ directory to generate proving key.`)
    }

    const cacheKey = JSON.stringify(input)

    const cached = await db.get(
        `
        SELECT *
        FROM proof_cache
        WHERE key = $1 AND expires_at > EXTRACT(EPOCH FROM NOW())::INTEGER
        `,
        cacheKey
    )

    if (cached) {
        return {
            proof: JSON.parse(cached.proof),
            publicSignals: JSON.parse(cached.public_signals)
        }
    }

    const { proof, publicSignals } =
        await groth16.fullProve(
            input,
            CIRCUIT_WASM_PATH,
            circuitZkeyPath
        )

    await db.run(
        `
        INSERT INTO proof_cache
        (key, proof, public_signals, created_at, expires_at)
        VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW())::INTEGER, EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::INTEGER)
        `,
        cacheKey,
        JSON.stringify(proof),
        JSON.stringify(publicSignals)
    )

    return { proof, publicSignals }
}
