import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"

const router = express.Router()
const blockchain = new BlockchainService()

router.post("/agents/provision", async (req:any,res)=>{
    try{
        const db = await initDB()
        const {
            orgName,
            agentName,
            orgId,
        } = req.body

        let resolvedOrgId = req.auth?.orgId ?? Number(orgId)
        if(!resolvedOrgId){
            if(!orgName){
                return res.status(400).json({ error:"orgId or orgName is required" })
            }

            const createdOrg = await db.run(
                `
                INSERT INTO organizations (name)
                VALUES (?)
                `,
                orgName
            )
            resolvedOrgId = createdOrg.lastID
        }

        const agent = await db.run(
            `
            INSERT INTO agents (org_id, agent_name)
            VALUES (?, ?)
            `,
            resolvedOrgId,
            agentName ?? `Agent ${Date.now()}`
        )

        const agentId = agent.lastID
        const contracts = await blockchain.ensureOrganizationContracts(db, resolvedOrgId)

        res.json({
            success:true,
            orgId: resolvedOrgId,
            agentId,
            contracts,
            next: {
                credentialRegisterUrl: `/credentials`,
                proofBundleUrl: `/proofs/${agentId}`,
                sessionSubmitUrl: `/sessions`,
                revokeUrl: `/credentials/revoke`,
                walletCreateUrl: `/wallets`
            }
        })

    }catch(err:any){
        res.status(500).json({
            error:err.message
        })
    }
})

router.get("/agents/:agentId/state", async (req:any,res)=>{
    const db = await initDB()
    const agentId = Number(req.params.agentId)

    const agent = await db.get(`SELECT * FROM agents WHERE id = ?`, agentId)
    if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
        return res.status(404).json({ error:"agent not found" })
    }
    const credential = await db.get(`SELECT * FROM credentials WHERE agent_id = ?`, agentId)
    const wallets = await db.all(`SELECT * FROM wallets WHERE agent_id = ? ORDER BY id DESC`, agentId)
    const sessions = await db.all(`SELECT * FROM sessions WHERE agent_id = ? ORDER BY id DESC`, agentId)
    const contracts = agent
        ? await blockchain.getOrganizationContracts(db, agent.org_id)
        : null
    const events = await db.all(
        `
        SELECT ce.*
        FROM contract_events ce
        LEFT JOIN wallets w ON ce.wallet_address = w.wallet_address
        WHERE w.agent_id = ?
           OR ce.session_id IN (
                SELECT session_id
                FROM sessions
                WHERE agent_id = ?
           )
        ORDER BY ce.block_number DESC, ce.log_index DESC
        `,
        agentId,
        agentId
    )

    res.json({
        agent,
        credential,
        wallets,
        sessions,
        events,
        contracts
    })
})

export default router
