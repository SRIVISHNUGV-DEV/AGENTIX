"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashSecretForStorage = hashSecretForStorage;
exports.hashSecret = hashSecret;
exports.computeCommitment = computeCommitment;
const crypto_1 = __importDefault(require("crypto"));
const crypto_2 = require("../utils/crypto");
// FLAW 7 FIX: Hash secret_hash before storage
// Use Poseidon hash with a unique storage salt to prevent rainbow table attacks
// Even if secret_hash is compromised, the actual secret cannot be recovered
// Storage salt - this is unique to the storage layer and different from circuit parameters
const STORAGE_SALT = BigInt("0x" + crypto_1.default.createHash("sha256").update("agentix_storage_salt_v1").digest("hex").slice(0, 16));
/*
Hash the secret for secure database storage.
Uses Poseidon hash with a storage salt to prevent rainbow table attacks.

IMPORTANT: The raw secretHash (which is poseidon(secret)) should NEVER be stored directly.
This function applies an additional hash layer for storage security.
*/
function hashSecretForStorage(secretHash) {
    // Double hash with salt: storage_hash = poseidon(salt, secret_hash)
    return (0, crypto_2.poseidonHash)([STORAGE_SALT, secretHash]);
}
/*
Legacy function for transitional compatibility.
DEPRECATED: Use hashSecretForStorage for new code.
*/
function hashSecret(secret) {
    return crypto_1.default
        .createHash("sha256")
        .update(secret)
        .digest("hex");
}
/*
Compute the Poseidon commitment used in the ZK circuit
commitment = Poseidon(agentId, orgId, permissions, expiry, secret)
*/
function computeCommitment(agentId, orgId, permissions, expiry, secret) {
    return (0, crypto_2.poseidonHash)([
        agentId,
        orgId,
        permissions,
        expiry,
        secret
    ]);
}
