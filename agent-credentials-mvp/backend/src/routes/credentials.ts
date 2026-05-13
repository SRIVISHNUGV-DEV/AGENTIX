import express from "express"
import { initDB } from "../db"
import { IncrementalMerkleTree } from "../services/merkle"
import { BlockchainService, getBlockchainService } from "../services/blockchain"
import { SparseRevocationTree, toRevocationKey } from "../services/revocationTree"
// FLAW 13 FIX: Import audit logging
import { logAuditEvent, extractClientIP, extractUserAgent } from "../services/audit"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, requireInteger, requireString } from "../utils/validation"

const router = express.Router()
// FLAW 10 FIX: Use singleton blockchain service
const blockchain = getBlockchainService()

router.post("/", async (req, res) => {
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const agentId = requireInteger(req.body.agentId, "agentId", 1)
        const orgId = requireInteger(req.body.orgId, "orgId", 1)
        const permissions = requireInteger(req.body.permissions, "permissions", 0)
        const expiry = requireInteger(req.body.expiry, "expiry", 1)
        const commitment = requireString(req.body.commitment, "commitment", { minLength: 1, maxLength: 256 })
        const secretHash = req.body.secretHash === undefined || req.body.secretHash === null
            ? null
            : requireString(req.body.secretHash, "secretHash", { minLength: 1, maxLength: 256 })

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
            secretHash,
            leafIndex
        )

        await tree.insert(db, BigInt(commitment), leafIndex)
        await tree.rebuildFromCredentials(db)

        const root = await tree.getRoot(db)
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`

        await blockchain.updateActiveRootForOrg(db, orgId, rootHex)

        // FLAW 13 FIX: Audit logging for credential issuance
        await logAuditEvent({
            orgId,
            action: "credential.issue",
            resourceType: "credential",
            resourceId: String(agentId),
            details: { agentId, permissions, expiry, leafIndex },
            ipAddress: extractClientIP(req.headers),
            userAgent: extractUserAgent(req.headers)
        })

        res.json({
            success: true,
            leafIndex,
            root: root.toString(),
            rootHex
        })
    }catch(error){
        respondWithError(res, error, "credentials.issue")
    }
})

router.get("/", async (req:AuthRequest,res)=>{
    try{
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
                SELECT id, agent_id, org_id, permissions, expiry, leaf_index, created_at
                FROM credentials
                ORDER BY leaf_index ASC
                `
            )

        res.json(creds)
    }catch(error){
        respondWithError(res, error, "credentials.list")
    }
})

router.post("/revoke", async (req,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const agentId = requireInteger(req.body.agentId, "agentId", 1)
        const secretHash = requireString(req.body.secretHash, "secretHash", { minLength: 1, maxLength: 256 })

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

        // FLAW 13 FIX: Audit logging for credential revocation
        await logAuditEvent({
            orgId,
            action: "credential.revoke",
            resourceType: "credential",
            resourceId: String(agentId),
            details: { agentId, leafIndex },
            ipAddress: extractClientIP(req.headers),
            userAgent: extractUserAgent(req.headers)
        })

        res.json({
            success: true,
            leafIndex,
            root: root.toString(),
            rootHex
        })
    }catch(error){
        respondWithError(res, error, "credentials.revoke")
    }
})

export default router
