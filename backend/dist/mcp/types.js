"use strict";
/**
 * MCP Types for Agentix
 *
 * Type definitions for Model Context Protocol integration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_TOOL_DEFINITIONS = exports.MCP_SERVER_INFO = exports.HeartbeatSchema = exports.ListWhitelistSchema = exports.AddWhitelistSchema = exports.ListCredentialsSchema = exports.AddCredentialSchema = exports.VerifyProofSchema = exports.GenerateProofSchema = exports.GetPermissionsSchema = exports.UpdateAgentSchema = exports.ListAgentsSchema = exports.RevokeAgentSchema = exports.CreateSessionSchema = exports.GetAgentStateSchema = exports.ExecuteActionSchema = exports.RegisterAgentSchema = exports.MCP_TOOLS = void 0;
const zod_1 = require("zod");
// MCP Tool Names
exports.MCP_TOOLS = {
    REGISTER_AGENT: "register_agent",
    EXECUTE_ACTION: "execute_action",
    GET_AGENT_STATE: "get_agent_state",
    CREATE_SESSION: "create_session",
    REVOKE_AGENT: "revoke_agent",
    LIST_AGENTS: "list_agents",
    UPDATE_AGENT: "update_agent",
    GET_PERMISSIONS: "get_permissions",
    GENERATE_PROOF: "generate_proof",
    VERIFY_PROOF: "verify_proof",
    ADD_CREDENTIAL: "add_credential",
    LIST_CREDENTIALS: "list_credentials",
    ADD_WHITELIST: "add_whitelist",
    LIST_WHITELIST: "list_whitelist",
    HEARTBEAT: "heartbeat",
};
// MCP Tool Input Schemas (Zod for validation)
exports.RegisterAgentSchema = zod_1.z.object({
    orgId: zod_1.z.number().int().positive(),
    agentType: zod_1.z.enum([
        "openclaude",
        "langchain",
        "claude_code",
        "custom",
        "crewai",
        "llama_index",
        "autogen",
        "smolagents"
    ]),
    name: zod_1.z.string().min(1).max(255),
    endpoint: zod_1.z.string().url().optional(),
    metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
});
exports.ExecuteActionSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    action: zod_1.z.enum([
        "read_file",
        "write_file",
        "execute_command",
        "query",
        "api_call",
        "sign_transaction",
        "deploy_contract",
        "custom"
    ]),
    params: zod_1.z.record(zod_1.z.unknown()),
    nonce: zod_1.z.string().uuid().optional(),
    timeout: zod_1.z.number().int().min(1000).max(300000).optional(),
    credentialProof: zod_1.z.object({
        nullifier: zod_1.z.string(),
        root: zod_1.z.string(),
        revokedRoot: zod_1.z.string(),
        proof: zod_1.z.object({
            a: zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]),
            b: zod_1.z.tuple([zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]), zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()])]),
            c: zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]),
        }),
        publicSignals: zod_1.z.tuple([zod_1.z.string(), zod_1.z.string(), zod_1.z.string(), zod_1.z.string(), zod_1.z.string()]),
    }).optional(),
});
exports.GetAgentStateSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
});
exports.CreateSessionSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    maxValue: zod_1.z.string().optional(),
    expirySeconds: zod_1.z.number().int().min(60).max(86400 * 30).optional(),
});
exports.RevokeAgentSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    reason: zod_1.z.string().optional(),
});
exports.ListAgentsSchema = zod_1.z.object({
    orgId: zod_1.z.number().int().positive().optional(),
    status: zod_1.z.enum(["disconnected", "connecting", "connected", "running", "paused", "error"]).optional(),
    limit: zod_1.z.number().int().min(1).max(100).optional(),
    offset: zod_1.z.number().int().min(0).optional(),
});
exports.UpdateAgentSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(1).max(255).optional(),
    endpoint: zod_1.z.string().url().optional(),
    apiKey: zod_1.z.string().optional(),
    apiSecret: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().optional(),
    metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
});
exports.GetPermissionsSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
});
exports.GenerateProofSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    action: zod_1.z.string(),
    expirySeconds: zod_1.z.number().int().min(60).max(86400).optional(),
});
exports.VerifyProofSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    proof: zod_1.z.object({
        nullifier: zod_1.z.string(),
        root: zod_1.z.string(),
        revokedRoot: zod_1.z.string(),
        proof: zod_1.z.object({
            a: zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]),
            b: zod_1.z.tuple([zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]), zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()])]),
            c: zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]),
        }),
        publicSignals: zod_1.z.tuple([zod_1.z.string(), zod_1.z.string(), zod_1.z.string(), zod_1.z.string(), zod_1.z.string()]),
    }),
    action: zod_1.z.string(),
});
exports.AddCredentialSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(1),
    value: zod_1.z.string().min(1),
    type: zod_1.z.string().default("api_key"),
    expiresAt: zod_1.z.number().int().optional(),
});
exports.ListCredentialsSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
});
exports.AddWhitelistSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    address: zod_1.z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    name: zod_1.z.string().optional(),
    abi: zod_1.z.string().optional(),
});
exports.ListWhitelistSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
});
exports.HeartbeatSchema = zod_1.z.object({
    agentId: zod_1.z.number().int().positive(),
    orgId: zod_1.z.number().int().positive(),
    status: zod_1.z.enum(["connected", "running", "paused", "error"]).optional(),
    metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
});
// MCP Server Info
exports.MCP_SERVER_INFO = {
    name: "agentix-mcp-server",
    version: "1.0.0",
    description: "Agentix Agent Management MCP Server",
};
// MCP Tool Definitions (for listing)
exports.MCP_TOOL_DEFINITIONS = [
    {
        name: exports.MCP_TOOLS.REGISTER_AGENT,
        description: "Register a new external AI agent with Agentix. Returns agent ID, linked agent ID, and credential details.",
        inputSchema: {
            type: "object",
            properties: {
                orgId: { type: "number", description: "Organization ID" },
                agentType: {
                    type: "string",
                    enum: ["openclaude", "langchain", "claude_code", "custom", "crewai", "llama_index", "autogen", "smolagents"],
                    description: "Type of agent provider"
                },
                name: { type: "string", description: "Human-readable agent name" },
                endpoint: { type: "string", format: "uri", description: "Agent endpoint URL (optional)" },
                metadata: { type: "object", description: "Additional agent metadata (optional)" },
            },
            required: ["orgId", "agentType", "name"],
        },
    },
    {
        name: exports.MCP_TOOLS.EXECUTE_ACTION,
        description: "Execute an action on a registered external agent. Requires agent authorization and optional ZK proof.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID to execute on" },
                orgId: { type: "number", description: "Organization ID" },
                action: {
                    type: "string",
                    enum: ["read_file", "write_file", "execute_command", "query", "api_call", "sign_transaction", "deploy_contract", "custom"],
                    description: "Action type to execute"
                },
                params: { type: "object", description: "Action-specific parameters" },
                nonce: { type: "string", format: "uuid", description: "Unique request ID (optional)" },
                timeout: { type: "number", description: "Timeout in ms (default: 30000)" },
                credentialProof: { type: "object", description: "ZK proof for authorization (optional)" },
            },
            required: ["agentId", "orgId", "action", "params"],
        },
    },
    {
        name: exports.MCP_TOOLS.GET_AGENT_STATE,
        description: "Get the current state of an agent including status, credentials, sessions, and permissions.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.CREATE_SESSION,
        description: "Create an on-chain session for an agent using ZK proof verification.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                maxValue: { type: "string", description: "Maximum transaction value (optional)" },
                expirySeconds: { type: "number", description: "Session expiry in seconds (default: 3600)" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.REVOKE_AGENT,
        description: "Revoke an agent's credentials and deactivate it.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID to revoke" },
                orgId: { type: "number", description: "Organization ID" },
                reason: { type: "string", description: "Reason for revocation (optional)" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.LIST_AGENTS,
        description: "List all agents for an organization with optional status filtering.",
        inputSchema: {
            type: "object",
            properties: {
                orgId: { type: "number", description: "Organization ID" },
                status: { type: "string", enum: ["disconnected", "connecting", "connected", "running", "paused", "error"] },
                limit: { type: "number", description: "Max results (default: 50)" },
                offset: { type: "number", description: "Pagination offset" },
            },
        },
    },
    {
        name: exports.MCP_TOOLS.UPDATE_AGENT,
        description: "Update agent configuration including name, endpoint, API keys, and metadata.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                name: { type: "string", description: "New agent name" },
                endpoint: { type: "string", format: "uri", description: "New endpoint URL" },
                apiKey: { type: "string", description: "API key for authentication" },
                apiSecret: { type: "string", description: "API secret for authentication" },
                isActive: { type: "boolean", description: "Enable/disable agent" },
                metadata: { type: "object", description: "Additional metadata" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.GET_PERMISSIONS,
        description: "Get the permission bitmask and capabilities for an agent.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.GENERATE_PROOF,
        description: "Generate a ZK authorization proof for an agent action.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                action: { type: "string", description: "Action to authorize" },
                expirySeconds: { type: "number", description: "Proof validity in seconds" },
            },
            required: ["agentId", "orgId", "action"],
        },
    },
    {
        name: exports.MCP_TOOLS.VERIFY_PROOF,
        description: "Verify a ZK authorization proof for an action.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                proof: { type: "object", description: "ZK proof to verify" },
                action: { type: "string", description: "Action to verify against" },
            },
            required: ["agentId", "orgId", "proof", "action"],
        },
    },
    {
        name: exports.MCP_TOOLS.ADD_CREDENTIAL,
        description: "Add a vault credential for an agent (API keys, secrets, etc.).",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                name: { type: "string", description: "Credential name" },
                value: { type: "string", description: "Credential value (will be encrypted)" },
                type: { type: "string", description: "Credential type (default: api_key)" },
                expiresAt: { type: "number", description: "Unix timestamp for expiry" },
            },
            required: ["agentId", "orgId", "name", "value"],
        },
    },
    {
        name: exports.MCP_TOOLS.LIST_CREDENTIALS,
        description: "List all vault credentials for an agent (values are masked).",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.ADD_WHITELIST,
        description: "Add a contract address to the agent's whitelist.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                address: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Contract address" },
                name: { type: "string", description: "Contract name (optional)" },
                abi: { type: "string", description: "Contract ABI JSON (optional)" },
            },
            required: ["agentId", "orgId", "address"],
        },
    },
    {
        name: exports.MCP_TOOLS.LIST_WHITELIST,
        description: "List all whitelisted contracts for an agent.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
            },
            required: ["agentId", "orgId"],
        },
    },
    {
        name: exports.MCP_TOOLS.HEARTBEAT,
        description: "Send a heartbeat to update agent status and last seen timestamp.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "number", description: "Agent ID" },
                orgId: { type: "number", description: "Organization ID" },
                status: { type: "string", enum: ["connected", "running", "paused", "error"] },
                metadata: { type: "object", description: "Additional status metadata" },
            },
            required: ["agentId", "orgId"],
        },
    },
];
