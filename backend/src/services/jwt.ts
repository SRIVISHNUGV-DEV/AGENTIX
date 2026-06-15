import * as jose from "jose"
import crypto from "crypto"

const JWT_ISSUER = process.env.JWT_ISSUER || "agentix"
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "agentix-api"
const ACCESS_TOKEN_TTL = 60 * 15
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30

let signingKeyPair: { privateKey: any; publicKey: any } | null = null
let currentKid: string | null = null
let keyGeneratedAt: number = 0

function getKeyRotationSeconds(): number {
    return parseInt(process.env.JWT_KEY_ROTATION_SECONDS || "86400", 10)
}

async function ensureKeyPair(): Promise<{ privateKey: any; publicKey: any }> {
    const rotationSeconds = getKeyRotationSeconds()
    if (signingKeyPair && Date.now() - keyGeneratedAt < rotationSeconds * 1000) {
        return signingKeyPair
    }

    const storedPrivate = process.env.JWT_PRIVATE_KEY
    const storedPublic = process.env.JWT_PUBLIC_KEY

    if (storedPrivate && storedPublic) {
        const privateKey = await jose.importPKCS8(storedPrivate, "RS256")
        const publicKey = await jose.importSPKI(storedPublic, "RS256")
        const thumbprint = await jose.calculateJwkThumbprint(
            await jose.exportJWK(publicKey) as jose.JWK,
        )
        currentKid = thumbprint
        signingKeyPair = { privateKey, publicKey }
        keyGeneratedAt = Date.now()
        return signingKeyPair
    }

    const pair = await jose.generateKeyPair("RS256", { modulusLength: 2048 })
    signingKeyPair = pair
    keyGeneratedAt = Date.now()

    const publicJwk = await jose.exportJWK(pair.publicKey)
    const thumbprint = await jose.calculateJwkThumbprint(publicJwk as jose.JWK)
    currentKid = thumbprint

    console.log("[jwt] Generated ephemeral RSA key pair (set JWT_PRIVATE_KEY/JWT_PUBLIC_KEY env vars for persistence)")

    return pair
}

export interface TokenPayload {
    sub: string
    orgId: number
    role: string
    type: "user" | "agent"
    email?: string
    name?: string
    agentId?: number
    permissions?: string
    spendingCap?: string
    capabilities?: string[]
}

export interface TokenPair {
    accessToken: string
    refreshToken: string
    accessTokenExpires: number
    refreshTokenExpires: number
}

export async function signAccessToken(payload: TokenPayload): Promise<string> {
    const keyPair = await ensureKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await new jose.SignJWT({
        role: payload.role,
        type: payload.type,
        ...(payload.email && { email: payload.email }),
        ...(payload.name && { name: payload.name }),
        ...(payload.agentId !== undefined && { agentId: payload.agentId }),
        ...(payload.permissions && { permissions: payload.permissions }),
        ...(payload.spendingCap && { spendingCap: payload.spendingCap }),
        ...(payload.capabilities && { capabilities: payload.capabilities }),
    })
        .setProtectedHeader({ alg: "RS256", kid: currentKid! })
        .setSubject(payload.sub)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
        .setNotBefore(now)
        .sign(keyPair.privateKey)

    return token
}

export async function signRefreshToken(sub: string): Promise<{ token: string; expiresAt: number }> {
    const keyPair = await ensureKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + REFRESH_TOKEN_TTL

    const token = await new jose.SignJWT({ type: "refresh" })
        .setProtectedHeader({ alg: "RS256", kid: currentKid! })
        .setSubject(sub)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
        .setNotBefore(now)
        .sign(keyPair.privateKey)

    return { token, expiresAt }
}

export async function verifyToken(token: string): Promise<jose.JWTPayload | null> {
    try {
        const keyPair = await ensureKeyPair()
        const { payload } = await jose.jwtVerify(token, keyPair.publicKey, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
        })
        return payload
    } catch {
        return null
    }
}

export async function getPublicJWK(): Promise<jose.JWK> {
    const keyPair = await ensureKeyPair()
    const jwk = await jose.exportJWK(keyPair.publicKey) as jose.JWK
    jwk.kid = currentKid!
    jwk.alg = "RS256"
    jwk.use = "sig"
    return jwk
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
    const key = `ak_${crypto.randomBytes(32).toString("hex")}`
    const hash = crypto.createHash("sha256").update(key).digest("hex")
    const prefix = key.slice(0, 11)
    return { key, hash, prefix }
}

export function hashApiKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex")
}

export { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL }
