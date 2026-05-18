"use strict";
/**
 * Agentix MCP Server Implementation
 *
 * Model Context Protocol (MCP) server that exposes Agentix
 * agent management capabilities to external AI providers.
 *
 * Supports both stdio and SSE (Server-Sent Events) transports.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMCPServer = createMCPServer;
exports.createMCPRouter = createMCPRouter;
exports.getActiveTransportCount = getActiveTransportCount;
exports.getTransportEvents = getTransportEvents;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const express_1 = __importDefault(require("express"));
const events_1 = require("events");
const externalAgent_1 = require("../services/externalAgent");
const db_1 = require("../db");
const errors_1 = require("../utils/errors");
const types_1 = require("./types");
const agentService = new externalAgent_1.ExternalAgentService();
/**
 * Create the MCP server instance
 */
function createMCPServer() {
    const server = new index_js_1.Server({
        name: types_1.MCP_SERVER_INFO.name,
        version: types_1.MCP_SERVER_INFO.version,
    }, {
        capabilities: {
            tools: {},
            resources: {},
        },
    });
    // List tools handler
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
        return {
            tools: types_1.MCP_TOOL_DEFINITIONS,
        };
    });
    // Call tool handler
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            switch (name) {
                case types_1.MCP_TOOLS.REGISTER_AGENT:
                    return await handleRegisterAgent(args);
                case types_1.MCP_TOOLS.EXECUTE_ACTION:
                    return await handleExecuteAction(args);
                case types_1.MCP_TOOLS.GET_AGENT_STATE:
                    return await handleGetAgentState(args);
                case types_1.MCP_TOOLS.CREATE_SESSION:
                    return await handleCreateSession(args);
                case types_1.MCP_TOOLS.REVOKE_AGENT:
                    return await handleRevokeAgent(args);
                case types_1.MCP_TOOLS.LIST_AGENTS:
                    return await handleListAgents(args);
                case types_1.MCP_TOOLS.UPDATE_AGENT:
                    return await handleUpdateAgent(args);
                case types_1.MCP_TOOLS.GET_PERMISSIONS:
                    return await handleGetPermissions(args);
                case types_1.MCP_TOOLS.GENERATE_PROOF:
                    return await handleGenerateProof(args);
                case types_1.MCP_TOOLS.VERIFY_PROOF:
                    return await handleVerifyProof(args);
                case types_1.MCP_TOOLS.ADD_CREDENTIAL:
                    return await handleAddCredential(args);
                case types_1.MCP_TOOLS.LIST_CREDENTIALS:
                    return await handleListCredentials(args);
                case types_1.MCP_TOOLS.ADD_WHITELIST:
                    return await handleAddWhitelist(args);
                case types_1.MCP_TOOLS.LIST_WHITELIST:
                    return await handleListWhitelist(args);
                case types_1.MCP_TOOLS.HEARTBEAT:
                    return await handleHeartbeat(args);
                default:
                    return createErrorResponse(`Unknown tool: ${name}`);
            }
        }
        catch (error) {
            return createErrorResponse(error.message || "Internal server error");
        }
    });
    // List resources handler (for agent discovery)
    server.setRequestHandler(types_js_1.ListResourcesRequestSchema, async () => {
        return {
            resources: [
                {
                    uri: "agentix://agent-types",
                    name: "Supported Agent Types",
                    mimeType: "application/json",
                },
                {
                    uri: "agentix://permissions",
                    name: "Permission Bitmasks",
                    mimeType: "application/json",
                },
            ],
        };
    });
    // Read resource handler
    server.setRequestHandler(types_js_1.ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        if (uri === "agentix://agent-types") {
            return {
                contents: [
                    {
                        uri,
                        mimeType: "application/json",
                        text: JSON.stringify(externalAgent_1.ExternalAgentService.getSupportedAgentTypes(), null, 2),
                    },
                ],
            };
        }
        if (uri === "agentix://permissions") {
            return {
                contents: [
                    {
                        uri,
                        mimeType: "application/json",
                        text: JSON.stringify(externalAgent_1.AGENT_PERMISSIONS, null, 2),
                    },
                ],
            };
        }
        throw new errors_1.AppError(404, `Resource not found: ${uri}`);
    });
    return server;
}
// ============================================================
// Tool Handlers
// ============================================================
async function handleRegisterAgent(args) {
    const parsed = types_1.RegisterAgentSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { orgId, agentType, name, endpoint, metadata } = parsed.data;
    const result = await agentService.createExternalAgent(orgId, agentType, name, endpoint, metadata);
    return createSuccessResponse({
        success: true,
        agentId: result.agentId,
        linkedAgentId: result.linkedAgentId,
        name: result.name,
        agentType: result.agentType,
        message: `Agent "${name}" registered successfully`,
    });
}
async function handleExecuteAction(args) {
    const parsed = types_1.ExecuteActionSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, action, params, nonce, timeout, credentialProof } = parsed.data;
    const result = await agentService.executeRequest(agentId, orgId, {
        action: action,
        params,
        nonce: nonce || crypto.randomUUID(),
        requestedAt: Math.floor(Date.now() / 1000),
        timeout: timeout || 30000,
    }, credentialProof);
    return createSuccessResponse({
        success: result.success,
        executionId: result.executionId,
        result: result.result,
        error: result.error,
        executionTime: result.executionTime,
    });
}
async function handleGetAgentState(args) {
    const parsed = types_1.GetAgentStateSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId } = parsed.data;
    const agent = await agentService.getExternalAgent(agentId, orgId);
    if (!agent) {
        return createErrorResponse("Agent not found");
    }
    // Get credentials
    const credentials = await agentService.listVaultCredentials(agentId, orgId);
    // Get whitelisted contracts
    const whitelist = await agentService.listWhitelistedContracts(agentId, orgId);
    // Get execution stats
    const stats = await agentService.getExecutionStats(agentId, orgId);
    return createSuccessResponse({
        agent: {
            id: agent.id,
            name: agent.name,
            type: agent.agentType,
            status: agent.status,
            isActive: agent.isActive,
            endpoint: agent.endpoint,
            lastHeartbeat: agent.lastHeartbeatAt,
            createdAt: agent.createdAt,
        },
        credentials: credentials.length,
        whitelistedContracts: whitelist.length,
        executions: stats,
    });
}
async function handleCreateSession(args) {
    const parsed = types_1.CreateSessionSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, expirySeconds } = parsed.data;
    // Generate an authorization proof for session creation
    const proofResult = await agentService.generateAuthorizationProof(agentId, orgId, "create_session", expirySeconds || 3600);
    return createSuccessResponse({
        success: true,
        proof: proofResult.proof,
        permissionBitmask: proofResult.permissionBitmask,
        expiresAt: proofResult.expiresAt,
        message: "Session authorization proof generated. Submit to blockchain to create session.",
    });
}
async function handleRevokeAgent(args) {
    const parsed = types_1.RevokeAgentSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId } = parsed.data;
    const result = await agentService.deleteExternalAgent(agentId, orgId);
    return createSuccessResponse({
        success: result.success,
        agentId,
        message: "Agent revoked and deleted successfully",
    });
}
async function handleListAgents(args) {
    const parsed = types_1.ListAgentsSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { orgId, status, limit, offset } = parsed.data;
    let agents = await agentService.listExternalAgents(orgId);
    // Filter by status if provided
    if (status) {
        agents = agents.filter(a => a.status === status);
    }
    // Apply pagination
    const paginatedAgents = agents.slice(offset || 0, (offset || 0) + (limit || 50));
    return createSuccessResponse({
        total: agents.length,
        agents: paginatedAgents.map(a => ({
            id: a.id,
            name: a.name,
            type: a.agentType,
            status: a.status,
            isActive: a.isActive,
            endpoint: a.endpoint,
            lastHeartbeat: a.lastHeartbeatAt,
        })),
    });
}
async function handleUpdateAgent(args) {
    const parsed = types_1.UpdateAgentSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, ...updates } = parsed.data;
    // Remove undefined values
    const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    const result = await agentService.updateExternalAgent(agentId, orgId, cleanUpdates);
    return createSuccessResponse({
        success: result.success,
        agentId,
        message: "Agent updated successfully",
    });
}
async function handleGetPermissions(args) {
    const parsed = types_1.GetPermissionsSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId } = parsed.data;
    const db = await (0, db_1.initDB)();
    const agent = await db.get(`SELECT ea.agent_name, c.permissions, c.expiry
     FROM external_agents ea
     LEFT JOIN credentials c ON ea.linked_agent_id = c.agent_id
     WHERE ea.id = ? AND ea.org_id = ?`, agentId, orgId);
    if (!agent) {
        return createErrorResponse("Agent not found");
    }
    const permissions = agent.permissions || externalAgent_1.AGENT_PERMISSIONS.ALL;
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
    return createSuccessResponse({
        agentName: agent.agent_name,
        permissions: permissionList,
        permissionBitmask: permissions,
        expiry: agent.expiry,
    });
}
async function handleGenerateProof(args) {
    const parsed = types_1.GenerateProofSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, action, expirySeconds } = parsed.data;
    const result = await agentService.generateAuthorizationProof(agentId, orgId, action, expirySeconds || 3600);
    return createSuccessResponse({
        success: true,
        proof: result.proof,
        permissionBitmask: result.permissionBitmask,
        expiresAt: result.expiresAt,
    });
}
async function handleVerifyProof(args) {
    const parsed = types_1.VerifyProofSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, proof, action } = parsed.data;
    const result = await agentService.verifyAuthorizationProof(agentId, orgId, proof, action);
    return createSuccessResponse({
        valid: result.valid,
        error: result.error,
    });
}
async function handleAddCredential(args) {
    const parsed = types_1.AddCredentialSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, name, value, type, expiresAt } = parsed.data;
    const result = await agentService.addVaultCredential(agentId, orgId, name, value, type, expiresAt);
    return createSuccessResponse({
        success: true,
        credentialId: result.credentialId,
        message: `Credential "${name}" added successfully`,
    });
}
async function handleListCredentials(args) {
    const parsed = types_1.ListCredentialsSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId } = parsed.data;
    const credentials = await agentService.listVaultCredentials(agentId, orgId);
    return createSuccessResponse({
        credentials: credentials.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            maskedValue: c.maskedValue,
            expiresAt: c.expiresAt,
            createdAt: c.createdAt,
        })),
    });
}
async function handleAddWhitelist(args) {
    const parsed = types_1.AddWhitelistSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, address, name, abi } = parsed.data;
    const result = await agentService.addWhitelistedContract(agentId, orgId, address, name, abi);
    return createSuccessResponse({
        success: true,
        contractId: result.contractId,
        address,
        message: `Contract whitelisted successfully`,
    });
}
async function handleListWhitelist(args) {
    const parsed = types_1.ListWhitelistSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId } = parsed.data;
    const contracts = await agentService.listWhitelistedContracts(agentId, orgId);
    return createSuccessResponse({
        contracts: contracts.map(c => ({
            id: c.id,
            address: c.address,
            name: c.name,
            isEnabled: c.isEnabled,
            createdAt: c.createdAt,
        })),
    });
}
async function handleHeartbeat(args) {
    const parsed = types_1.HeartbeatSchema.safeParse(args);
    if (!parsed.success) {
        return createErrorResponse(`Invalid arguments: ${parsed.error.message}`);
    }
    const { agentId, orgId, status, metadata } = parsed.data;
    const db = await (0, db_1.initDB)();
    // Verify agent exists
    const agent = await db.get(`SELECT id FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId);
    if (!agent) {
        return createErrorResponse("Agent not found");
    }
    // Update heartbeat
    await db.run(`UPDATE external_agents
     SET last_heartbeat_at = ?,
         status = COALESCE(?, status),
         metadata = COALESCE(?, metadata),
         updated_at = ?
     WHERE id = ?`, Math.floor(Date.now() / 1000), status || null, metadata ? JSON.stringify(metadata) : null, Math.floor(Date.now() / 1000), agentId);
    return createSuccessResponse({
        success: true,
        agentId,
        receivedAt: Math.floor(Date.now() / 1000),
    });
}
// ============================================================
// Response Helpers
// ============================================================
function createSuccessResponse(data) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}
function createErrorResponse(message) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ error: message }, null, 2),
            },
        ],
        isError: true,
    };
}
// ============================================================
// SSE Transport Server (for HTTP/WebSocket clients)
// ============================================================
const activeTransports = new Map();
const transportEvents = new events_1.EventEmitter();
/**
 * Create Express router for MCP over SSE
 */
function createMCPRouter() {
    const router = express_1.default.Router();
    // SSE endpoint for MCP clients
    router.get("/sse", async (req, res) => {
        const sessionId = crypto.randomUUID();
        const transport = new sse_js_1.SSEServerTransport("/mcp/message", res);
        activeTransports.set(sessionId, transport);
        const server = createMCPServer();
        await server.connect(transport);
        transport.onclose = () => {
            activeTransports.delete(sessionId);
            transportEvents.emit("transport:closed", sessionId);
        };
        transport.onerror = (error) => {
            activeTransports.delete(sessionId);
            transportEvents.emit("transport:error", sessionId, error);
        };
        // Keep connection alive
        req.on("close", () => {
            activeTransports.delete(sessionId);
        });
    });
    // Message endpoint for SSE transport
    router.post("/message", express_1.default.json(), async (req, res) => {
        const sessionId = req.query.sessionId;
        const transport = activeTransports.get(sessionId);
        if (!transport) {
            return res.status(404).json({ error: "Session not found" });
        }
        await transport.handlePostMessage(req, res);
    });
    // Health check
    router.get("/health", (req, res) => {
        res.json({
            status: "healthy",
            activeConnections: activeTransports.size,
            server: types_1.MCP_SERVER_INFO,
        });
    });
    // List available tools (for discovery)
    router.get("/tools", (req, res) => {
        res.json({
            server: types_1.MCP_SERVER_INFO,
            tools: types_1.MCP_TOOL_DEFINITIONS,
        });
    });
    // Direct tool call endpoint (for testing/simple integrations)
    router.post("/call", express_1.default.json(), async (req, res) => {
        try {
            const { name, arguments: args } = req.body;
            if (!name || typeof name !== "string") {
                return res.status(400).json({ error: "Missing or invalid tool name" });
            }
            // Find the tool handler
            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return res.status(404).json({ error: `Unknown tool: ${name}` });
            }
            // Execute the tool
            const result = await handler(args || {});
            res.json(result);
        }
        catch (error) {
            console.error("MCP call error:", error);
            res.status(500).json({
                error: error instanceof Error ? error.message : "Internal server error",
            });
        }
    });
    return router;
}
/**
 * Get active transport count
 */
function getActiveTransportCount() {
    return activeTransports.size;
}
/**
 * Get transport events for monitoring
 */
function getTransportEvents() {
    return transportEvents;
}
// ============================================================
// Tool Handlers Map (for direct /call endpoint)
// ============================================================
const TOOL_HANDLERS = {
    register_agent: handleRegisterAgent,
    execute_action: handleExecuteAction,
    get_agent_state: handleGetAgentState,
    create_session: handleCreateSession,
    revoke_agent: handleRevokeAgent,
    list_agents: handleListAgents,
    update_agent: handleUpdateAgent,
    get_permissions: handleGetPermissions,
    generate_proof: handleGenerateProof,
    verify_proof: handleVerifyProof,
    add_credential: handleAddCredential,
    list_credentials: handleListCredentials,
    add_whitelist: handleAddWhitelist,
    list_whitelist: handleListWhitelist,
    heartbeat: handleHeartbeat,
};
