import crypto from "crypto"
import { poseidonHash } from "../utils/crypto"

// FLAW 7 FIX: Hash secret_hash before storage
// Use Poseidon hash with a unique storage salt to prevent rainbow table attacks
// Even if secret_hash is compromised, the actual secret cannot be recovered

// Storage salt - this is unique to the storage layer and different from circuit parameters
const STORAGE_SALT = BigInt("0x" + crypto.createHash("sha256").update("agentix_storage_salt_v1").digest("hex").slice(0, 16))

/*
Hash the secret for secure database storage.
Uses Poseidon hash with a storage salt to prevent rainbow table attacks.

IMPORTANT: The raw secretHash (which is poseidon(secret)) should NEVER be stored directly.
This function applies an additional hash layer for storage security.
*/
export function hashSecretForStorage(secretHash: bigint): bigint {
    // Double hash with salt: storage_hash = poseidon(salt, secret_hash)
    return poseidonHash([STORAGE_SALT, secretHash])
}

/*
Legacy function for transitional compatibility.
DEPRECATED: Use hashSecretForStorage for new code.
*/
export function hashSecret(secret: string) {
    return crypto
        .createHash("sha256")
        .update(secret)
        .digest("hex")
}

/*
Compute the Poseidon commitment used in the ZK circuit
commitment = Poseidon(agentId, orgId, permissions, expiry, secret)
*/
export function computeCommitment(
    agentId: bigint,
    orgId: bigint,
    permissions: bigint,
    expiry: bigint,
    secret: bigint
) {
    return poseidonHash([
        agentId,
        orgId,
        permissions,
        expiry,
        secret
    ])
}