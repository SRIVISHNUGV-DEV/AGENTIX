import crypto from "crypto"

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

export class AuthService {
    hashPassword(password:string){
        const salt = crypto.randomBytes(16).toString("hex")
        const derived = crypto.scryptSync(password, salt, 64).toString("hex")
        return `${salt}:${derived}`
    }

    verifyPassword(password:string, storedHash:string){
        const [salt, expected] = storedHash.split(":")
        const actual = crypto.scryptSync(password, salt, 64).toString("hex")
        return crypto.timingSafeEqual(
            Buffer.from(actual, "hex"),
            Buffer.from(expected, "hex")
        )
    }

    hashToken(token:string){
        return crypto.createHash("sha256").update(token).digest("hex")
    }

    createSessionToken(){
        return crypto.randomBytes(32).toString("hex")
    }

    async createSession(db:any, userId:number){
        const token = this.createSessionToken()
        const tokenHash = this.hashToken(token)
        const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS

        await db.run(
            `
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
            `,
            userId,
            tokenHash,
            expiresAt
        )

        return {
            token,
            expiresAt
        }
    }

    async getSession(db:any, token:string){
        const tokenHash = this.hashToken(token)
        return db.get(
            `
            SELECT s.*, u.org_id, u.email, u.name, u.role
            FROM auth_sessions s
            INNER JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
              AND s.expires_at > strftime('%s','now')
            `,
            tokenHash
        )
    }

    async revokeSession(db:any, token:string){
        const tokenHash = this.hashToken(token)
        await db.run(
            `
            DELETE FROM auth_sessions
            WHERE token_hash = ?
            `,
            tokenHash
        )
    }
}
