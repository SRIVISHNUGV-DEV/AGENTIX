import express from "express"
import { initDB } from "../db"
import { PlatformService } from "../services/platform"
import { requireSignedAction } from "../services/actionAuth"

const router = express.Router()
const platform = new PlatformService()


// Create agent
router.post("/", async (req:any,res)=>{

    try{

        const db = await initDB()

        const { agentName, orgId: requestedOrgId } = req.body
        const orgId = req.auth?.orgId ?? Number(requestedOrgId)

        if(!orgId){
            return res.status(400).json({
                error:"orgId required"
            })
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

    }catch(err:any){

        res.status(500).json({
            error: err.message
        })
    }

})


// List agents
router.get("/", async (req:any,res)=>{

    const db = await initDB()

    const agents = req.auth
        ? await db.all(
            `
            SELECT *
            FROM agents
            WHERE org_id = ?
            `,
            req.auth.orgId
        )
        : await db.all(
            `
            SELECT *
            FROM agents
            `
        )

    res.json(agents)

})

router.post("/:agentId/credentials/issue", async (req:any,res)=>{
    try{
        const db = await initDB()
        const agentId = Number(req.params.agentId)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }
        const { permissions, expiry } = req.body

        if(permissions === undefined || expiry === undefined){
            return res.status(400).json({ error:"permissions and expiry are required" })
        }

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "ISSUE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.issueCredential(db, agentId, Number(permissions), Number(expiry))
        res.json(result)
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.post("/:agentId/sessions/create", async (req:any,res)=>{
    try{
        const db = await initDB()
        const agentId = Number(req.params.agentId)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }
        const { maxValue, expiry } = req.body ?? {}

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "CREATE_SESSION",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.createSession(db, agentId, {
            maxValue: maxValue === undefined ? undefined : Number(maxValue),
            expiry: expiry === undefined ? undefined : Number(expiry)
        })
        res.json(result)
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.post("/:agentId/revoke", async (req:any,res)=>{
    try{
        const db = await initDB()
        const agentId = Number(req.params.agentId)
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
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.post("/:agentId/wallets/create", async (req:any,res)=>{
    try{
        const db = await initDB()
        const agentId = Number(req.params.agentId)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }
        const { ownerAddress } = req.body ?? {}

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "CREATE_WALLET",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.createWallet(db, agentId, ownerAddress)
        res.json(result)
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.post("/:agentId/fund", async (req:any,res)=>{
    try{
        const db = await initDB()
        const agentId = Number(req.params.agentId)
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(403).json({ error:"forbidden" })
        }
        const { amountEth } = req.body ?? {}

        if(!amountEth){
            return res.status(400).json({ error:"amountEth is required" })
        }

        await requireSignedAction(db, {
            orgId: agent.org_id,
            action: "FUND_AGENT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        })

        const result = await platform.fundAgent(db, agentId, amountEth)
        res.json({ success:true, ...result })
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

export default router
