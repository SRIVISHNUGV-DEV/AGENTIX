import express from "express"
import { initDB } from "../db"
import { IncrementalMerkleTree } from "../services/merkle"
import { SparseRevocationTree } from "../services/revocationTree"

const router = express.Router()

router.get("/:agentId", async (req:any,res)=>{

    try{

        const db = await initDB()
        const agentId = Number(req.params.agentId)

        const credential = req.auth
            ? await db.get(
                `
                SELECT c.leaf_index, c.secret_hash, c.org_id
                FROM credentials c
                INNER JOIN agents a ON a.id = c.agent_id
                WHERE c.agent_id = ?
                  AND a.org_id = ?
                `,
                agentId,
                req.auth.orgId
            )
            : await db.get(
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
