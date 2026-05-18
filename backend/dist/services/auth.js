"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
class AuthService {
    hashPassword(password) {
        const salt = crypto_1.default.randomBytes(16).toString("hex");
        const derived = crypto_1.default.scryptSync(password, salt, 64).toString("hex");
        return `${salt}:${derived}`;
    }
    verifyPassword(password, storedHash) {
        const [salt, expected] = storedHash.split(":");
        if (!salt || !expected) {
            return false;
        }
        const actual = crypto_1.default.scryptSync(password, salt, 64).toString("hex");
        return crypto_1.default.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
    }
    hashToken(token) {
        return crypto_1.default.createHash("sha256").update(token).digest("hex");
    }
    createSessionToken() {
        return crypto_1.default.randomBytes(32).toString("hex");
    }
    async createSession(db, userId) {
        const token = this.createSessionToken();
        const tokenHash = this.hashToken(token);
        const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
        await db.run(`
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
            `, userId, tokenHash, expiresAt);
        return {
            token,
            expiresAt
        };
    }
    async getSession(db, token) {
        const tokenHash = this.hashToken(token);
        return db.get(`
            SELECT s.*, u.org_id, u.email, u.name, u.role
            FROM auth_sessions s
            INNER JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
              AND s.expires_at > EXTRACT(EPOCH FROM NOW())::INTEGER
            `, tokenHash);
    }
    async revokeSession(db, token) {
        const tokenHash = this.hashToken(token);
        await db.run(`
            DELETE FROM auth_sessions
            WHERE token_hash = ?
            `, tokenHash);
    }
}
exports.AuthService = AuthService;
