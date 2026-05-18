/**
 * Routes for managing autonomous agent execution loops.
 */

import { Router, Response } from "express"
import { requireAuth } from "../middleware/auth"
import type { AuthRequest } from "../types/http"
import {
    startAgentLoop,
    stopAgentLoop,
    pauseAgentLoop,
    resumeAgentLoop,
    getAgentLoopState,
    getActiveLoops,
    queueAgentTask
} from "../services/agentLoop"
import { BlockchainService } from "../services/blockchain"

const router = Router()
const blockchainService = new BlockchainService()

/**
 * Start an autonomous execution loop for an agent.
 * POST /api/agents/:id/loop/start
 */
router.post(
    "/agents/:id/loop/start",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const agentId = parseInt(req.params.id as string)
            const userId = req.auth?.userId

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" })
            }

            // Parse config from request body
            const config = {
                agentId,
                intervalMs: req.body.intervalMs || 60000, // Default 1 minute
                maxExecutions: req.body.maxExecutions,
                timeoutMs: req.body.timeoutMs || 30000, // Default 30 seconds
                conditions: req.body.conditions,
                retryCount: req.body.retryCount || 3,
                retryDelayMs: req.body.retryDelayMs || 5000
            }

            const state = await startAgentLoop(config, blockchainService)

            res.json({
                success: true,
                state
            })
        } catch (error) {
            console.error("Error starting agent loop:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to start agent loop"
            })
        }
    }
)

/**
 * Stop an agent's execution loop.
 * POST /api/agents/:id/loop/stop
 */
router.post(
    "/agents/:id/loop/stop",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const agentId = parseInt(req.params.id as string)

            const state = await stopAgentLoop(agentId)

            if (!state) {
                return res.status(404).json({ error: "No active loop for this agent" })
            }

            res.json({
                success: true,
                state
            })
        } catch (error) {
            console.error("Error stopping agent loop:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to stop agent loop"
            })
        }
    }
)

/**
 * Pause an agent's execution loop.
 * POST /api/agents/:id/loop/pause
 */
router.post(
    "/agents/:id/loop/pause",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const agentId = parseInt(req.params.id as string)

            const state = pauseAgentLoop(agentId)

            if (!state) {
                return res.status(404).json({ error: "No active loop for this agent" })
            }

            res.json({
                success: true,
                state
            })
        } catch (error) {
            console.error("Error pausing agent loop:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to pause agent loop"
            })
        }
    }
)

/**
 * Resume an agent's paused execution loop.
 * POST /api/agents/:id/loop/resume
 */
router.post(
    "/agents/:id/loop/resume",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const agentId = parseInt(req.params.id as string)

            const state = resumeAgentLoop(agentId, blockchainService)

            if (!state) {
                return res.status(404).json({ error: "No paused loop for this agent" })
            }

            res.json({
                success: true,
                state
            })
        } catch (error) {
            console.error("Error resuming agent loop:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to resume agent loop"
            })
        }
    }
)

/**
 * Get the current state of an agent's loop.
 * GET /api/agents/:id/loop
 */
router.get(
    "/agents/:id/loop",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const agentId = parseInt(req.params.id as string)

            const state = getAgentLoopState(agentId)

            if (!state) {
                return res.status(404).json({ error: "No active loop for this agent" })
            }

            res.json({
                success: true,
                state
            })
        } catch (error) {
            console.error("Error getting agent loop state:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to get loop state"
            })
        }
    }
)

/**
 * Get all active loops.
 * GET /api/loops
 */
router.get(
    "/loops",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const loops = getActiveLoops()

            res.json({
                success: true,
                loops,
                count: loops.length
            })
        } catch (error) {
            console.error("Error getting active loops:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to get active loops"
            })
        }
    }
)

/**
 * Queue a task for an agent to execute.
 * POST /api/agents/:id/tasks
 */
router.post(
    "/agents/:id/tasks",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const agentId = parseInt(req.params.id as string)
            const { action, params, scheduledAt } = req.body

            if (!action) {
                return res.status(400).json({ error: "Action is required" })
            }

            const result = await queueAgentTask(
                agentId,
                action,
                params || {},
                scheduledAt
            )

            res.json({
                success: true,
                taskId: result.taskId
            })
        } catch (error) {
            console.error("Error queuing agent task:", error)
            res.status(500).json({
                error: error instanceof Error ? error.message : "Failed to queue task"
            })
        }
    }
)

export default router
