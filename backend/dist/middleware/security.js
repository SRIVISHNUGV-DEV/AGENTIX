"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRateLimit = exports.helmetMiddleware = void 0;
exports.securityHeaders = securityHeaders;
exports.corsMiddleware = corsMiddleware;
exports.createRateLimitMiddleware = createRateLimitMiddleware;
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const isProduction = process.env.NODE_ENV === "production";
const DEFAULT_ALLOWED_ORIGINS = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001"
];
// Production CORS origins - configure via CORS_ORIGIN env var
const PRODUCTION_ORIGINS = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
    : [];
function getAllowedConnectOrigins() {
    const configuredOrigins = PRODUCTION_ORIGINS.filter(Boolean);
    if (isProduction) {
        return ["'self'", ...configuredOrigins, "https:", "wss:"];
    }
    return [
        "'self'",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
        ...configuredOrigins,
        "https:",
        "ws:",
        "wss:",
    ];
}
function getCSPDirectives() {
    const directives = {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
    };
    // Remove unsafe-eval in production (V-005 fix)
    if (isProduction) {
        directives.scriptSrc = ["'self'"];
    }
    else {
        directives.scriptSrc = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
    }
    directives.connectSrc = getAllowedConnectOrigins();
    directives.frameAncestors = ["'none'"];
    // Only add upgradeInsecureRequests in production
    if (isProduction) {
        directives.upgradeInsecureRequests = [];
    }
    return directives;
}
exports.helmetMiddleware = (0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: getCSPDirectives()
    },
    hsts: isProduction ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false,
    crossOriginEmbedderPolicy: isProduction
});
function securityHeaders(req, res, next) {
    // Additional headers not covered by Helmet
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    next();
}
function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    const isProduction = process.env.NODE_ENV === "production";
    // Build allowed origins list:
    // - If CORS_ORIGIN is set, use those (production)
    // - If CORS_ORIGIN is not set, use defaults (development OR production without config)
    // This ensures we never end up with an empty allowed origins list
    const allowedOrigins = PRODUCTION_ORIGINS.length > 0
        ? PRODUCTION_ORIGINS
        : DEFAULT_ALLOWED_ORIGINS;
    // Debug logging
    console.log('[CORS] origin:', origin, 'isProduction:', isProduction, 'allowedOrigins:', allowedOrigins);
    if (origin && allowedOrigins.includes(origin)) {
        console.log('[CORS] Allowing origin:', origin);
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    else if (isProduction && origin) {
        // Log blocked origin in production
        console.warn(`[CORS] Blocked origin: ${origin}`);
    }
    else if (origin) {
        console.log('[CORS] Origin not in allowed list:', origin);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    next();
}
// Production rate limiter using Redis (if available) or memory
const useRedisRateLimit = !!process.env.REDIS_URL;
function createRateLimitMiddleware(windowMs, maxRequests) {
    // Use express-rate-limit in production for better reliability
    if (process.env.NODE_ENV === "production" && !useRedisRateLimit) {
        return (0, express_rate_limit_1.default)({
            windowMs,
            max: maxRequests,
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: (req) => {
                const forwarded = req.headers["x-forwarded-for"];
                return Array.isArray(forwarded)
                    ? forwarded[0]
                    : typeof forwarded === "string"
                        ? forwarded.split(",")[0].trim()
                        : req.ip ?? "unknown";
            },
            handler: (_req, res) => {
                res.status(429).json({ error: "rate limit exceeded" });
            }
        });
    }
    // Fallback to in-memory rate limiting for development
    const hits = new Map();
    return function rateLimit(req, res, next) {
        const forwarded = req.headers["x-forwarded-for"];
        const ip = Array.isArray(forwarded)
            ? forwarded[0]
            : typeof forwarded === "string"
                ? forwarded.split(",")[0].trim()
                : req.ip ?? "unknown";
        const now = Date.now();
        const existing = hits.get(ip);
        if (!existing || existing.resetAt <= now) {
            hits.set(ip, {
                count: 1,
                resetAt: now + windowMs
            });
            return next();
        }
        if (existing.count >= maxRequests) {
            res.setHeader("Retry-After", Math.ceil((existing.resetAt - now) / 1000));
            return res.status(429).json({
                error: "rate limit exceeded"
            });
        }
        existing.count += 1;
        hits.set(ip, existing);
        next();
    };
}
// Strict rate limiter for auth endpoints
exports.authRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    message: { error: "too many authentication attempts" },
    standardHeaders: true,
    legacyHeaders: false
});
