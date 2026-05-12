import express from "express"
import { initDB } from "../db"
import { EventSyncService } from "../services/eventSync"

const router = express.Router()
const eventSync = new EventSyncService()

router.get("/", async (req:any,res)=>{
    const db = await initDB()
    const limit = Math.min(Number(req.query.limit ?? 100), 500)
    const contractName = req.query.contractName
    const sessionId = req.query.sessionId
    const walletAddress = req.query.walletAddress

    const conditions:string[] = []
    const params:any[] = []

    if(contractName){
        conditions.push("contract_name = ?")
        params.push(contractName)
    }

    if(sessionId){
        conditions.push("session_id = ?")
        params.push(sessionId)
    }

    if(walletAddress){
        conditions.push("wallet_address = ?")
        params.push(walletAddress)
    }

    if(req.auth){
        conditions.unshift("org_id = ?")
        params.unshift(req.auth.orgId)
    }else if(req.query.orgId){
        conditions.unshift("org_id = ?")
        params.unshift(Number(req.query.orgId))
    }

    const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : ""

    const events = await db.all(
        `
        SELECT *
        FROM contract_events
        ${whereClause}
        ORDER BY block_number DESC, log_index DESC
        LIMIT ?
        `,
        ...params,
        limit
    )

    res.json(events)
})

router.post("/sync", async (_req,res)=>{
    await eventSync.syncOnce()
    res.json({ success:true })
})

router.get("/sessions/:sessionId", async (req:any,res)=>{
    const db = await initDB()
    const sessionId = req.params.sessionId

    const session = req.auth
        ? await db.get(
            `
            SELECT s.*
            FROM sessions s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE s.session_id = ?
              AND a.org_id = ?
            `,
            sessionId,
            req.auth.orgId
        )
        : await db.get(
            `
            SELECT *
            FROM sessions
            WHERE session_id = ?
            `,
            sessionId
        )

    const events = req.auth
        ? await db.all(
            `
            SELECT *
            FROM contract_events
            WHERE session_id = ?
              AND org_id = ?
            ORDER BY block_number ASC, log_index ASC
            `,
            sessionId,
            req.auth.orgId
        )
        : await db.all(
            `
            SELECT *
            FROM contract_events
            WHERE session_id = ?
            ORDER BY block_number ASC, log_index ASC
            `,
            sessionId
        )

    res.json({
        session,
        events
    })
})

export default router
