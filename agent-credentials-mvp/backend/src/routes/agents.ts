import express from "express"
import { initDB } from "../db"
import { PlatformService } from "../services/platform"
import { requireSignedAction } from "../services/actionAuth"
import { requireAuth } from "../middleware/auth"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, optionalAddress, optionalInteger, requireInteger, requireString } from "../utils/validation"

const router = express.Router()
const platform = new PlatformService()

// V-003 FIX: Require authentication for all agent routes
router.use(requireAuth)

router.post("/", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        // V-003: Only use authenticated orgId
        if (!req.auth?.orgId) {
            return res.status(401).json({ error: "authentication required" })
        }

        const agentName = requireString(req.body.agentName, "agentName", { minLength: 2, maxLength: 120 })
        const orgId = req.auth.orgId

        const org = await db.get(`SELECT id FROM organizations WHERE id = ?`, orgId)
        if(!org){
            return res.status(404).json({ error:"organization not found" })
        }

        const result = await db.run(
            `
            INSERT INTO agents (org_id,agent_name)
            VALUES (?,?)
            `,
            orgId,
            agentName
        )

        res.json({
            agentId: result.lastID
        })
    }catch(error){
        respondWithError(res, error, "agents.create")
    }
})

router.get("/", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()

        // V-003 FIX: Only return agents for authenticated org
        const agents = await db.all(
            `
            SELECT *
            FROM agents
            WHERE org_id = ?
            `,
            req.auth!.orgId
        )

        res.json(agents)
    }catch(error){
        respondWithError(res, error, "agents.list")
    }
})

router.post("/:agentId/credentials/issue", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }

        ensureBodyObject(req.body)
        const permissions = requireInteger(req.body.permissions, "permissions", 0)
        const expiry = requireInteger(req.body.expiry, "expiry", 1)

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "ISSUE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.issueCredential(db, agentId, permissions, expiry)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.issueCredential")
    }
})

router.post("/:agentId/sessions/create", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }

        ensureBodyObject(req.body)
        const maxValue = optionalInteger(req.body.maxValue, "maxValue", 0)
        const expiry = optionalInteger(req.body.expiry, "expiry", 1)

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "CREATE_SESSION",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.createSession(db, agentId, { maxValue, expiry })
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.createSession")
    }
})

router.post("/:agentId/revoke", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "REVOKE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.revokeCredential(db, agentId)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.revoke")
    }
})

router.post("/:agentId/wallets/create", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }

        ensureBodyObject(req.body)
        const ownerAddress = optionalAddress(req.body.ownerAddress, "ownerAddress")

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "CREATE_WALLET",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.createWallet(db, agentId, ownerAddress ?? undefined)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.createWallet")
    }
})

router.post("/:agentId/fund", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }

        ensureBodyObject(req.body)
        const amountEth = requireString(req.body.amountEth, "amountEth", { minLength: 1, maxLength: 40 })

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "FUND_AGENT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.fundAgent(db, agentId, amountEth)
        res.json({ success:true, ...result })
    }catch(error){
        respondWithError(res, error, "agents.fund")
    }
})

export default router
