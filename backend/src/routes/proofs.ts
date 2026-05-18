import express from "express"
import rateLimit from "express-rate-limit"
import { initDB } from "../db"
import { IncrementalMerkleTree } from "../services/merkle"
import { SparseRevocationTree } from "../services/revocationTree"
import { addProofJob, getJobStatus, getQueueHealth } from "../services/proofQueue"
import { getProverStatus } from "../services/prover"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { requireInteger } from "../utils/validation"

const router = express.Router()

// FLAW 9 FIX: Rate limiting for proof generation
// Proof generation is CPU-intensive, so limit requests per agent
const proofGenerationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 10, // Max 10 proof requests per minute per IP
    message: {
        error: "Too many proof generation requests. Please wait before trying again.",
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use default keyGenerator for IPv6 support
    keyGenerator: (req) => {
        // Rate limit by agent ID if available, otherwise fall back to default
        const agentId = req.params.agentId
        if (agentId) {
            return `proof:${agentId}`
        }
        // Return undefined to use default IP-based key generator (handles IPv6)
        return undefined as unknown as string
    }
})

// Stricter rate limit for synchronous proof endpoint (more expensive)
const syncProofLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 3, // Max 3 sync proof requests per minute
    message: {
        error: "Too many synchronous proof requests. Use the async endpoint for bulk operations.",
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false
})

// Submit proof generation job (async)
router.post("/:agentId", proofGenerationLimiter, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)

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

        if (!credential) {
            return res.status(404).json({
                error: "credential not found"
            })
        }

        // Add job to queue
        const job = await addProofJob({
            agentId,
            orgId: credential.org_id,
            credential: {
                leaf_index: credential.leaf_index,
                secret_hash: credential.secret_hash,
            }
        })

        res.json({
            jobId: job.id,
            status: "pending",
            message: "Proof generation queued. Poll /proofs/jobs/:jobId for status.",
        })
    } catch (err) {
        respondWithError(res, err, "proofs.post")
    }
})

// Get job status
router.get("/jobs/:jobId", async (req, res) => {
    try {
        const status = await getJobStatus(req.params.jobId)
        if (!status) {
            return res.status(404).json({ error: "Job not found" })
        }
        res.json(status)
    } catch (err) {
        respondWithError(res, err, "proofs.jobs")
    }
})

// Queue health/status
router.get("/queue/status", async (_req, res) => {
    try {
        const health = await getQueueHealth()
        res.json(health)
    } catch (err) {
        respondWithError(res, err, "proofs.queue")
    }
})

// Legacy synchronous endpoint (kept for backward compatibility)
// FLAW 9 FIX: Apply stricter rate limiting to sync proof endpoint
router.get("/:agentId/sync", syncProofLimiter, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const agentId = requireInteger(req.params.agentId, "agentId", 1)

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

        if (!credential) {
            return res.status(404).json({
                error: "credential not found"
            })
        }

        const tree = new IncrementalMerkleTree(20, { orgId: credential.org_id })
        await tree.rebuildFromCredentials(db)
        const proof = await tree.generateProof(db, credential.leaf_index)
        const root = await tree.getRoot(db)

        if (!credential.secret_hash) {
            return res.status(400).json({
                error: "credential is missing secret hash"
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
            revokedRoot: revokedProof.root,
        })
    } catch (err) {
        respondWithError(res, err, "proofs.sync")
    }
})

// Proof system status
router.get("/status", async (_req, res) => {
    try {
        const queueHealth = await getQueueHealth()
        res.json({
            status: "operational",
            queue: queueHealth,
            timestamp: new Date().toISOString()
        })
    } catch (err) {
        respondWithError(res, err, "proofs.status")
    }
})

// Prover status (circuit availability check)
router.get("/prover/status", async (_req, res) => {
    try {
        const proverStatus = getProverStatus()
        res.json({
            ...proverStatus,
            timestamp: new Date().toISOString()
        })
    } catch (err) {
        respondWithError(res, err, "prover.status")
    }
})

export default router
