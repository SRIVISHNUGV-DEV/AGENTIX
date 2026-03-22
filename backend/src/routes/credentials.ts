import express from "express"
import { initDB } from "../db"
import { IncrementalMerkleTree } from "../services/merkle"
import { BlockchainService } from "../services/blockchain"
import { SparseRevocationTree, toRevocationKey } from "../services/revocationTree"

const router = express.Router()
const blockchain = new BlockchainService()


// Issue credential
router.post("/", async (req,res)=>{

    try{

        const db = await initDB()

        const {
            agentId,
            orgId,
            permissions,
            expiry,
            commitment,
            secretHash
        } = req.body

        if(
            agentId === undefined ||
            orgId === undefined ||
            permissions === undefined ||
            expiry === undefined ||
            !commitment
        ){
            return res.status(400).json({
                error:"agentId, orgId, permissions, expiry and commitment are required"
            })
        }

        const existing = await db.get(
            `
            SELECT id
            FROM credentials
            WHERE agent_id = ?
            `,
            agentId
        )

        if(existing){
            return res.status(409).json({
                error:"credential already exists for agent"
            })
        }

        const tree = new IncrementalMerkleTree(20, { orgId })
        const leafIndex = await tree.getNextLeafIndex(db)

        await db.run(
            `
            INSERT INTO credentials
            (agent_id,org_id,permissions,expiry,commitment,secret_hash,leaf_index)
            VALUES (?,?,?,?,?,?,?)
            `,
            agentId,
            orgId,
            permissions,
            expiry,
            commitment,
            secretHash ?? null,
            leafIndex
        )

        await tree.insert(
            db,
            BigInt(commitment),
            leafIndex
        )

        await tree.rebuildFromCredentials(db)

        const root = await tree.getRoot(db)
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`

        await blockchain.updateActiveRootForOrg(db, orgId, rootHex)

        res.json({
            success:true,
            leafIndex,
            root: root.toString(),
            rootHex
        })

    }catch(err:any){

        res.status(500).json({
            error:err.message
        })
    }
})
// List credentials
router.get("/", async (req:any,res)=>{

    const db = await initDB()

    const creds = req.auth
        ? await db.all(
            `
            SELECT *
            FROM credentials
            WHERE org_id = ?
            ORDER BY leaf_index ASC
            `,
            req.auth.orgId
        )
        : await db.all(
            `
            SELECT *
            FROM credentials
            ORDER BY leaf_index ASC
            `
        )

    res.json(creds)

})

router.post("/revoke", async (req,res)=>{

    try{

        const db = await initDB()
        const { agentId, secretHash } = req.body

        if(agentId === undefined || !secretHash){
            return res.status(400).json({
                error:"agentId and secretHash are required"
            })
        }

        const agent = await db.get(
            `SELECT org_id FROM agents WHERE id = ?`,
            agentId
        )

        if(!agent){
            return res.status(404).json({ error:"agent not found" })
        }

        const orgId = agent.org_id
        const revocationTree = new SparseRevocationTree(orgId)

        const existing = await db.get(
            `
            SELECT id
            FROM revoked_secrets
            WHERE org_id = ? AND secret_hash = ?
            `,
            orgId,
            secretHash
        )

        if(existing){
            return res.status(409).json({
                error:"secret already revoked"
            })
        }

        const smtKey = toRevocationKey(BigInt(secretHash)).toString()
        const existingKey = await db.get(
            `
            SELECT secret_hash
            FROM revoked_secrets
            WHERE org_id = ? AND smt_key = ?
            `,
            orgId,
            smtKey
        )

        if(existingKey && existingKey.secret_hash !== secretHash){
            return res.status(409).json({
                error:"revocation key collision"
            })
        }

        const leafIndex = (
            await db.get(
                "SELECT COALESCE(MAX(leaf_index), -1) + 1 as c FROM revoked_secrets"
            )
        ).c

        await db.run(
            `
            INSERT INTO revoked_secrets
            (agent_id,org_id,secret_hash,smt_key,revoked_value,leaf_index)
            VALUES (?,?,?,?,?,?)
            `,
            agentId,
            orgId,
            secretHash,
            smtKey,
            1,
            leafIndex
        )

        const root = await revocationTree.getRoot(db)
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`

        await blockchain.updateRevokedRootForOrg(db, orgId, rootHex)

        res.json({
            success:true,
            leafIndex,
            root: root.toString(),
            rootHex
        })

    }catch(err:any){

        res.status(500).json({
            error:err.message
        })
    }
})

export default router
