"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachAuth = attachAuth;
exports.requireAuth = requireAuth;
const db_1 = require("../db");
const auth_1 = require("../services/auth");
const errors_1 = require("../utils/errors");
const auth = new auth_1.AuthService();
async function attachAuth(req, _res, next) {
    try {
        const header = req.headers.authorization;
        if (!header) {
            return next();
        }
        if (!header.startsWith("Bearer ")) {
            return next(new errors_1.AppError(401, "invalid authorization header"));
        }
        const token = header.slice("Bearer ".length).trim();
        if (!token) {
            return next(new errors_1.AppError(401, "invalid authorization header"));
        }
        const db = await (0, db_1.initDB)();
        const session = await auth.getSession(db, token);
        const now = Math.floor(Date.now() / 1000);
        if (session && Number(session.expires_at) > now) {
            req.auth = {
                userId: session.user_id,
                orgId: session.org_id,
                email: session.email,
                name: session.name,
                role: session.role,
                expiresAt: Number(session.expires_at)
            };
        }
        next();
    }
    catch (error) {
        next(error);
    }
}
function requireAuth(req, res, next) {
    if (!req.auth) {
        return res.status(401).json({ error: "authentication required" });
    }
    next();
}
