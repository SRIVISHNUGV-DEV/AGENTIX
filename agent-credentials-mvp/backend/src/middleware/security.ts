import type { NextFunction, Request, Response } from "express"
import helmet from "helmet"
import rateLimit from "express-rate-limit"

const isProduction = process.env.NODE_ENV === "production"

const DEFAULT_ALLOWED_ORIGINS = [
    "http://127.0.0.1:3001",
    "http://localhost:3001"
]

// Production CORS origins - configure via CORS_ORIGIN env var
const PRODUCTION_ORIGINS: string[] = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
    : []

function getCSPDirectives() {
    const directives: any = {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
    }

    // Remove unsafe-eval in production (V-005 fix)
    if (isProduction) {
        directives.scriptSrc = ["'self'"]
    } else {
        directives.scriptSrc = ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    }

    directives.connectSrc = ["'self'", "http://127.0.0.1:3000", "http://127.0.0.1:3001", "https:", "ws:", "wss:"]
    directives.frameAncestors = ["'none'"]

    // Only add upgradeInsecureRequests in production
    if (isProduction) {
        directives.upgradeInsecureRequests = []
    }

    return directives
}

export const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: getCSPDirectives()
    },
    hsts: isProduction ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false,
    crossOriginEmbedderPolicy: isProduction
})

export function securityHeaders(req:Request, res:Response, next:NextFunction){
    // Additional headers not covered by Helmet
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none")

    next()
}

export function corsMiddleware(req:Request, res:Response, next:NextFunction){
    const origin = req.headers.origin
    const isProduction = process.env.NODE_ENV === "production"

    // In production, only allow explicitly configured origins
    // In development, allow localhost defaults
    const allowedOrigins = isProduction && PRODUCTION_ORIGINS.length > 0
        ? PRODUCTION_ORIGINS
        : [...DEFAULT_ALLOWED_ORIGINS, ...PRODUCTION_ORIGINS]

    if(origin && allowedOrigins.includes(origin)){
        res.setHeader("Access-Control-Allow-Origin", origin)
        res.setHeader("Vary", "Origin")
    } else if (isProduction && origin) {
        // Log blocked origin in production
        console.warn(`[CORS] Blocked origin: ${origin}`)
    }

    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.setHeader("Access-Control-Max-Age", "86400")

    if(req.method === "OPTIONS"){
        return res.status(204).end()
    }

    next()
}

// Production rate limiter using Redis (if available) or memory
const useRedisRateLimit = !!process.env.REDIS_URL

export function createRateLimitMiddleware(windowMs:number, maxRequests:number){
    // Use express-rate-limit in production for better reliability
    if (process.env.NODE_ENV === "production" && !useRedisRateLimit) {
        return rateLimit({
            windowMs,
            max: maxRequests,
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: (req: Request) => {
                const forwarded = req.headers["x-forwarded-for"]
                return Array.isArray(forwarded)
                    ? forwarded[0]
                    : typeof forwarded === "string"
                        ? forwarded.split(",")[0].trim()
                        : req.ip ?? "unknown"
            },
            handler: (_req: Request, res: Response) => {
                res.status(429).json({ error: "rate limit exceeded" })
            }
        })
    }

    // Fallback to in-memory rate limiting for development
    const hits = new Map<string, { count:number, resetAt:number }>()

    return function rateLimit(req:Request, res:Response, next:NextFunction){
        const forwarded = req.headers["x-forwarded-for"]
        const ip = Array.isArray(forwarded)
            ? forwarded[0]
            : typeof forwarded === "string"
                ? forwarded.split(",")[0].trim()
                : req.ip ?? "unknown"
        const now = Date.now()
        const existing = hits.get(ip)

        if(!existing || existing.resetAt <= now){
            hits.set(ip, {
                count: 1,
                resetAt: now + windowMs
            })
            return next()
        }

        if(existing.count >= maxRequests){
            res.setHeader("Retry-After", Math.ceil((existing.resetAt - now) / 1000))
            return res.status(429).json({
                error: "rate limit exceeded"
            })
        }

        existing.count += 1
        hits.set(ip, existing)
        next()
    }
}

// Strict rate limiter for auth endpoints
export const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    message: { error: "too many authentication attempts" },
    standardHeaders: true,
    legacyHeaders: false
})
