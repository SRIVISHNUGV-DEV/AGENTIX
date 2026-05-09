import "dotenv/config"
import express from "express"

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
import { corsMiddleware, createRateLimitMiddleware, securityHeaders } from "./middleware/security"
import { AppError } from "./utils/errors"

const PORT = Number(process.env.PORT || "3000")
const ENABLE_EVENT_SYNC = process.env.ENABLE_EVENT_SYNC !== "false"

const app = express()
const eventSync = new EventSyncService()

app.disable("x-powered-by")
app.use(securityHeaders)
app.use(corsMiddleware)
app.use(createRateLimitMiddleware(15 * 60 * 1000, 300))
app.use(express.json({ limit: "32kb" }))
app.use(attachAuth)

app.use("/auth", authRoutes)
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

app.use((error:any,_req:any,res:any,_next:any)=>{
    if(error instanceof AppError){
        return res.status(error.statusCode).json({
            error: error.expose ? error.message : "internal server error"
        })
    }

    console.error("[server]", error?.message ?? error)
    return res.status(500).json({
        error: "internal server error"
    })
})

async function start(){
    await initCrypto()

    app.listen(PORT, ()=>{
        console.log(`Backend running on port ${PORT}`)
    })

    if(ENABLE_EVENT_SYNC){
        eventSync.start().catch((error) => {
            console.error("Event sync bootstrap failed:", error.message)
        })
    }else{
        console.log("Event sync disabled by configuration")
    }
}

start()
