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

import { initCrypto } from "./utils/crypto"
import { EventSyncService } from "./services/eventSync"
import { attachAuth } from "./middleware/auth"

const app = express()
const eventSync = new EventSyncService()

app.use(express.json())
app.use(attachAuth)

app.use("/auth", authRoutes)
app.use("/orgs", orgRoutes)
app.use("/agents", agentRoutes)
app.use("/credentials", credentialRoutes)
app.use("/sessions", sessionRoutes)
app.use("/proofs", proofRoutes)
app.use("/wallets", walletRoutes)
app.use("/events", eventRoutes)
app.use("/v1", simpleRoutes)

async function start(){

    await initCrypto()

    app.listen(3000, ()=>{
        console.log("Backend running on port 3000")
    })

    eventSync.start().catch((error) => {
        console.error("Event sync bootstrap failed:", error.message)
    })

}

start()
