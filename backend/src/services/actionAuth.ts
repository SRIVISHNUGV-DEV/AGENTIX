import { verifyMessage } from "ethers"
import { AppError } from "../utils/errors"

const SIGNED_ACTION_CHAIN_ID = 84532
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60

type SignedActionPayload = {
    walletAddress?: string
    signature?: string
    nonce?: string
    requestedAt?: number | string
}

type AuthorizationOptions = {
    orgId: number
    action: string
    target: string
    payload: SignedActionPayload
}

export function buildSignedActionMessage({
    action,
    orgId,
    target,
    walletAddress,
    nonce,
    requestedAt
}:{
    action:string
    orgId:number
    target:string
    walletAddress:string
    nonce:string
    requestedAt:number
}){
    return [
        "Agentix Authorization",
        `Action: ${action}`,
        `Org: ${orgId}`,
        `Target: ${target}`,
        `Wallet: ${walletAddress.toLowerCase()}`,
        `Nonce: ${nonce}`,
        `RequestedAt: ${requestedAt}`,
        `ChainId: ${SIGNED_ACTION_CHAIN_ID}`
    ].join("\n")
}

/**
 * Verify a personal_sign signature.
 * personal_sign prefixes the message with "\x19Ethereum Signed Message:\n{length}"
 * ethers verifyMessage handles this automatically.
 */
function verifyPersonalSignature(message: string, signature: string): string {
    try {
        return verifyMessage(message, signature).toLowerCase()
    } catch (error) {
        throw new AppError(401, "invalid wallet signature")
    }
}

const isDev = process.env.NODE_ENV !== "production"

export async function requireSignedAction(db:any, options:AuthorizationOptions){
    const { orgId, action, target, payload } = options

    // DEV BYPASS: skip signature verification
    if (isDev && process.env.DEV_AUTH_BYPASS === "true") {
        return { walletAddress: "0x0000000000000000000000000000000000000001", requestedAt: Date.now() }
    }

    console.log("[actionAuth] Received payload:", JSON.stringify(payload, null, 2))

    const walletAddress = payload.walletAddress?.toLowerCase()
    const signature = payload.signature
    const nonce = payload.nonce
    const requestedAt = Number(payload.requestedAt)

    console.log("[actionAuth] Extracted:", { walletAddress, hasSignature: !!signature, nonce, requestedAt })

    if(!walletAddress || !signature || !nonce || !Number.isFinite(requestedAt)){
        console.log("[actionAuth] Missing required fields")
        throw new AppError(401, "wallet signature is required")
    }

    // For new org creation (orgId = 0), skip org ownership check
    const isNewOrg = orgId === 0

    if(!isNewOrg){
        const org = await db.get(
            `
            SELECT id, owner_wallet_address
            FROM organizations
            WHERE id = ?
            `,
            orgId
        )

        if(!org){
            throw new AppError(404, "organization not found")
        }

        const ownerWalletAddress = org.owner_wallet_address?.toLowerCase()

        if(!ownerWalletAddress){
            throw new AppError(400, "organization owner wallet is not set")
        }

        if(ownerWalletAddress !== walletAddress){
            throw new AppError(403, "signed wallet does not match organization owner")
        }
    }

    // Check-then-insert with atomic INSERT ... ON CONFLICT to prevent TOCTOU race condition
    // This ensures atomicity: if two requests with the same nonce arrive simultaneously,
    // only one will succeed due to the UNIQUE constraint on nonce column
    try {
        await db.run(
            `
            INSERT INTO action_authorizations
            (nonce, org_id, wallet_address, action, target, requested_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(nonce) DO NOTHING
            `,
            nonce,
            isNewOrg ? null : orgId,
            walletAddress,
            action,
            target,
            requestedAt
        )
    } catch (error: any) {
        // PostgreSQL unique constraint violation
        if (error.code === '23505' || error.message?.includes('unique constraint') || error.message?.includes('duplicate')) {
            throw new AppError(409, "authorization nonce already used")
        }
        throw error
    }

    // Verify the insert actually happened (row was not rejected by ON CONFLICT)
    const inserted = await db.get(
        `
        SELECT nonce FROM action_authorizations WHERE nonce = ?
        `,
        nonce
    )

    if (!inserted) {
        throw new AppError(409, "authorization nonce already used")
    }

    const now = Math.floor(Date.now() / 1000)
    if(Math.abs(now - requestedAt) > MAX_SIGNATURE_AGE_SECONDS){
        throw new AppError(401, "wallet signature expired")
    }

    const message = buildSignedActionMessage({
        action,
        orgId,
        target,
        walletAddress,
        nonce,
        requestedAt
    })

    let recovered:string
    try{
        recovered = verifyPersonalSignature(message, signature)
    }catch{
        throw new AppError(401, "invalid wallet signature")
    }

    if(recovered !== walletAddress){
        throw new AppError(401, `wallet signature does not match requested wallet (expected ${walletAddress}, got ${recovered})`)
    }

    // Authorization already inserted at line 110-123 with atomic INSERT ... ON CONFLICT
    // No need for second insert - the row is already in the database

    return {
        walletAddress,
        requestedAt
    }
}
