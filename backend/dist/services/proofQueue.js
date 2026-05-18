"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueHealth = getQueueHealth;
exports.addProofJob = addProofJob;
exports.getJobStatus = getJobStatus;
const bull_1 = __importDefault(require("bull"));
const db_1 = require("../db");
const merkle_1 = require("./merkle");
const revocationTree_1 = require("./revocationTree");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_ENABLED = process.env.ENABLE_PROOF_QUEUE !== "false";
let proofQueue = null;
let queueReady = false;
// Initialize queue only if enabled
if (QUEUE_ENABLED) {
    try {
        proofQueue = new bull_1.default("proof-generation", {
            redis: REDIS_URL,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 1000,
                },
                removeOnComplete: 100,
                removeOnFail: 50,
            },
            limiter: {
                max: 10,
                duration: 1000,
            },
        });
        // Event handlers for monitoring
        proofQueue.on("completed", (job, result) => {
            console.log(`[proof-queue] Job ${job.id} completed:`, result.success);
        });
        proofQueue.on("failed", (job, err) => {
            console.error(`[proof-queue] Job ${job.id} failed:`, err.message);
        });
        proofQueue.on("stalled", (job) => {
            console.warn(`[proof-queue] Job ${job.id} stalled`);
        });
        queueReady = true;
        console.log("[proof-queue] Bull queue initialized");
    }
    catch (err) {
        console.error("[proof-queue] Failed to initialize queue:", err);
    }
}
else {
    console.log("[proof-queue] Queue disabled (ENABLE_PROOF_QUEUE=false)");
}
// Process jobs with 4 concurrent workers (only if queue is ready)
if (proofQueue) {
    proofQueue.process(4, async (job) => {
        const { agentId, orgId, credential } = job.data;
        try {
            job.progress(10);
            const db = await (0, db_1.initDB)();
            job.progress(30);
            const tree = new merkle_1.IncrementalMerkleTree(20, { orgId });
            await tree.rebuildFromCredentials(db);
            job.progress(60);
            const proof = await tree.generateProof(db, credential.leaf_index);
            const root = await tree.getRoot(db);
            if (!credential.secret_hash) {
                throw new Error("credential is missing secret hash");
            }
            job.progress(80);
            const revokedProof = await new revocationTree_1.SparseRevocationTree(orgId).generateProof(db, BigInt(credential.secret_hash));
            job.progress(100);
            return {
                success: true,
                proof: {
                    activePathElements: proof.pathElements,
                    activePathIndices: proof.pathIndices,
                    activeRoot: root.toString(),
                    revokedSiblings: revokedProof.siblings,
                    revokedOldKey: revokedProof.oldKey,
                    revokedOldValue: revokedProof.oldValue,
                    revokedIsOld0: revokedProof.isOld0,
                    revokedRoot: revokedProof.root,
                },
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            return {
                success: false,
                error: errorMessage,
            };
        }
    });
}
// Health check function
async function getQueueHealth() {
    if (!proofQueue) {
        return {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            isHealthy: true,
            status: "disabled",
        };
    }
    const waiting = await proofQueue.getWaitingCount();
    const active = await proofQueue.getActiveCount();
    const completed = await proofQueue.getCompletedCount();
    const failed = await proofQueue.getFailedCount();
    return {
        waiting,
        active,
        completed,
        failed,
        isHealthy: waiting < 100 && failed < 10,
        status: "active",
    };
}
// Add job helper
async function addProofJob(data) {
    if (!proofQueue) {
        throw new Error("Proof queue is not available. Set ENABLE_PROOF_QUEUE=true and ensure Redis is running.");
    }
    return proofQueue.add("generate", data);
}
// Get job status
async function getJobStatus(jobId) {
    if (!proofQueue) {
        return null;
    }
    const job = await proofQueue.getJob(jobId);
    if (!job)
        return null;
    return {
        id: job.id,
        state: await job.getState(),
        progress: job.progress(),
        result: job.returnvalue,
        failedReason: job.failedReason,
    };
}
exports.default = proofQueue;
