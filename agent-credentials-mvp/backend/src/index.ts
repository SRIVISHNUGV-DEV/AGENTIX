import "dotenv/config"
import express from "express"
import cors from "cors"

import orgRoutes from "./routes/orgs"
import agentRoutes from "./routes/agents"
import credentialRoutes from "./routes/credentials"
import sessionRoutes from "./routes/sessions"
import proofRoutes from "./routes/proofs"
import walletRoutes from "./routes/wallets"
import eventRoutes from "./routes/events"
import simpleRoutes from "./routes/simple"
import authRoutes from "./routes/auth"
import externalAgentRoutes from "./routes/externalAgents"
import v1Routes from "./routes/v1"

import { initCrypto } from "./utils/crypto"
import { EventSyncService } from "./services/eventSync"
import { attachAuth } from "./middleware/auth"
import { helmetMiddleware, corsMiddleware, createRateLimitMiddleware, securityHeaders, authRateLimit } from "./middleware/security"
import { AppError } from "./utils/errors"
import { errorTracker, metrics, getHealthMetrics } from "./utils/monitoring"

const PORT = Number(process.env.PORT || "3000")
const ENABLE_EVENT_SYNC = process.env.ENABLE_EVENT_SYNC !== "false"
const isProduction = process.env.NODE_ENV === "production"

const app = express()
const eventSync = new EventSyncService()

// Security middleware
app.disable("x-powered-by")

// Helmet security headers in all environments (V-005: Security headers)
app.use(helmetMiddleware)

// Additional security headers
app.use(securityHeaders)
app.use(corsMiddleware)

// Rate limiting: stricter in production
const rateLimiter = isProduction
    ? createRateLimitMiddleware(15 * 60 * 1000, 100) // 100 requests per 15 min
    : createRateLimitMiddleware(15 * 60 * 1000, 1000) // 1000 in dev
app.use(rateLimiter)

// Body parsing with limits
app.use(express.json({ limit: "32kb" }))
app.use(express.urlencoded({ extended: true, limit: "32kb" }))

// Auth middleware
app.use(attachAuth)

app.use("/auth", authRateLimit, authRoutes)
app.use("/orgs", orgRoutes)
app.use("/agents", agentRoutes)
app.use("/credentials", credentialRoutes)
app.use("/sessions", sessionRoutes)
app.use("/proofs", proofRoutes)
app.use("/wallets", walletRoutes)
app.use("/events", eventRoutes)
app.use("/ai", simpleRoutes)
app.use("/external", externalAgentRoutes)
app.use("/v1", v1Routes)

app.use((error:any,req:any,res:any,next:any)=>{
    // Track the error with context
    errorTracker.captureError(
        error instanceof Error ? error : new Error(String(error)),
        "express_error_handler",
        {
            path: req.path,
            method: req.method,
            ip: req.ip
        }
    )

    if(error instanceof AppError){
        metrics.increment("errors.app_error")
        return res.status(error.statusCode).json({
            error: error.expose ? error.message : "internal server error"
        })
    }

    metrics.increment("errors.server_error")
    console.error("[server]", error?.message ?? error)
    return res.status(500).json({
        error: "internal server error"
    })
})

async function start(){
    await initCrypto()

    // Enhanced health endpoint with metrics
    app.get("/health", (req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            environment: isProduction ? "production" : "development",
            ...getHealthMetrics()
        })
    })

    // Metrics endpoint (protected in production)
    app.get("/metrics", (req, res) => {
        if (isProduction && req.headers.authorization !== `Bearer ${process.env.METRICS_API_KEY}`) {
            return res.status(401).json({ error: "unauthorized" })
        }
        res.json(metrics.getMetrics())
    })

    app.listen(PORT, ()=>{
        console.log(`Backend running on port ${PORT} (${isProduction ? "production" : "development"})`)
    })

    if(ENABLE_EVENT_SYNC){
        eventSync.start().catch((error) => {
            console.error("Event sync bootstrap failed:", error.message)
            errorTracker.captureError(error, "event_sync_start")
        })
    }else{
        console.log("Event sync disabled by configuration")
    }
}

start()
