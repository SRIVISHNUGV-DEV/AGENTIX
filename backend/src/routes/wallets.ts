import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"

const router = express.Router()
const blockchain = new BlockchainService()

router.post("/", async (req,res)=>{
    try{
        const db = await initDB()
        const { ownerAddress, agentId } = req.body

        if(!ownerAddress){
            return res.status(400).json({
                error:"ownerAddress is required"
            })
        }

        let orgId:number | null = null
        if(agentId !== undefined && agentId !== null){
            const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
            if(!agent){
                return res.status(404).json({ error:"agent not found" })
            }
            orgId = agent.org_id
        }

        const wallet = await blockchain.createWalletForOrg(
            db,
            orgId ?? 0,
            ownerAddress
        )

        await db.run(
            `
            INSERT INTO wallets
            (agent_id, org_id, owner_address, wallet_address, session_manager_address, implementation_address)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                agent_id = COALESCE(wallets.agent_id, excluded.agent_id),
                org_id = COALESCE(wallets.org_id, excluded.org_id),
                owner_address = excluded.owner_address,
                session_manager_address = excluded.session_manager_address,
                implementation_address = COALESCE(excluded.implementation_address, wallets.implementation_address)
            `,
            agentId ?? null,
            orgId,
            ownerAddress,
            wallet.walletAddress,
            wallet.sessionManagerAddress,
            wallet.implementationAddress ?? null
        )

        res.json({
            success:true,
            ...wallet
        })

    }catch(err:any){
        res.status(500).json({
            error:err.message
        })
    }
})

router.get("/", async (req:any,res)=>{
    const db = await initDB()
    const wallets = req.auth
        ? await db.all(
            `
            SELECT *
            FROM wallets
            WHERE org_id = ?
            ORDER BY id DESC
            `,
            req.auth.orgId
        )
        : await db.all(
            `
            SELECT *
            FROM wallets
            ORDER BY id DESC
            `
        )

    res.json(wallets)
})

export default router
