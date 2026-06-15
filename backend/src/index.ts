import "dotenv/config"
import express from "express"
import cors from "cors"
import http from "http"
import { WebSocketServer, WebSocket } from "ws"

import orgRoutes from "./routes/orgs"
import agentRoutes from "./routes/agents"
import credentialRoutes from "./routes/credentials"
import sessionRoutes from "./routes/sessions"
import proofRoutes from "./routes/proofs"
import walletRoutes from "./routes/wallets"
import eventRoutes from "./routes/events"
import simpleRoutes from "./routes/simple"
import aiRoutes from "./routes/ai"
import authRoutes from "./routes/auth"
import authFlowRoutes from "./routes/authFlow"
import externalAgentRoutes from "./routes/externalAgents"
import v1Routes from "./routes/v1"
import circuitRoutes from "./routes/circuit"
import wellKnownRoutes from "./routes/wellknown"
import verifyRoutes from "./routes/verify"
import covenantRoutes from "./routes/covenant"
import sessionsSimpleRoutes from "./routes/sessionsSimple"
import agentAuthRoutes from "./routes/agentAuth"
import dashboardRoutes from "./routes/dashboard"

import { initCrypto } from "./utils/crypto"
import { EventSyncService } from "./services/eventSync"
import { attachAuth } from "./middleware/auth"
import { helmetMiddleware, corsMiddleware, createRateLimitMiddleware, securityHeaders, authRateLimit } from "./middleware/security"
import { AppError } from "./utils/errors"
import { errorTracker, metrics, getHealthMetrics } from "./utils/monitoring"
import {
  registerAgentConnection,
  unregisterAgentConnection,
  handleAgentWebhook,
  sendToAgent,
  type AgentMessage,
} from "./services/agentComms"
import { startAutoReconnect } from "./services/agentReconnect"

const PORT = Number(process.env.PORT || "3000")
const WS_PORT = Number(process.env.WS_PORT || "3001")
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
app.use("/auth", authFlowRoutes)
app.use("/auth/agent", agentAuthRoutes)
app.use("/dashboard", dashboardRoutes)
app.use("/orgs", orgRoutes)
app.use("/agents", agentRoutes)
app.use("/credentials", credentialRoutes)
app.use("/sessions", sessionRoutes)
app.use("/proofs", proofRoutes)
app.use("/prover", proofRoutes) // Mount proofs router at /prover for prover/status
app.use("/wallets", walletRoutes)
app.use("/events", eventRoutes)
app.use("/ai", aiRoutes)
app.use("/external", externalAgentRoutes)
app.use("/v1", v1Routes)
app.use("/circuit", circuitRoutes)
app.use("/.well-known", wellKnownRoutes)
app.use("/verify", verifyRoutes)
app.use("/covenant", covenantRoutes)
app.use("/sessions/simple", sessionsSimpleRoutes)

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

    // Agent webhook receiver — agents push status/results here
    app.post("/agents/:agentId/webhook", express.json({ limit: "1mb" }), async (req, res) => {
      try {
        const agentId = parseInt(req.params.agentId, 10)
        if (isNaN(agentId)) {
          return res.status(400).json({ error: "Invalid agent ID" })
        }

        const result = await handleAgentWebhook(agentId, req.body)
        res.json(result)
      } catch (error) {
        console.error("[webhook] Error:", error)
        res.status(500).json({ error: "Webhook processing failed" })
      }
    })

    // Agent task result receiver — agents POST results for dispatched tasks
    app.post("/agents/:agentId/tasks/:taskId/result", express.json({ limit: "1mb" }), async (req, res) => {
      try {
        const agentId = parseInt(req.params.agentId, 10)
        const taskId = parseInt(req.params.taskId, 10)

        const { agentEvents } = await import("./services/agentComms")
        agentEvents.emit(`result:${taskId}`, {
          success: req.body.success,
          result: req.body.result,
          error: req.body.error,
        })

        res.json({ received: true })
      } catch (error) {
        res.status(500).json({ error: "Result processing failed" })
      }
    })

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

    // Start HTTP server
    const httpServer = http.createServer(app)
    httpServer.listen(PORT, ()=>{
        console.log(`Backend running on port ${PORT} (${isProduction ? "production" : "development"})`)
    })

    // Start WebSocket server for real-time agent communication
    const wss = new WebSocketServer({ port: WS_PORT })
    console.log(`WebSocket server running on port ${WS_PORT}`)

    wss.on("connection", (ws: WebSocket, req) => {
      const url = new URL(req.url || "/", `http://localhost:${WS_PORT}`)
      const agentId = parseInt(url.searchParams.get("agentId") || "0", 10)
      const token = url.searchParams.get("token") || ""

      if (!agentId) {
        ws.close(1008, "Missing agentId")
        return
      }

      // Authenticate agent (simple token check for now)
      // In production, verify JWT or API key
      registerAgentConnection(agentId, ws, { token })

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as AgentMessage

          switch (message.type) {
            case "result":
              // Agent sending task result
              const { agentEvents: events } = require("./services/agentComms")
              events.emit(`result:${message.taskId}`, {
                success: message.success,
                result: message.result,
                error: message.error,
              })
              break

            case "status":
              // Agent updating its status
              const { initDB } = require("./db")
              initDB().then((db: any) => {
                db.run(
                  `UPDATE external_agents SET status = ?, last_heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
                  message.status,
                  agentId
                )
              })
              break

            case "heartbeat":
              // Agent sending heartbeat
              sendToAgent(agentId, { type: "pong" })
              break

            case "ping":
              sendToAgent(agentId, { type: "pong" })
              break
          }
        } catch (error) {
          console.error(`[ws] Error processing message from agent ${agentId}:`, error)
        }
      })

      ws.on("close", () => {
        unregisterAgentConnection(agentId)
      })

      ws.on("error", (error) => {
        console.error(`[ws] Error for agent ${agentId}:`, error)
        unregisterAgentConnection(agentId)
      })

      // Send welcome message
      sendToAgent(agentId, { type: "ping" })
    })

    // Start auto-reconnection service
    startAutoReconnect()

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
