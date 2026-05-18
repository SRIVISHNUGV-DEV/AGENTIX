import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { requireInteger } from "../utils/validation"

const router = express.Router()
const blockchain = new BlockchainService()

router.get("/agents/:agentId/state", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)

        const agent = await db.get(`SELECT * FROM agents WHERE id = ?`, agentId)
        if(!agent || (req.auth && agent.org_id !== req.auth.orgId)){
            return res.status(404).json({ error:"agent not found" })
        }
        const credential = await db.get(`SELECT * FROM credentials WHERE agent_id = ?`, agentId)
        const wallets = await db.all(`SELECT * FROM wallets WHERE agent_id = ? ORDER BY id DESC`, agentId)
        const sessions = await db.all(`SELECT * FROM sessions WHERE agent_id = ? ORDER BY id DESC`, agentId)
        const contracts = await blockchain.getOrganizationContracts(db, agent.org_id)
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
    }catch(error){
        respondWithError(res, error, "v1.agentState")
    }
})

export default router
