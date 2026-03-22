import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"
import { PlatformService } from "../services/platform"
import { requireSignedAction } from "../services/actionAuth"

const router = express.Router()
const blockchain = new BlockchainService()
const platform = new PlatformService()

// Create organization
router.post("/", async (req,res)=>{

    try{

        const db = await initDB()

        const { name, ownerWalletAddress } = req.body

        if(!name){
            return res.status(400).json({
                error:"Organization name required"
            })
        }

        const result = await db.run(
            `
            INSERT INTO organizations (name, owner_wallet_address)
            VALUES (?,?)
            `,
            name,
            ownerWalletAddress ?? null
        )

        res.json({
            id: result.lastID,
            name,
            ownerWalletAddress: ownerWalletAddress ?? null
        })

    }catch(err:any){

        res.status(500).json({
            error: err.message
        })
    }

})


// List organizations
router.get("/", async (req:any,res)=>{

    const db = await initDB()

    const orgs = req.auth
        ? await db.all("SELECT * FROM organizations WHERE id = ?", req.auth.orgId)
        : await db.all("SELECT * FROM organizations")

    res.json(orgs)

})

router.post("/:orgId/deploy-contracts", async (req:any,res)=>{
    try{
        const db = await initDB()
        const orgId = Number(req.params.orgId)
        if(req.auth && req.auth.orgId !== orgId){
            return res.status(403).json({ error:"forbidden" })
        }

        const org = await db.get(
            `SELECT * FROM organizations WHERE id = ?`,
            orgId
        )

        if(!org){
            return res.status(404).json({ error:"organization not found" })
        }

        await requireSignedAction(db, {
            orgId,
            action: "DEPLOY_CONTRACTS",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        })

        const contracts = await blockchain.deployOrganizationContracts(db, orgId)

        res.json({
            success:true,
            organization: org,
            contracts
        })
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.get("/:orgId/state", async (req:any,res)=>{
    const db = await initDB()
    const orgId = Number(req.params.orgId)
    if(req.auth && req.auth.orgId !== orgId){
        return res.status(403).json({ error:"forbidden" })
    }

    const organization = await db.get(`SELECT * FROM organizations WHERE id = ?`, orgId)
    if(!organization){
        return res.status(404).json({ error:"organization not found" })
    }

    const contracts = await db.get(
        `SELECT * FROM organization_contracts WHERE org_id = ?`,
        orgId
    )
    const agents = await db.all(`SELECT * FROM agents WHERE org_id = ? ORDER BY id DESC`, orgId)
    const wallets = await db.all(`SELECT * FROM wallets WHERE org_id = ? ORDER BY id DESC`, orgId)
    const sessions = await db.all(
        `
        SELECT s.*
        FROM sessions s
        INNER JOIN agents a ON a.id = s.agent_id
        WHERE a.org_id = ?
        ORDER BY s.id DESC
        `,
        orgId
    )
    const events = await db.all(
        `
        SELECT *
        FROM contract_events
        WHERE org_id = ?
        ORDER BY block_number DESC, log_index DESC
        LIMIT 200
        `,
        orgId
    )

    res.json({
        organization,
        contracts,
        agents,
        wallets,
        sessions,
        events
    })
})

router.post("/:orgId/fund", async (req:any,res)=>{
    try{
        const db = await initDB()
        const orgId = Number(req.params.orgId)
        if(req.auth && req.auth.orgId !== orgId){
            return res.status(403).json({ error:"forbidden" })
        }
        const { amountEth } = req.body ?? {}

        if(!amountEth){
            return res.status(400).json({ error:"amountEth is required" })
        }

        await requireSignedAction(db, {
            orgId,
            action: "FUND_ORG",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        })

        const result = await platform.fundOrganization(db, orgId, amountEth)
        res.json(result)
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.delete("/:orgId", async (req:any,res)=>{
    let db:any = null
    try{
        db = await initDB()
        const orgId = Number(req.params.orgId)

        const org = await db.get(`SELECT * FROM organizations WHERE id = ?`, orgId)
        if(!org){
            return res.status(404).json({ error:"organization not found" })
        }

        await requireSignedAction(db, {
            orgId,
            action: "DELETE_ORG",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        })

        await db.exec("BEGIN")

        await db.run(`DELETE FROM action_authorizations WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM contract_events WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM wallets WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM revoked_merkle_tree WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM revoked_secrets WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM merkle_tree WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM organization_contracts WHERE org_id = ?`, orgId)
        await db.run(
            `
            DELETE FROM sessions
            WHERE agent_id IN (SELECT id FROM agents WHERE org_id = ?)
            `,
            orgId
        )
        await db.run(`DELETE FROM credentials WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM agents WHERE org_id = ?`, orgId)
        await db.run(`DELETE FROM users WHERE org_id = ?`, orgId)
        await db.run(
            `
            DELETE FROM auth_sessions
            WHERE user_id NOT IN (SELECT id FROM users)
            `
        )
        await db.run(`DELETE FROM organizations WHERE id = ?`, orgId)

        await db.exec("COMMIT")

        res.json({
            success:true,
            orgId
        })
    }catch(err:any){
        try{
            if(db){
                await db.exec("ROLLBACK")
            }
        }catch{}
        res.status(500).json({ error: err.message })
    }
})

export default router
