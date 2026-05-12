import type { NextFunction, Request, Response } from "express"

const DEFAULT_ALLOWED_ORIGINS = [
    "http://127.0.0.1:3001",
    "http://localhost:3001"
]

export function securityHeaders(req:Request, res:Response, next:NextFunction){
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Frame-Options", "DENY")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    res.setHeader("Cross-Origin-Resource-Policy", "same-site")
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' http://127.0.0.1:3000 http://127.0.0.1:3001 https: ws: wss:;"
    )

    if(req.secure){
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    }

    next()
}

export function corsMiddleware(req:Request, res:Response, next:NextFunction){
    const origin = req.headers.origin
    const configuredOrigins = (process.env.CORS_ORIGIN ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS

    if(origin && allowedOrigins.includes(origin)){
        res.setHeader("Access-Control-Allow-Origin", origin)
        res.setHeader("Vary", "Origin")
    }

    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")

    if(req.method === "OPTIONS"){
        return res.status(204).end()
    }

    next()
}

export function createRateLimitMiddleware(windowMs:number, maxRequests:number){
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
