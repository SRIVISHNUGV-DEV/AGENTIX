"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../db");
const merkle_1 = require("../services/merkle");
const revocationTree_1 = require("../services/revocationTree");
const proofQueue_1 = require("../services/proofQueue");
const prover_1 = require("../services/prover");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
// FLAW 9 FIX: Rate limiting for proof generation
// Proof generation is CPU-intensive, so limit requests per agent
const proofGenerationLimiter = (0, express_rate_limit_1.default)({
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
        const agentId = req.params.agentId;
        if (agentId) {
            return `proof:${agentId}`;
        }
        // Return undefined to use default IP-based key generator (handles IPv6)
        return undefined;
    }
});
// Stricter rate limit for synchronous proof endpoint (more expensive)
const syncProofLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute window
    max: 3, // Max 3 sync proof requests per minute
    message: {
        error: "Too many synchronous proof requests. Use the async endpoint for bulk operations.",
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false
});
// Submit proof generation job (async)
router.post("/:agentId", proofGenerationLimiter, async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const credential = req.auth
            ? await db.get(`
                SELECT c.leaf_index, c.secret_hash, c.org_id
                FROM credentials c
                INNER JOIN agents a ON a.id = c.agent_id
                WHERE c.agent_id = ?
                  AND a.org_id = ?
                `, agentId, req.auth.orgId)
            : await db.get(`
                SELECT leaf_index, secret_hash, org_id
                FROM credentials
                WHERE agent_id = ?
                `, agentId);
        if (!credential) {
            return res.status(404).json({
                error: "credential not found"
            });
        }
        // Add job to queue
        const job = await (0, proofQueue_1.addProofJob)({
            agentId,
            orgId: credential.org_id,
            credential: {
                leaf_index: credential.leaf_index,
                secret_hash: credential.secret_hash,
            }
        });
        res.json({
            jobId: job.id,
            status: "pending",
            message: "Proof generation queued. Poll /proofs/jobs/:jobId for status.",
        });
    }
    catch (err) {
        (0, errors_1.respondWithError)(res, err, "proofs.post");
    }
});
// Get job status
router.get("/jobs/:jobId", async (req, res) => {
    try {
        const status = await (0, proofQueue_1.getJobStatus)(req.params.jobId);
        if (!status) {
            return res.status(404).json({ error: "Job not found" });
        }
        res.json(status);
    }
    catch (err) {
        (0, errors_1.respondWithError)(res, err, "proofs.jobs");
    }
});
// Queue health/status
router.get("/queue/status", async (_req, res) => {
    try {
        const health = await (0, proofQueue_1.getQueueHealth)();
        res.json(health);
    }
    catch (err) {
        (0, errors_1.respondWithError)(res, err, "proofs.queue");
    }
});
// Legacy synchronous endpoint (kept for backward compatibility)
// FLAW 9 FIX: Apply stricter rate limiting to sync proof endpoint
router.get("/:agentId/sync", syncProofLimiter, async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const credential = req.auth
            ? await db.get(`
                SELECT c.leaf_index, c.secret_hash, c.org_id
                FROM credentials c
                INNER JOIN agents a ON a.id = c.agent_id
                WHERE c.agent_id = ?
                  AND a.org_id = ?
                `, agentId, req.auth.orgId)
            : await db.get(`
                SELECT leaf_index, secret_hash, org_id
                FROM credentials
                WHERE agent_id = ?
                `, agentId);
        if (!credential) {
            return res.status(404).json({
                error: "credential not found"
            });
        }
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId: credential.org_id });
        await tree.rebuildFromCredentials(db);
        const proof = await tree.generateProof(db, credential.leaf_index);
        const root = await tree.getRoot(db);
        if (!credential.secret_hash) {
            return res.status(400).json({
                error: "credential is missing secret hash"
            });
        }
        const revokedProof = await new revocationTree_1.SparseRevocationTree(credential.org_id).generateProof(db, BigInt(credential.secret_hash));
        res.json({
            activePathElements: proof.pathElements,
            activePathIndices: proof.pathIndices,
            activeRoot: root.toString(),
            revokedSiblings: revokedProof.siblings,
            revokedOldKey: revokedProof.oldKey,
            revokedOldValue: revokedProof.oldValue,
            revokedIsOld0: revokedProof.isOld0,
            revokedRoot: revokedProof.root,
        });
    }
    catch (err) {
        (0, errors_1.respondWithError)(res, err, "proofs.sync");
    }
});
// Proof system status
router.get("/status", async (_req, res) => {
    try {
        const queueHealth = await (0, proofQueue_1.getQueueHealth)();
        res.json({
            status: "operational",
            queue: queueHealth,
            timestamp: new Date().toISOString()
        });
    }
    catch (err) {
        (0, errors_1.respondWithError)(res, err, "proofs.status");
    }
});
// Prover status (circuit availability check)
router.get("/prover/status", async (_req, res) => {
    try {
        const proverStatus = (0, prover_1.getProverStatus)();
        res.json({
            ...proverStatus,
            timestamp: new Date().toISOString()
        });
    }
    catch (err) {
        (0, errors_1.respondWithError)(res, err, "prover.status");
    }
});
exports.default = router;
