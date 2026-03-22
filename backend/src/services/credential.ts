import crypto from "crypto"
import { poseidonHash } from "../utils/crypto"

/*
Hash the secret for secure database storage
The raw secret should never be stored directly
*/
export function hashSecret(secret:string){

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
    agentId:bigint,
    orgId:bigint,
    permissions:bigint,
    expiry:bigint,
    secret:bigint
){

    return poseidonHash([
        agentId,
        orgId,
        permissions,
        expiry,
        secret
    ])
}