"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const db_1 = require("../db");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
// Supported AI providers and models
const AI_PROVIDERS = ["openai", "anthropic", "gemini", "together", "openrouter", "mistral", "cohere", "groq"];
const AI_MODELS = {
    openai: ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
    anthropic: ["claude-3-5-sonnet", "claude-3-opus", "claude-3-haiku"],
    gemini: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
    together: ["llama-3-70b", "mixtral-8x22b", "qwen-2.5-72b"],
    openrouter: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.1-405b"],
    mistral: ["mistral-large", "mistral-medium", "codestral"],
    cohere: ["command-r-plus", "command-r", "command"],
    groq: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma-7b-it"],
};
// All routes require authentication
router.use(auth_1.requireAuth);
// Get supported AI providers
router.get("/providers", async (req, res) => {
    try {
        res.json({
            providers: AI_PROVIDERS.map((id) => ({
                id,
                name: id.charAt(0).toUpperCase() + id.slice(1),
                models: AI_MODELS[id] || [],
            })),
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.providers");
    }
});
// Get available AI models (optionally filtered by provider)
router.get("/models", async (req, res) => {
    try {
        const provider = req.query.provider;
        if (provider && AI_MODELS[provider]) {
            res.json({ models: AI_MODELS[provider] });
        }
        else {
            // Return all models grouped by provider
            const allModels = Object.entries(AI_MODELS).flatMap(([providerId, models]) => models.map((model) => ({ id: model, provider: providerId })));
            res.json({ models: allModels });
        }
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.models");
    }
});
// List all AI agents for the org
router.get("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const agents = await db.all(`SELECT
        id,
        name,
        provider,
        model,
        api_key_encrypted,
        config,
        created_at,
        updated_at
      FROM ai_agents
      WHERE org_id = $1
      ORDER BY updated_at DESC`, [orgId]);
        res.json({ agents });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.list");
    }
});
// Create AI agent
router.post("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const name = (0, validation_1.requireString)(req.body.name, "name");
        const provider = (0, validation_1.requireString)(req.body.provider, "provider");
        const model = (0, validation_1.requireString)(req.body.model, "model");
        const apiKey = (0, validation_1.optionalString)(req.body.apiKey, "apiKey");
        const config = req.body.config || {};
        // Validate provider
        if (!AI_PROVIDERS.includes(provider)) {
            throw new errors_1.AppError(400, `invalid provider: ${provider}`);
        }
        // Validate model
        if (!AI_MODELS[provider]?.includes(model)) {
            throw new errors_1.AppError(400, `invalid model: ${model} for provider ${provider}`);
        }
        const result = await db.run(`INSERT INTO ai_agents (org_id, name, provider, model, api_key_encrypted, config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, EXTRACT(EPOCH FROM NOW())::INTEGER, EXTRACT(EPOCH FROM NOW())::INTEGER)`, [orgId, name, provider, model, apiKey || null, JSON.stringify(config)]);
        const agent = await db.get(`SELECT id, name, provider, model, config, created_at, updated_at
       FROM ai_agents WHERE id = $1`, [result.lastID]);
        res.status(201).json({ agent: { ...agent, config: JSON.parse(agent.config || "{}") } });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.create");
    }
});
// Get AI agent by ID
router.get("/:agentId", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const agent = await db.get(`SELECT id, name, provider, model, config, created_at, updated_at
       FROM ai_agents
       WHERE id = $1 AND org_id = $2`, [agentId, orgId]);
        if (!agent) {
            throw new errors_1.AppError(404, "agent not found");
        }
        res.json({ agent: { ...agent, config: JSON.parse(agent.config || "{}") } });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.get");
    }
});
// Update AI agent
router.put("/:agentId", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const { name, model, provider, apiKey, config } = req.body;
        // Build update dynamically
        const updates = [];
        const values = [];
        if (name !== undefined) {
            updates.push("name = $" + (values.length + 1));
            values.push(name);
        }
        if (provider !== undefined) {
            if (!AI_PROVIDERS.includes(provider)) {
                throw new errors_1.AppError(400, `invalid provider: ${provider}`);
            }
            updates.push("provider = $" + (values.length + 1));
            values.push(provider);
        }
        if (model !== undefined) {
            const currentProvider = provider || (await db.get("SELECT provider FROM ai_agents WHERE id = $1", [agentId]))?.provider;
            if (!AI_MODELS[currentProvider]?.includes(model)) {
                throw new errors_1.AppError(400, `invalid model: ${model}`);
            }
            updates.push("model = $" + (values.length + 1));
            values.push(model);
        }
        if (apiKey !== undefined) {
            updates.push("api_key_encrypted = $" + (values.length + 1));
            values.push(apiKey);
        }
        if (config !== undefined) {
            updates.push("config = $" + (values.length + 1));
            values.push(JSON.stringify(config));
        }
        if (updates.length === 0) {
            throw new errors_1.AppError(400, "no fields to update");
        }
        updates.push("updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER");
        values.push(agentId, orgId);
        await db.run(`UPDATE ai_agents SET ${updates.join(", ")} WHERE id = $${values.length - 1} AND org_id = $${values.length}`, values);
        const agent = await db.get(`SELECT id, name, provider, model, config, created_at, updated_at
       FROM ai_agents WHERE id = $1`, [agentId]);
        res.json({ agent: { ...agent, config: JSON.parse(agent.config || "{}") } });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.update");
    }
});
// Delete AI agent
router.delete("/:agentId", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        // Delete related runs first
        await db.run(`DELETE FROM ai_agent_runs WHERE agent_id = $1`, [agentId]);
        // Delete the agent
        const result = await db.run(`DELETE FROM ai_agents WHERE id = $1 AND org_id = $2`, [agentId, orgId]);
        if (result.changes === 0) {
            throw new errors_1.AppError(404, "agent not found");
        }
        res.json({ success: true, deleted: agentId });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.delete");
    }
});
// Run inference on AI agent
router.post("/:agentId/run", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const prompt = (0, validation_1.requireString)(req.body.prompt, "prompt");
        const options = req.body.options || {};
        const agent = await db.get(`SELECT provider, model, api_key_encrypted, config
       FROM ai_agents WHERE id = $1 AND org_id = $2`, [agentId, orgId]);
        if (!agent) {
            throw new errors_1.AppError(404, "agent not found");
        }
        // Record the run
        const runResult = await db.run(`INSERT INTO ai_agent_runs (agent_id, prompt, status, created_at)
       VALUES ($1, $2, 'pending', EXTRACT(EPOCH FROM NOW())::INTEGER)`, [agentId, prompt.slice(0, 1000)] // Truncate for storage
        );
        const runId = runResult.lastID;
        // Return immediately (async processing would happen separately)
        res.json({
            runId,
            status: "pending",
            provider: agent.provider,
            model: agent.model,
        });
        // In a real implementation, you'd trigger background processing here
        // For now, we'll mark it as completed with a mock response
        setTimeout(async () => {
            try {
                await db.run(`UPDATE ai_agent_runs
           SET status = 'completed', output = $1, completed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
           WHERE id = $2`, [`Mock response from ${agent.model}: ${prompt.slice(0, 100)}...`, runId]);
            }
            catch (e) {
                console.error("Failed to update run status:", e);
            }
        }, 100);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.run");
    }
});
// Get run history for an agent
router.get("/:agentId/runs", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = req.auth?.orgId;
        if (!orgId) {
            throw new errors_1.AppError(401, "authentication required");
        }
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        // Verify agent belongs to org
        const agent = await db.get(`SELECT id FROM ai_agents WHERE id = $1 AND org_id = $2`, [agentId, orgId]);
        if (!agent) {
            throw new errors_1.AppError(404, "agent not found");
        }
        const runs = await db.all(`SELECT id, prompt, status, output, error, created_at, completed_at
       FROM ai_agent_runs
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`, [agentId, limit]);
        res.json({ runs, total: runs.length });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "ai.runs");
    }
});
exports.default = router;
