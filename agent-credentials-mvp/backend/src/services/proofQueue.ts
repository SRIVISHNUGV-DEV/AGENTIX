import Queue from "bull"
import type { Job } from "bull"
import { initDB } from "../db"
import { IncrementalMerkleTree } from "./merkle"
import { SparseRevocationTree } from "./revocationTree"

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

export interface ProofJobData {
    agentId: number
    orgId: number
    credential: {
        leaf_index: number
        secret_hash: string
    }
}

export interface ProofJobResult {
    success: boolean
    proof?: {
        activePathElements: string[]
        activePathIndices: number[]
        activeRoot: string
        revokedSiblings: string[]
        revokedOldKey: string
        revokedOldValue: string
        revokedIsOld0: number | boolean
        revokedRoot: string
    }
    error?: string
}

// Queue configuration with retry logic and rate limiting
export const proofQueue = new Queue("proof-generation", {
    redis: REDIS_URL,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
    },
    limiter: {
        max: 10,               // Max 10 concurrent proof generations
        duration: 1000,        // Per second
    },
})

// Process jobs with 4 concurrent workers
proofQueue.process(4, async (job: Job<ProofJobData>): Promise<ProofJobResult> => {
    const { agentId, orgId, credential } = job.data

    try {
        job.progress(10)
        const db = await initDB()

        job.progress(30)
        // Rebuild tree and generate proof
        const tree = new IncrementalMerkleTree(20, { orgId })
        await tree.rebuildFromCredentials(db)

        job.progress(60)
        const proof = await tree.generateProof(db, credential.leaf_index)
        const root = await tree.getRoot(db)

        if (!credential.secret_hash) {
            throw new Error("credential is missing secret hash")
        }

        job.progress(80)
        const revokedProof = await new SparseRevocationTree(orgId).generateProof(
            db,
            BigInt(credential.secret_hash)
        )

        job.progress(100)
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
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return {
            success: false,
            error: errorMessage,
        }
    }
})

// Event handlers for monitoring
proofQueue.on("completed", (job, result) => {
    console.log(`[proof-queue] Job ${job.id} completed:`, result.success)
})

proofQueue.on("failed", (job, err) => {
    console.error(`[proof-queue] Job ${job.id} failed:`, err.message)
})

proofQueue.on("stalled", (job) => {
    console.warn(`[proof-queue] Job ${job.id} stalled`)
})

// Health check function
export async function getQueueHealth() {
    const waiting = await proofQueue.getWaitingCount()
    const active = await proofQueue.getActiveCount()
    const completed = await proofQueue.getCompletedCount()
    const failed = await proofQueue.getFailedCount()

    return {
        waiting,
        active,
        completed,
        failed,
        isHealthy: waiting < 100 && failed < 10, // Alert if queue backs up
    }
}

// Add job helper
export async function addProofJob(data: ProofJobData): Promise<Job<ProofJobData>> {
    return proofQueue.add("generate", data)
}

// Get job status
export async function getJobStatus(jobId: string) {
    const job = await proofQueue.getJob(jobId)
    if (!job) return null

    return {
        id: job.id,
        state: await job.getState(),
        progress: job.progress(),
        result: job.returnvalue,
        failedReason: job.failedReason,
    }
}

export default proofQueue
