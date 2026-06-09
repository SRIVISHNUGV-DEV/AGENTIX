import { getProverBackend, getProverStatus as getFastProverStatus, generateProofWithCache } from "./fastProver"

export function isProverAvailable(): boolean {
    try {
        return getProverBackend().available()
    } catch {
        return false
    }
}

export function getProverStatus(): { available: boolean; wasmPath: string; zkeyPath: string | null } {
    const status = getFastProverStatus()
    return {
        available: status.available,
        wasmPath: status.wasmPath,
        zkeyPath: status.zkeyPath
    }
}

export async function generateProof(db: any, input: any) {
    return generateProofWithCache(input)
}
