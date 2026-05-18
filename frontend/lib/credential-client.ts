/**
 * FLAW 1 FIX: Client-side credential generation
 *
 * The secret is generated client-side and NEVER sent to the backend.
 * Only the commitment and secret_hash are sent to the server.
 *
 * Flow:
 * 1. Client generates random secret
 * 2. Client computes commitment = poseidon(agentId, orgId, permissions, expiry, secret)
 * 3. Client computes secretHash = poseidon(secret, 0)
 * 4. Client sends { commitment, secretHash } to server
 * 5. Server stores commitment and hashed secretHash (never raw secret)
 */

import { buildPoseidon } from "circomlibjs"

// Browser-compatible random bytes
function getRandomBytes(length: number): Uint8Array {
    if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
        const bytes = new Uint8Array(length)
        window.crypto.getRandomValues(bytes)
        return bytes
    }
    throw new Error("Web Crypto API not available")
}

export interface CredentialInput {
    agentId: number
    orgId: number
    permissions: number
    expiry: number
}

export interface CredentialBundle {
    secret: bigint
    commitment: bigint
    secretHash: bigint
    // For server submission
    serverPayload: {
        agentId: number
        orgId: number
        permissions: number
        expiry: number
        commitment: string
        secretHash: string
    }
}

let poseidonInstance: any = null

async function getPoseidon() {
    if (!poseidonInstance) {
        poseidonInstance = await buildPoseidon()
    }
    return poseidonInstance
}

/**
 * Generate a new credential secret client-side
 * Returns the secret and derived values needed for submission
 */
export async function generateCredentialSecret(input: CredentialInput): Promise<CredentialBundle> {
    const poseidon = await getPoseidon()

    // Generate 31-byte random secret
    const secretBytes = getRandomBytes(31)
    const secret = BigInt("0x" + Array.from(secretBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join(""))

    // Compute commitment = poseidon(agentId, orgId, permissions, expiry, secret)
    const commitment = poseidon([
        BigInt(input.agentId),
        BigInt(input.orgId),
        BigInt(input.permissions),
        BigInt(input.expiry),
        secret
    ])
    const commitmentBigInt = BigInt(poseidon.F.toString(commitment))

    // Compute secretHash = poseidon(secret, 0)
    const secretHash = poseidon([secret, BigInt(0)])
    const secretHashBigInt = BigInt(poseidon.F.toString(secretHash))

    return {
        secret,
        commitment: commitmentBigInt,
        secretHash: secretHashBigInt,
        serverPayload: {
            agentId: input.agentId,
            orgId: input.orgId,
            permissions: input.permissions,
            expiry: input.expiry,
            commitment: commitmentBigInt.toString(),
            secretHash: secretHashBigInt.toString()
        }
    }
}

/**
 * Compute commitment from existing secret
 * Used when reusing a secret for multiple credentials
 */
export async function computeCommitment(
    input: CredentialInput,
    secret: bigint
): Promise<{ commitment: bigint; secretHash: bigint }> {
    const poseidon = await getPoseidon()

    const commitment = poseidon([
        BigInt(input.agentId),
        BigInt(input.orgId),
        BigInt(input.permissions),
        BigInt(input.expiry),
        secret
    ])

    const secretHash = poseidon([secret, BigInt(0)])

    return {
        commitment: BigInt(poseidon.F.toString(commitment)),
        secretHash: BigInt(poseidon.F.toString(secretHash))
    }
}

/**
 * Store credential locally for the user session
 * The secret is stored in localStorage (or a more secure option like IndexedDB)
 * WARNING: In production, use a more secure storage mechanism
 */
export function storeCredentialLocally(
    agentId: number,
    orgId: number,
    secret: bigint
): void {
    const key = `agentix_credential_${agentId}_${orgId}`
    const value = JSON.stringify({
        agentId,
        orgId,
        secret: secret.toString(),
        createdAt: Date.now()
    })

    // In production, use secure storage (IndexedDB with encryption)
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value)
    }
}

/**
 * Retrieve stored credential secret
 */
export function retrieveStoredCredential(
    agentId: number,
    orgId: number
): { secret: bigint; createdAt: number } | null {
    const key = `agentix_credential_${agentId}_${orgId}`

    if (typeof localStorage === "undefined") {
        return null
    }

    const value = localStorage.getItem(key)
    if (!value) {
        return null
    }

    try {
        const parsed = JSON.parse(value)
        return {
            secret: BigInt(parsed.secret),
            createdAt: parsed.createdAt
        }
    } catch {
        return null
    }
}

/**
 * Remove stored credential
 */
export function removeStoredCredential(agentId: number, orgId: number): void {
    const key = `agentix_credential_${agentId}_${orgId}`

    if (typeof localStorage !== "undefined") {
        localStorage.removeItem(key)
    }
}
