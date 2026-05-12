import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"
import { PlatformService } from "../services/platform"
import { requireSignedAction } from "../services/actionAuth"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, optionalAddress, requireInteger, requireString } from "../utils/validation"

const router = express.Router()
const blockchain = new BlockchainService()
const platform = new PlatformService()

router.post("/", async (req,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const name = requireString(req.body.name, "name", { minLength: 2, maxLength: 120 })
        const ownerWalletAddress = optionalAddress(req.body.ownerWalletAddress, "ownerWalletAddress")

        const result = await db.run(
            `
            INSERT INTO organizations (name, owner_wallet_address)
            VALUES (?,?)
            `,
            name,
            ownerWalletAddress
        )

        res.json({
            id: result.lastID,
            name,
            ownerWalletAddress
        })
    }catch(error){
        respondWithError(res, error, "orgs.create")
    }
})

router.get("/", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()

        const orgs = req.auth
            ? await db.all("SELECT * FROM organizations WHERE id = ?", req.auth.orgId)
            : await db.all("SELECT id, name, owner_wallet_address, created_at FROM organizations")

        res.json(orgs)
    }catch(error){
        respondWithError(res, error, "orgs.list")
    }
})

router.post("/:orgId/deploy-contracts", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const orgId = requireInteger(req.params.orgId, "orgId", 1)
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

        const force = Boolean(req.body?.force)
        const contracts = await blockchain.deployOrganizationContracts(db, orgId, { force })

        res.json({
            success:true,
            organization: org,
            contracts,
            redeployed: force
        })
    }catch(error){
        respondWithError(res, error, "orgs.deployContracts")
    }
})

router.get("/:orgId/state", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const orgId = requireInteger(req.params.orgId, "orgId", 1)
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
    }catch(error){
        respondWithError(res, error, "orgs.state")
    }
})

router.post("/:orgId/fund", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const orgId = requireInteger(req.params.orgId, "orgId", 1)
        if(req.auth && req.auth.orgId !== orgId){
            return res.status(403).json({ error:"forbidden" })
        }

        ensureBodyObject(req.body)
        const amountEth = requireString(req.body.amountEth, "amountEth", { minLength: 1, maxLength: 40 })

        await requireSignedAction(db, {
            orgId,
            action: "FUND_ORG",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        })

        const result = await platform.fundOrganization(db, orgId, amountEth)
        res.json(result)
    }catch(error){
        respondWithError(res, error, "orgs.fund")
    }
})

router.delete("/:orgId", async (req:AuthRequest,res)=>{
    let db:any = null
    try{
        db = await initDB()
        const orgId = requireInteger(req.params.orgId, "orgId", 1)

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
    }catch(error){
        try{
            if(db){
                await db.exec("ROLLBACK")
            }
        }catch{}
        respondWithError(res, error, "orgs.delete")
    }
})

export default router
