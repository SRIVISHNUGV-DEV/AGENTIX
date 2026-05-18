"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const externalAgent_1 = require("../services/externalAgent");
const actionAuth_1 = require("../services/actionAuth");
const agentTools_1 = require("../services/agentTools");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
// Blockchain tool actions that should be handled by backend directly
const BLOCKCHAIN_TOOL_ACTIONS = [
    "send_transaction",
    "batch_transactions",
    "get_wallet_info",
    "check_whitelist",
    "add_to_whitelist",
    "remove_from_whitelist",
    "deposit_gas",
    "get_gas_balance"
];
const router = express_1.default.Router();
const agentService = new externalAgent_1.ExternalAgentService();
// Return available blockchain tools for runtimes
router.get("/tools", (_req, res) => {
    res.json({
        success: true,
        tools: agentTools_1.AGENT_TOOLS,
        note: "Runtimes can call these tools via POST /external/:agentId/execute with action=[tool_name]"
    });
});
router.get("/types", async (req, res) => {
    try {
        const types = externalAgent_1.ExternalAgentService.getSupportedAgentTypes();
        res.json(types);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.types");
    }
});
router.post("/", async (req, res) => {
    try {
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const agentType = (0, validation_1.requireString)(req.body.agentType, "agentType");
        const name = (0, validation_1.requireString)(req.body.name, "name");
        const endpoint = (0, validation_1.optionalString)(req.body.endpoint, "endpoint");
        const metadata = (0, validation_1.validateMetadata)(req.body.metadata, "metadata");
        const linkedAgentId = req.body.linkedAgentId ? (0, validation_1.requireInteger)(req.body.linkedAgentId, "linkedAgentId", 1) : undefined;
        // Verify org exists
        const db = await (0, db_1.initDB)();
        const org = await db.get(`SELECT id FROM organizations WHERE id = ?`, orgId);
        if (!org) {
            return res.status(404).json({ error: "organization not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "CREATE_EXTERNAL_AGENT",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.createExternalAgent(orgId, agentType, name, endpoint, metadata, linkedAgentId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.create");
    }
});
router.get("/", async (req, res) => {
    try {
        const orgIdParam = req.query.orgId;
        if (!orgIdParam) {
            // No org context - return empty array
            return res.json([]);
        }
        const orgId = (0, validation_1.requireInteger)(orgIdParam, "orgId", 1);
        const agents = await agentService.listExternalAgents(orgId);
        res.json(agents);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.list");
    }
});
router.get("/:agentId", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const agent = await agentService.getExternalAgent(agentId, orgId);
        if (!agent) {
            return res.status(404).json({ error: "Agent not found" });
        }
        res.json(agent);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.get");
    }
});
router.put("/:agentId", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "UPDATE_EXTERNAL_AGENT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const updates = {};
        if (req.body.name)
            updates.name = req.body.name;
        if (req.body.endpoint)
            updates.endpoint = req.body.endpoint;
        if (req.body.apiKey)
            updates.apiKey = req.body.apiKey;
        if (req.body.apiSecret)
            updates.apiSecret = req.body.apiSecret;
        if (req.body.isActive !== undefined)
            updates.isActive = req.body.isActive;
        if (req.body.metadata)
            updates.metadata = (0, validation_1.validateMetadata)(req.body.metadata, "metadata");
        const result = await agentService.updateExternalAgent(agentId, orgId, updates);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.update");
    }
});
router.delete("/:agentId", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        // No signature required for disconnect - just verify agent belongs to org
        const db = await (0, db_1.initDB)();
        const agent = await db.get(`SELECT id FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId);
        if (!agent) {
            return res.status(404).json({ error: "Agent not found" });
        }
        const result = await agentService.deleteExternalAgent(agentId, orgId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.delete");
    }
});
router.post("/:agentId/test", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "TEST_EXTERNAL_AGENT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.testConnection(agentId, orgId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.test");
    }
});
router.post("/:agentId/audit", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "AUDIT_EXTERNAL_AGENT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.performSecurityAudit(agentId, orgId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.audit");
    }
});
// Vault credentials routes
router.get("/:agentId/credentials", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const credentials = await agentService.listVaultCredentials(agentId, orgId);
        res.json(credentials);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "credentials.list");
    }
});
router.post("/:agentId/credentials", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const name = (0, validation_1.requireString)(req.body.name, "name");
        const value = (0, validation_1.requireString)(req.body.value, "value");
        const type = (0, validation_1.optionalString)(req.body.type, "type");
        const expiresAt = req.body.expiresAt;
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "ADD_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.addVaultCredential(agentId, orgId, name, value, type ?? "api_key", expiresAt);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "credentials.create");
    }
});
router.delete("/:agentId/credentials/:credentialId", async (req, res) => {
    try {
        const credentialId = (0, validation_1.requireInteger)(req.params.credentialId, "credentialId");
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "DELETE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.deleteVaultCredential(agentId, credentialId, orgId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "credentials.delete");
    }
});
// Funding accounts routes
router.get("/:agentId/funding", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const accounts = await agentService.listFundingAccounts(agentId, orgId);
        res.json(accounts);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "funding.list");
    }
});
router.post("/:agentId/funding", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const walletAddress = (0, validation_1.requireString)(req.body.walletAddress, "walletAddress");
        const encryptedPrivateKey = (0, validation_1.requireString)(req.body.encryptedPrivateKey, "encryptedPrivateKey");
        const dailyLimit = (0, validation_1.optionalString)(req.body.dailyLimit, "dailyLimit");
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "ADD_FUNDING_ACCOUNT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.addFundingAccount(agentId, orgId, walletAddress, encryptedPrivateKey, dailyLimit);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "funding.create");
    }
});
router.delete("/:agentId/funding/:accountId", async (req, res) => {
    try {
        const accountId = (0, validation_1.requireInteger)(req.params.accountId, "accountId");
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "DELETE_FUNDING_ACCOUNT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.deleteFundingAccount(agentId, accountId, orgId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "funding.delete");
    }
});
// Contract whitelist routes
router.get("/:agentId/contracts", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const contracts = await agentService.listWhitelistedContracts(agentId, orgId);
        res.json(contracts);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "contracts.list");
    }
});
// Update external agent status
router.patch("/:agentId/status", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const status = (0, validation_1.requireString)(req.body.status, "status");
        const validStatuses = ["disconnected", "active", "inactive", "error"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
        }
        const db = await (0, db_1.initDB)();
        const result = await db.run(`UPDATE external_agents SET status = ?, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`, status, agentId);
        if (result.changes === 0) {
            return res.status(404).json({ error: "External agent not found" });
        }
        res.json({ success: true, agentId, status });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "external.updateStatus");
    }
});
// ============================================================
// EXECUTION ENDPOINT - Queue and execute actions via runtime
// ============================================================
/**
 * Execute an action via the agent runtime
 * POST /:agentId/execute
 *
 * This endpoint executes an action by:
 * 1. Checking if agent has a runtime endpoint configured
 * 2. If yes, directly invoking the runtime (Lambda, etc.)
 * 3. If no, queuing the task and waiting for polling runtime
 */
router.post("/:agentId/execute", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const action = (0, validation_1.requireString)(req.body.action, "action");
        const params = req.body.params || {};
        const nonce = req.body.nonce || crypto_1.default.randomUUID();
        const timeout = req.body.timeout || 30000;
        const requestedAt = req.body.requestedAt || Math.floor(Date.now() / 1000);
        const db = await (0, db_1.initDB)();
        // Verify agent exists and get runtime endpoint
        const agent = await db.get(`SELECT ea.id, ea.linked_agent_id, ea.status, ea.agent_name, ea.org_id, ea.endpoint, ea.metadata
       FROM external_agents ea
       WHERE ea.id = $1`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "External agent not found" });
        }
        // ============================================================
        // BLOCKCHAIN TOOL HANDLING - Backend executes directly
        // ============================================================
        // Per user requirement: "backend should have all the tools built in
        // for any runtime to just connect and use the blockchain node"
        if (BLOCKCHAIN_TOOL_ACTIONS.includes(action)) {
            console.log(`[execute] Handling blockchain tool directly: ${action}`);
            const agentTools = (0, agentTools_1.getAgentToolsService)();
            const result = await agentTools.executeAction(action, params);
            return res.json({
                id: crypto_1.default.randomUUID(),
                agentId: agentId.toString(),
                action,
                params,
                nonce,
                requestedAt,
                status: result.success ? "completed" : "failed",
                success: result.success,
                result: result.result,
                txHash: result.txHash,
                error: result.error,
                completedAt: Math.floor(Date.now() / 1000)
            });
        }
        // ============================================================
        // RUNTIME HANDLING - Route to Lambda or local runtime
        // ============================================================
        // Check if agent has a Lambda/runtime endpoint configured
        const runtimeEndpoint = agent.endpoint;
        const isLambdaRuntime = runtimeEndpoint && (runtimeEndpoint.includes("lambda-url") ||
            runtimeEndpoint.includes("localhost:3002") ||
            runtimeEndpoint.includes("127.0.0.1:3002"));
        // For chat actions, use local runtime if available (DEVELOPMENT ONLY)
        const nodeEnv = process.env.NODE_ENV || "development";
        const localRuntimeUrl = process.env.LOCAL_RUNTIME_URL || "http://localhost:3002";
        // Only "chat" goes to runtime - blockchain tools are handled by backend
        const runtimeActions = ["chat"];
        // Only allow local runtime in development mode
        const canUseLocalRuntime = nodeEnv === "development" || nodeEnv === "test";
        if (runtimeActions.includes(action) && !isLambdaRuntime && canUseLocalRuntime) {
            // Use local runtime for conversational and wallet actions
            console.log(`[execute] Routing ${action} to local runtime (${nodeEnv} mode): ${localRuntimeUrl}`);
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                const runtimeResponse = await fetch(`${localRuntimeUrl}/execute`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action,
                        params,
                        agentId: agentId.toString(),
                        orgId: agent.org_id
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const runtimeResult = await runtimeResponse.json();
                if (runtimeResult.success) {
                    return res.json({
                        id: crypto_1.default.randomUUID(),
                        agentId: agentId.toString(),
                        action,
                        params,
                        nonce,
                        requestedAt,
                        status: "completed",
                        success: true,
                        result: runtimeResult.result,
                        completedAt: Math.floor(Date.now() / 1000)
                    });
                }
                else {
                    return res.json({
                        id: crypto_1.default.randomUUID(),
                        agentId: agentId.toString(),
                        action,
                        params,
                        nonce,
                        requestedAt,
                        status: "failed",
                        success: false,
                        error: runtimeResult.error || "Runtime execution failed"
                    });
                }
            }
            catch (runtimeError) {
                console.error(`[execute] Local runtime error:`, runtimeError.message);
                return res.status(502).json({
                    error: "Local runtime connection failed",
                    details: runtimeError.message,
                    hint: "Ensure local runtime is running: cd runtime-local && npx tsx server.ts"
                });
            }
        }
        if (isLambdaRuntime) {
            // Direct Lambda invocation - don't queue, just call Lambda directly
            console.log(`[execute] Direct Lambda invocation for agent ${agentId}: ${action}`);
            try {
                const controller2 = new AbortController();
                const timeoutId2 = setTimeout(() => controller2.abort(), timeout);
                const lambdaResponse = await fetch(`${runtimeEndpoint}/execute`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action, params }),
                    signal: controller2.signal
                });
                clearTimeout(timeoutId2);
                const lambdaResult = await lambdaResponse.json();
                // Parse Lambda response
                const statusCode = lambdaResult.statusCode || lambdaResponse.status;
                const body = typeof lambdaResult.body === 'string' ? JSON.parse(lambdaResult.body) : lambdaResult.body || lambdaResult;
                if (statusCode === 200 && body.success) {
                    return res.json({
                        id: crypto_1.default.randomUUID(),
                        agentId: agentId.toString(),
                        action,
                        params,
                        nonce,
                        requestedAt,
                        status: "completed",
                        success: true,
                        result: body.result,
                        executionTimeMs: body.executionTimeMs,
                        completedAt: Math.floor(Date.now() / 1000)
                    });
                }
                else {
                    return res.json({
                        id: crypto_1.default.randomUUID(),
                        agentId: agentId.toString(),
                        action,
                        params,
                        nonce,
                        requestedAt,
                        status: "failed",
                        success: false,
                        error: body.error || "Lambda execution failed"
                    });
                }
            }
            catch (lambdaError) {
                console.error(`[execute] Lambda error:`, lambdaError.message);
                return res.status(502).json({
                    error: "Runtime connection failed",
                    details: lambdaError.message
                });
            }
        }
        // Fallback: Queue-based execution for polling runtimes
        const queueResult = await db.run(`INSERT INTO agent_execution_queue
       (agent_id, action, params, status, priority, created_at)
       VALUES ($1, $2, $3, 'pending', 0, EXTRACT(EPOCH FROM NOW())::INTEGER)
       RETURNING id`, agent.linked_agent_id || agentId, action, JSON.stringify(params));
        const taskId = queueResult.lastID;
        // Wait for execution with polling
        const startTime = Date.now();
        const pollInterval = 500;
        let execution = null;
        while (Date.now() - startTime < timeout) {
            const task = await db.get(`SELECT status, result, error, completed_at FROM agent_execution_queue WHERE id = $1`, taskId);
            if (task && (task.status === "completed" || task.status === "failed")) {
                execution = task;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        // Build response
        const response = {
            id: taskId.toString(),
            agentId: agentId.toString(),
            action,
            params,
            nonce,
            requestedAt,
            status: execution?.status || "timeout",
            success: execution?.status === "completed" || false,
        };
        if (execution?.status === "completed" && execution.result) {
            response.result = JSON.parse(execution.result);
            response.completedAt = execution.completed_at;
        }
        else if (execution?.status === "failed") {
            response.error = execution.error || "Execution failed";
        }
        else if (!execution) {
            response.error = "Execution timed out - no runtime connected";
            response.status = "timeout";
            await db.run(`UPDATE agent_execution_queue SET status = 'failed', error = 'Timeout', completed_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = $1`, taskId);
        }
        res.json(response);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "execute.action");
    }
});
router.post("/:agentId/contracts", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const address = (0, validation_1.requireString)(req.body.address, "address");
        const name = (0, validation_1.optionalString)(req.body.name, "name");
        const abi = (0, validation_1.optionalString)(req.body.abi, "abi");
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "ADD_WHITELISTED_CONTRACT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.addWhitelistedContract(agentId, orgId, address, name, abi);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "contracts.create");
    }
});
router.put("/:agentId/contracts/:contractId", async (req, res) => {
    try {
        const contractId = (0, validation_1.requireInteger)(req.params.contractId, "contractId");
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const enabled = req.body.enabled === true;
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "TOGGLE_CONTRACT_WHITELIST",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        await agentService.toggleContractWhitelist(agentId, contractId, orgId, enabled);
        res.json({ success: true });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "contracts.update");
    }
});
router.delete("/:agentId/contracts/:contractId", async (req, res) => {
    try {
        const contractId = (0, validation_1.requireInteger)(req.params.contractId, "contractId");
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "DELETE_WHITELISTED_CONTRACT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await agentService.deleteWhitelistedContract(agentId, contractId, orgId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "contracts.delete");
    }
});
// ============================================================
// EXECUTION ROUTES - Send tasks to agents
// ============================================================
/**
 * Execute a request on an external agent
 * POST /external/agents/:agentId/execute
 *
 * Request body:
 * - action: The action type (read_file, write_file, execute_command, query, etc.)
 * - params: Action-specific parameters
 * - nonce: Optional unique request identifier
 * - timeout: Optional timeout in ms (default 30000)
 * - credentialProof: Optional ZK proof for authorization
 */
router.post("/:agentId/execute", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const action = (0, validation_1.requireString)(req.body.action, "action");
        const params = req.body.params || {};
        const nonce = req.body.nonce || crypto_1.default.randomUUID();
        const timeout = req.body.timeout || 30000;
        const proof = req.body.credentialProof || undefined;
        // Validate action type
        const validActions = [
            "read_file", "write_file", "execute_command", "query",
            "api_call", "sign_transaction", "deploy_contract", "custom"
        ];
        if (!validActions.includes(action)) {
            return res.status(400).json({
                error: `Invalid action. Must be one of: ${validActions.join(", ")}`
            });
        }
        // Verify signature
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "EXECUTE_AGENT_REQUEST",
            target: `agent:${agentId}`,
            payload: req.body // Contains walletAddress, signature, nonce, requestedAt
        });
        // Execute the request
        const result = await agentService.executeRequest(agentId, orgId, {
            action: action,
            params,
            nonce,
            requestedAt: Math.floor(Date.now() / 1000),
            timeout
        }, proof);
        res.json({
            success: result.success,
            result: result.result,
            executionId: result.executionId,
            executionTime: result.executionTime,
            error: result.error
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "execute");
    }
});
/**
 * Get execution logs for an agent
 * GET /external/agents/:agentId/executions
 *
 * Query params:
 * - limit: Number of logs to return (default 50)
 * - offset: Pagination offset
 * - action: Filter by action type
 */
router.get("/:agentId/executions", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const action = req.query.action;
        const logs = await agentService.getExecutionLogs(agentId, orgId, {
            limit,
            offset,
            action
        });
        res.json(logs);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "executions.list");
    }
});
/**
 * Get execution statistics for an agent
 * GET /external/agents/:agentId/executions/stats
 * NOTE: Must be defined BEFORE /:executionId route to match correctly
 */
router.get("/:agentId/executions/stats", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const stats = await agentService.getExecutionStats(agentId, orgId);
        res.json(stats);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "executions.stats");
    }
});
/**
 * Get a single execution by ID
 * GET /external/agents/:agentId/executions/:executionId
 */
router.get("/:agentId/executions/:executionId", async (req, res) => {
    try {
        const executionId = (0, validation_1.requireInteger)(req.params.executionId, "executionId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const execution = await agentService.getExecution(executionId, orgId);
        if (!execution) {
            return res.status(404).json({ error: "Execution not found" });
        }
        res.json(execution);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "executions.get");
    }
});
// ============================================================
// AUTHORIZATION PROOFS - ZK proof generation and verification
// ============================================================
/**
 * Generate an authorization proof for an agent action
 * POST /external/agents/:agentId/proof
 *
 * Request body:
 * - action: The action to authorize
 * - expirySeconds: Optional expiry time in seconds (default 3600)
 */
router.post("/:agentId/proof", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const action = (0, validation_1.requireString)(req.body.action, "action");
        const expirySeconds = req.body.expirySeconds || 3600;
        // Verify signature
        const db = await (0, db_1.initDB)();
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "GENERATE_AUTHORIZATION_PROOF",
            target: `agent:${agentId}`,
            payload: req.body // Contains walletAddress, signature, nonce, requestedAt
        });
        // Generate the proof
        const result = await agentService.generateAuthorizationProof(agentId, orgId, action, expirySeconds);
        res.json({
            success: true,
            proof: result.proof,
            permissionBitmask: result.permissionBitmask,
            expiresAt: result.expiresAt
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "proof.generate");
    }
});
/**
 * Verify an authorization proof
 * POST /external/agents/:agentId/proof/verify
 *
 * Request body:
 * - proof: The proof to verify
 * - action: The action to verify against
 */
router.post("/:agentId/proof/verify", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const proof = req.body.proof;
        const action = (0, validation_1.requireString)(req.body.action, "action");
        if (!proof || !proof.nullifier || !proof.root) {
            return res.status(400).json({
                error: "Invalid proof format"
            });
        }
        const result = await agentService.verifyAuthorizationProof(agentId, orgId, proof, action);
        res.json({
            valid: result.valid,
            error: result.error
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "proof.verify");
    }
});
/**
 * Get agent permissions
 * GET /external/agents/:agentId/permissions
 */
router.get("/:agentId/permissions", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        const orgId = (0, validation_1.requireInteger)(req.query.orgId, "orgId", 1);
        const db = await (0, db_1.initDB)();
        const agent = await db.get(`SELECT ea.agent_name, c.permissions, c.expiry
       FROM external_agents ea
       LEFT JOIN credentials c ON ea.linked_agent_id = c.agent_id
       WHERE ea.id = ? AND ea.org_id = ?`, agentId, orgId);
        if (!agent) {
            return res.status(404).json({ error: "Agent not found" });
        }
        const permissions = agent.permissions || 255;
        const permissionList = [];
        if (permissions & 1)
            permissionList.push("read_file");
        if (permissions & 2)
            permissionList.push("write_file");
        if (permissions & 4)
            permissionList.push("execute_command");
        if (permissions & 8)
            permissionList.push("query");
        if (permissions & 16)
            permissionList.push("api_call");
        if (permissions & 32)
            permissionList.push("sign_transaction");
        if (permissions & 64)
            permissionList.push("deploy_contract");
        if (permissions & 128)
            permissionList.push("custom");
        res.json({
            agentName: agent.agent_name,
            permissions: permissionList,
            permissionBitmask: permissions,
            expiry: agent.expiry
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "permissions.get");
    }
});
// ============================================================
// RUNTIME POLLING - External runtime communication
// ============================================================
/**
 * Runtime polls for pending tasks
 * POST /:agentId/poll
 *
 * Runtime sends:
 * - runtime_id: Identifier for the runtime instance
 * - capabilities: List of supported actions
 * - max_tasks: Max tasks to return (default 10)
 *
 * Returns:
 * - tasks: Array of pending tasks with id, action, params
 */
router.post("/:agentId/poll", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const runtimeId = req.body.runtimeId || "default";
        const capabilities = req.body.capabilities || [];
        const maxTasks = req.body.maxTasks || 10;
        const db = await (0, db_1.initDB)();
        // Verify agent exists and is active
        const agent = await db.get(`SELECT id, status, linked_agent_id FROM external_agents WHERE id = $1`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "Agent not found" });
        }
        // Update agent status and heartbeat
        await db.run(`UPDATE external_agents
       SET status = 'active',
           last_heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
           updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
       WHERE id = $1`, agentId);
        // Fetch pending tasks from the execution queue
        const tasks = await db.all(`SELECT id, action, params, priority, created_at
       FROM agent_execution_queue
       WHERE agent_id = $1
         AND status = 'pending'
         AND (scheduled_at IS NULL OR scheduled_at <= EXTRACT(EPOCH FROM NOW())::INTEGER)
       ORDER BY priority DESC, created_at ASC
       LIMIT $2`, agent.linked_agent_id || agentId, maxTasks);
        // Mark tasks as picked up
        if (tasks.length > 0) {
            const taskIds = tasks.map((t) => t.id);
            await db.run(`UPDATE agent_execution_queue
         SET status = 'running', started_at = EXTRACT(EPOCH FROM NOW())::INTEGER
         WHERE id IN (${taskIds.map(() => "?").join(",")})`, ...taskIds);
        }
        res.json({
            agentId,
            runtimeId,
            tasks: tasks.map((t) => ({
                taskId: t.id,
                action: t.action,
                params: JSON.parse(t.params || "{}"),
                priority: t.priority,
                createdAt: t.created_at
            })),
            polledAt: Math.floor(Date.now() / 1000)
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "runtime.poll");
    }
});
/**
 * Runtime reports task completion
 * POST /:agentId/report
 *
 * Runtime sends:
 * - taskId: The task ID
 * - success: Boolean indicating success
 * - result: The result data
 * - error: Error message if failed
 */
router.post("/:agentId/report", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const taskId = (0, validation_1.requireInteger)(req.body.taskId, "taskId");
        const success = req.body.success === true;
        const result = req.body.result || null;
        const error = req.body.error || null;
        const db = await (0, db_1.initDB)();
        // Update task in queue
        const updateResult = await db.run(`UPDATE agent_execution_queue
       SET status = $1,
           result = $2,
           error = $3,
           completed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
       WHERE id = $4`, success ? "completed" : "failed", result ? JSON.stringify(result) : null, error, taskId);
        if (updateResult.changes === 0) {
            return res.status(404).json({ error: "Task not found" });
        }
        // Also log to execution logs
        const task = await db.get(`SELECT action, params FROM agent_execution_queue WHERE id = $1`, taskId);
        if (task) {
            await db.run(`INSERT INTO agent_execution_logs
         (external_agent_id, org_id, request_id, action, params, result, success, error_message, execution_time_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, agentId, req.body.orgId || 1, `task-${taskId}`, task.action, task.params, result ? JSON.stringify(result) : null, success, error, req.body.executionTimeMs || 0);
        }
        res.json({
            success: true,
            taskId,
            status: success ? "completed" : "failed"
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "runtime.report");
    }
});
/**
 * Queue a new task for an agent
 * POST /:agentId/queue
 *
 * Allows external systems to queue tasks for runtime execution
 */
router.post("/:agentId/queue", async (req, res) => {
    try {
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId");
        (0, validation_1.ensureBodyObject)(req.body);
        const action = (0, validation_1.requireString)(req.body.action, "action");
        const params = req.body.params || {};
        const priority = req.body.priority || 0;
        const scheduledAt = req.body.scheduledAt || null;
        const db = await (0, db_1.initDB)();
        // Verify agent exists
        const agent = await db.get(`SELECT id, linked_agent_id FROM external_agents WHERE id = $1`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "Agent not found" });
        }
        // Insert task into queue
        const result = await db.run(`INSERT INTO agent_execution_queue
       (agent_id, action, params, status, priority, scheduled_at)
       VALUES ($1, $2, $3, 'pending', $4, $5)
       RETURNING id`, agent.linked_agent_id || agentId, action, JSON.stringify(params), priority, scheduledAt);
        res.json({
            success: true,
            taskId: result.lastID,
            message: "Task queued successfully"
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "runtime.queue");
    }
});
exports.default = router;
