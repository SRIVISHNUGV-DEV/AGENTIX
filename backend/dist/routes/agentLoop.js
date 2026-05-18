"use strict";
/**
 * Routes for managing autonomous agent execution loops.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const agentLoop_1 = require("../services/agentLoop");
const blockchain_1 = require("../services/blockchain");
const router = (0, express_1.Router)();
const blockchainService = new blockchain_1.BlockchainService();
/**
 * Start an autonomous execution loop for an agent.
 * POST /api/agents/:id/loop/start
 */
router.post("/agents/:id/loop/start", auth_1.requireAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const userId = req.auth?.userId;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
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
        };
        const state = await (0, agentLoop_1.startAgentLoop)(config, blockchainService);
        res.json({
            success: true,
            state
        });
    }
    catch (error) {
        console.error("Error starting agent loop:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to start agent loop"
        });
    }
});
/**
 * Stop an agent's execution loop.
 * POST /api/agents/:id/loop/stop
 */
router.post("/agents/:id/loop/stop", auth_1.requireAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const state = await (0, agentLoop_1.stopAgentLoop)(agentId);
        if (!state) {
            return res.status(404).json({ error: "No active loop for this agent" });
        }
        res.json({
            success: true,
            state
        });
    }
    catch (error) {
        console.error("Error stopping agent loop:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to stop agent loop"
        });
    }
});
/**
 * Pause an agent's execution loop.
 * POST /api/agents/:id/loop/pause
 */
router.post("/agents/:id/loop/pause", auth_1.requireAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const state = (0, agentLoop_1.pauseAgentLoop)(agentId);
        if (!state) {
            return res.status(404).json({ error: "No active loop for this agent" });
        }
        res.json({
            success: true,
            state
        });
    }
    catch (error) {
        console.error("Error pausing agent loop:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to pause agent loop"
        });
    }
});
/**
 * Resume an agent's paused execution loop.
 * POST /api/agents/:id/loop/resume
 */
router.post("/agents/:id/loop/resume", auth_1.requireAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const state = (0, agentLoop_1.resumeAgentLoop)(agentId, blockchainService);
        if (!state) {
            return res.status(404).json({ error: "No paused loop for this agent" });
        }
        res.json({
            success: true,
            state
        });
    }
    catch (error) {
        console.error("Error resuming agent loop:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to resume agent loop"
        });
    }
});
/**
 * Get the current state of an agent's loop.
 * GET /api/agents/:id/loop
 */
router.get("/agents/:id/loop", auth_1.requireAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const state = (0, agentLoop_1.getAgentLoopState)(agentId);
        if (!state) {
            return res.status(404).json({ error: "No active loop for this agent" });
        }
        res.json({
            success: true,
            state
        });
    }
    catch (error) {
        console.error("Error getting agent loop state:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to get loop state"
        });
    }
});
/**
 * Get all active loops.
 * GET /api/loops
 */
router.get("/loops", auth_1.requireAuth, async (req, res) => {
    try {
        const loops = (0, agentLoop_1.getActiveLoops)();
        res.json({
            success: true,
            loops,
            count: loops.length
        });
    }
    catch (error) {
        console.error("Error getting active loops:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to get active loops"
        });
    }
});
/**
 * Queue a task for an agent to execute.
 * POST /api/agents/:id/tasks
 */
router.post("/agents/:id/tasks", auth_1.requireAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const { action, params, scheduledAt } = req.body;
        if (!action) {
            return res.status(400).json({ error: "Action is required" });
        }
        const result = await (0, agentLoop_1.queueAgentTask)(agentId, action, params || {}, scheduledAt);
        res.json({
            success: true,
            taskId: result.taskId
        });
    }
    catch (error) {
        console.error("Error queuing agent task:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to queue task"
        });
    }
});
exports.default = router;
