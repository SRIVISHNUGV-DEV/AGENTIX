import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"
import { IncrementalMerkleTree } from "../services/merkle"
import { SparseRevocationTree } from "../services/revocationTree"

const blockchain = new BlockchainService()
const router = express.Router()

router.post("/", async (req,res)=>{

    try{

        const db = await initDB()
        const {
            agentId,
            sessionId,
            sessionKey,
            maxValue,
            expiry,
            proof,
            publicSignals
        } = req.body

        if(
            agentId === undefined ||
            !sessionId ||
            !sessionKey ||
            maxValue === undefined ||
            expiry === undefined ||
            !proof ||
            !publicSignals
        ){
            return res.status(400).json({
                error:"agentId, sessionId, sessionKey, maxValue, expiry, proof and publicSignals are required"
            })
        }

        const agent = await db.get(
            `SELECT org_id FROM agents WHERE id = ?`,
            agentId
        )

        if(!agent){
            return res.status(404).json({ error:"agent not found" })
        }

        const tx = await blockchain.submitSessionForOrg(
            db,
            agent.org_id,
            sessionId,
            sessionKey,
            maxValue,
            expiry,
            proof,
            publicSignals
        )

        await db.run(
            `
            INSERT INTO sessions
            (agent_id,session_id,nullifier,proof,public_signals,tx_hash)
            VALUES (?,?,?,?,?,?)
            `,
            agentId,
            sessionId,
            publicSignals[0],
            JSON.stringify(proof),
            JSON.stringify({
                sessionId,
                sessionKey,
                maxValue,
                expiry,
                publicSignals
            }),
            tx.txHash
        )

        res.json({
            success:true,
            txHash:tx.txHash
        })

    }catch(err:any){

        res.status(500).json({
            error:err.message
        })
    }

})


// List sessions
router.get("/", async (req:any,res)=>{

    const db = await initDB()

    const sessions = req.auth
        ? await db.all(
            `
            SELECT s.*
            FROM sessions s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE a.org_id = ?
            `,
            req.auth.orgId
        )
        : await db.all(
            `
            SELECT *
            FROM sessions
            `
        )

    res.json(sessions)

})

router.get("/proof/:agentId", async (req,res)=>{

    try{

        const db = await initDB()
        const agentId = Number(req.params.agentId)

        const credential = await db.get(
            `
            SELECT leaf_index, secret_hash, org_id
            FROM credentials
            WHERE agent_id = ?
            `,
            agentId
        )

        if(!credential){
            return res.status(404).json({
                error:"credential not found"
            })
        }

        const tree = new IncrementalMerkleTree(20, { orgId: credential.org_id })
        await tree.rebuildFromCredentials(db)
        const proof = await tree.generateProof(
            db,
            credential.leaf_index
        )

        const root = await tree.getRoot(db)
        if(!credential.secret_hash){
            return res.status(400).json({
                error:"credential is missing secret hash"
            })
        }

        const revokedProof = await new SparseRevocationTree(credential.org_id).generateProof(
            db,
            BigInt(credential.secret_hash)
        )

        res.json({
            activePathElements: proof.pathElements,
            activePathIndices: proof.pathIndices,
            activeRoot: root.toString(),
            revokedSiblings: revokedProof.siblings,
            revokedOldKey: revokedProof.oldKey,
            revokedOldValue: revokedProof.oldValue,
            revokedIsOld0: revokedProof.isOld0,
            revokedRoot: revokedProof.root
        })

    }catch(err:any){

        res.status(500).json({
            error:err.message
        })
    }
})

export default router
