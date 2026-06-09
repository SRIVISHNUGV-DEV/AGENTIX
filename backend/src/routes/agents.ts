import express from "express"
import { initDB } from "../db"
import { PlatformService } from "../services/platform"
import { requireSignedAction } from "../services/actionAuth"
import type { Request, Response } from "express"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, optionalAddress, optionalInteger, requireInteger, requireString } from "../utils/validation"

const router = express.Router()
const platform = new PlatformService()

// Wallet-only auth: Create agent requires wallet signature
router.post("/", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const agentName = requireString(req.body.agentName, "agentName", { minLength: 2, maxLength: 120 })
        const orgId = requireInteger(req.body.orgId, "orgId", 1)

        // Verify org exists
        const org = await db.get(`SELECT id, owner_wallet_address FROM organizations WHERE id = ?`, orgId)
        if(!org){
            return res.status(404).json({ error:"organization not found" })
        }

        // Require wallet signature for agent creation
        await requireSignedAction(db, {
            orgId: orgId,
            action: "CREATE_AGENT",
            target: "agent:new",
            payload: req.body ?? {}
        })

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

// List agents for an org - requires orgId in query params
// If no orgId provided, return empty array (no org context)
router.get("/", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        const orgIdParam = req.query.orgId as string

        if (!orgIdParam) {
            // No org context - return empty array
            return res.json([])
        }

        const orgId = requireInteger(orgIdParam, "orgId", 1)

        // Return agents for the specified org
        const agents = await db.all(
            `
            SELECT *
            FROM agents
            WHERE org_id = ?
            `,
            orgId
        )

        res.json(agents)
    }catch(error){
        respondWithError(res, error, "agents.list")
    }
})

// Wallet-only auth: Issue credential — client provides commitment (never the raw secret)
router.post("/:agentId/credentials/issue", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent){
            return res.status(404).json({ error:"agent not found" })
        }

        ensureBodyObject(req.body)
        const permissions = requireInteger(req.body.permissions, "permissions", 0)
        const expiry = requireInteger(req.body.expiry, "expiry", 1)
        const commitment = requireString(req.body.commitment, "commitment", { minLength: 1, maxLength: 256 })
        const secretHash = req.body.secretHash === undefined || req.body.secretHash === null
            ? null
            : requireString(req.body.secretHash, "secretHash", { minLength: 1, maxLength: 256 })

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "ISSUE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.issueCredential(db, agentId, agent.org_id, permissions, expiry, commitment, secretHash)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.issueCredential")
    }
})

// Wallet-only auth: Create session — client provides pre-generated proof
router.post("/:agentId/sessions/create", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent){
            return res.status(404).json({ error:"agent not found" })
        }

        ensureBodyObject(req.body)
        const sessionId = requireString(req.body.sessionId, "sessionId")
        const sessionKey = requireString(req.body.sessionKey, "sessionKey")
        const maxValue = requireInteger(req.body.maxValue, "maxValue", 0)
        const expiry = requireInteger(req.body.expiry, "expiry", 1)
        const proof = req.body.proof
        const publicSignals = req.body.publicSignals

        if (!proof || !publicSignals) {
            return res.status(400).json({ error: "proof and publicSignals required" })
        }

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "CREATE_SESSION",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await blockchain.createSession(db, agent.org_id, sessionId, sessionKey, maxValue, expiry, proof, publicSignals)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.createSession")
    }
})

// Wallet-only auth: Revoke credential — client provides secretHash
router.post("/:agentId/revoke", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent){
            return res.status(404).json({ error:"agent not found" })
        }

        ensureBodyObject(req.body)
        const secretHash = requireString(req.body.secretHash, "secretHash", { minLength: 1, maxLength: 256 })

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "REVOKE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.revokeCredential(db, agentId, secretHash)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "agents.revoke")
    }
})

// Wallet-only auth: Create wallet
router.post("/:agentId/wallets/create", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent){
            return res.status(404).json({ error:"agent not found" })
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

// Wallet-only auth: Fund agent
router.post("/:agentId/fund", async (req: Request, res: Response)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent){
            return res.status(404).json({ error:"agent not found" })
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
