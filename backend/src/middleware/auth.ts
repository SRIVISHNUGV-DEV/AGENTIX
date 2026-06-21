import type { NextFunction, Response } from "express"
import { initDB } from "../db"
import { AuthService } from "../services/auth"
import { verifyToken } from "../services/jwt"
import type { AuthRequest } from "../types/http"
import { AppError } from "../utils/errors"

const auth = new AuthService()
const isDev = process.env.NODE_ENV !== "production"

// Dev bypass: when DEV_AUTH_BYPASS=true, all requests get a default auth context
const DEV_AUTH = {
    userId: 1,
    orgId: 1,
    email: "dev@corvenlabs.org",
    name: "Dev User",
    role: "admin",
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
    type: "user" as const,
}

export async function attachAuth(req: AuthRequest, _res: Response, next: NextFunction) {
    try {
        // DEV BYPASS: skip all auth when DEV_AUTH_BYPASS=true
        if (isDev && process.env.DEV_AUTH_BYPASS === "true") {
            req.auth = DEV_AUTH
            return next()
        }

        const header = req.headers.authorization
        if (!header) {
            return next()
        }

        if (!header.startsWith("Bearer ")) {
            return next(new AppError(401, "invalid authorization header"))
        }

        const token = header.slice("Bearer ".length).trim()
        if (!token) {
            return next(new AppError(401, "invalid authorization header"))
        }

        if (token.includes(".") && token.split(".").length === 3) {
            const payload = await verifyToken(token)
            if (payload && payload.sub) {
                req.auth = {
                    userId: typeof payload.sub === "string" && payload.sub.startsWith("user:")
                        ? parseInt(payload.sub.replace("user:", ""), 10)
                        : 0,
                    orgId: payload.orgId as number || 0,
                    email: (payload.email as string) || "",
                    name: (payload.name as string) || "",
                    role: (payload.role as string) || "agent",
                    expiresAt: payload.exp || 0,
                    type: (payload.type as string) || "user",
                    agentId: payload.agentId as number | undefined,
                } as any
                return next()
            }
        }

        const db = await initDB()
        const session = await auth.getSession(db, token)
        const now = Math.floor(Date.now() / 1000)

        if (session && Number(session.expires_at) > now) {
            req.auth = {
                userId: session.user_id,
                orgId: session.org_id,
                email: session.email,
                name: session.name,
                role: session.role,
                expiresAt: Number(session.expires_at),
            }
        }

        next()
    } catch (error) {
        next(error)
    }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    // DEV BYPASS: skip auth check
    if (isDev && process.env.DEV_AUTH_BYPASS === "true") {
        if (!req.auth) req.auth = DEV_AUTH
        return next()
    }
    if (!req.auth) {
        return res.status(401).json({ error: "authentication required" })
    }
    next()
}

export function requireOrgAccess(req: AuthRequest, res: Response, next: NextFunction) {
    // DEV BYPASS: skip org check
    if (isDev && process.env.DEV_AUTH_BYPASS === "true") {
        if (!req.auth) req.auth = DEV_AUTH
        return next()
    }
    if (!req.auth) {
        return res.status(401).json({ error: "authentication required" })
    }
    const orgId = parseInt(String(req.params.orgId || req.query.orgId || ""), 10)
    if (orgId && req.auth.orgId !== orgId) {
        return res.status(403).json({ error: "access denied to this organization" })
    }
    next()
}
