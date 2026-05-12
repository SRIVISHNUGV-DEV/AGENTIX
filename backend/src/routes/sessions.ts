import express from "express"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"
import { IncrementalMerkleTree } from "../services/merkle"
import { SparseRevocationTree } from "../services/revocationTree"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, requireAddress, requireArray, requireInteger, requireObject, requireString } from "../utils/validation"

const blockchain = new BlockchainService()
const router = express.Router()

router.post("/", async (req,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const agentId = requireInteger(req.body.agentId, "agentId", 1)
        const sessionId = requireString(req.body.sessionId, "sessionId", { minLength: 1, maxLength: 256 })
        const sessionKey = requireAddress(req.body.sessionKey, "sessionKey")
        const maxValue = requireInteger(req.body.maxValue, "maxValue", 0)
        const expiry = requireInteger(req.body.expiry, "expiry", 1)
        const proof = requireObject(req.body.proof, "proof")
        const publicSignals = requireArray(req.body.publicSignals, "publicSignals")

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
    }catch(error){
        respondWithError(res, error, "sessions.create")
    }
})

router.get("/", async (req:AuthRequest,res)=>{
    try{
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
                SELECT id, agent_id, session_id, nullifier, tx_hash, created_at
                FROM sessions
                `
            )

        res.json(sessions)
    }catch(error){
        respondWithError(res, error, "sessions.list")
    }
})

router.get("/proof/:agentId", async (req,res)=>{
    try{
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)

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
        const proof = await tree.generateProof(db, credential.leaf_index)

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
    }catch(error){
        respondWithError(res, error, "sessions.proof")
    }
})

export default router
