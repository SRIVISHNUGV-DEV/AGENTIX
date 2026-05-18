/**
 * MCP Types for Agentix
 *
 * Type definitions for Model Context Protocol integration
 */

import { z } from "zod"

// MCP Tool Names
export const MCP_TOOLS = {
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
} as const

// MCP Tool Input Schemas (Zod for validation)
export const RegisterAgentSchema = z.object({
  orgId: z.number().int().positive(),
  agentType: z.enum([
    "openclaude",
    "langchain",
    "claude_code",
    "custom",
    "crewai",
    "llama_index",
    "autogen",
    "smolagents"
  ]),
  name: z.string().min(1).max(255),
  endpoint: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const ExecuteActionSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  action: z.enum([
    "read_file",
    "write_file",
    "execute_command",
    "query",
    "api_call",
    "sign_transaction",
    "deploy_contract",
    "custom"
  ]),
  params: z.record(z.unknown()),
  nonce: z.string().uuid().optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
  credentialProof: z.object({
    nullifier: z.string(),
    root: z.string(),
    revokedRoot: z.string(),
    proof: z.object({
      a: z.tuple([z.string(), z.string()]),
      b: z.tuple([z.tuple([z.string(), z.string()]), z.tuple([z.string(), z.string()])]),
      c: z.tuple([z.string(), z.string()]),
    }),
    publicSignals: z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()]),
  }).optional(),
})

export const GetAgentStateSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
})

export const CreateSessionSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  maxValue: z.string().optional(),
  expirySeconds: z.number().int().min(60).max(86400 * 30).optional(),
})

export const RevokeAgentSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  reason: z.string().optional(),
})

export const ListAgentsSchema = z.object({
  orgId: z.number().int().positive().optional(),
  status: z.enum(["disconnected", "connecting", "connected", "running", "paused", "error"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
})

export const UpdateAgentSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  endpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const GetPermissionsSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
})

export const GenerateProofSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  action: z.string(),
  expirySeconds: z.number().int().min(60).max(86400).optional(),
})

export const VerifyProofSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  proof: z.object({
    nullifier: z.string(),
    root: z.string(),
    revokedRoot: z.string(),
    proof: z.object({
      a: z.tuple([z.string(), z.string()]),
      b: z.tuple([z.tuple([z.string(), z.string()]), z.tuple([z.string(), z.string()])]),
      c: z.tuple([z.string(), z.string()]),
    }),
    publicSignals: z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()]),
  }),
  action: z.string(),
})

export const AddCredentialSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  name: z.string().min(1),
  value: z.string().min(1),
  type: z.string().default("api_key"),
  expiresAt: z.number().int().optional(),
})

export const ListCredentialsSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
})

export const AddWhitelistSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().optional(),
  abi: z.string().optional(),
})

export const ListWhitelistSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
})

export const HeartbeatSchema = z.object({
  agentId: z.number().int().positive(),
  orgId: z.number().int().positive(),
  status: z.enum(["connected", "running", "paused", "error"]).optional(),
  metadata: z.record(z.unknown()).optional(),
})

// MCP Tool Response Types
export interface MCPToolResponse {
  content: Array<{
    type: "text"
    text: string
  }>
  isError?: boolean
  _meta?: Record<string, unknown>
}

// MCP Server Info
export const MCP_SERVER_INFO = {
  name: "agentix-mcp-server",
  version: "1.0.0",
  description: "Agentix Agent Management MCP Server",
} as const

// MCP Tool Definitions (for listing)
export const MCP_TOOL_DEFINITIONS = [
  {
    name: MCP_TOOLS.REGISTER_AGENT,
    description: "Register a new external AI agent with Agentix. Returns agent ID, linked agent ID, and credential details.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.EXECUTE_ACTION,
    description: "Execute an action on a registered external agent. Requires agent authorization and optional ZK proof.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.GET_AGENT_STATE,
    description: "Get the current state of an agent including status, credentials, sessions, and permissions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number", description: "Agent ID" },
        orgId: { type: "number", description: "Organization ID" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: MCP_TOOLS.CREATE_SESSION,
    description: "Create an on-chain session for an agent using ZK proof verification.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.REVOKE_AGENT,
    description: "Revoke an agent's credentials and deactivate it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number", description: "Agent ID to revoke" },
        orgId: { type: "number", description: "Organization ID" },
        reason: { type: "string", description: "Reason for revocation (optional)" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: MCP_TOOLS.LIST_AGENTS,
    description: "List all agents for an organization with optional status filtering.",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number", description: "Organization ID" },
        status: { type: "string", enum: ["disconnected", "connecting", "connected", "running", "paused", "error"] },
        limit: { type: "number", description: "Max results (default: 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  {
    name: MCP_TOOLS.UPDATE_AGENT,
    description: "Update agent configuration including name, endpoint, API keys, and metadata.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.GET_PERMISSIONS,
    description: "Get the permission bitmask and capabilities for an agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number", description: "Agent ID" },
        orgId: { type: "number", description: "Organization ID" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: MCP_TOOLS.GENERATE_PROOF,
    description: "Generate a ZK authorization proof for an agent action.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.VERIFY_PROOF,
    description: "Verify a ZK authorization proof for an action.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.ADD_CREDENTIAL,
    description: "Add a vault credential for an agent (API keys, secrets, etc.).",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.LIST_CREDENTIALS,
    description: "List all vault credentials for an agent (values are masked).",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number", description: "Agent ID" },
        orgId: { type: "number", description: "Organization ID" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: MCP_TOOLS.ADD_WHITELIST,
    description: "Add a contract address to the agent's whitelist.",
    inputSchema: {
      type: "object" as const,
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
    name: MCP_TOOLS.LIST_WHITELIST,
    description: "List all whitelisted contracts for an agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number", description: "Agent ID" },
        orgId: { type: "number", description: "Organization ID" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: MCP_TOOLS.HEARTBEAT,
    description: "Send a heartbeat to update agent status and last seen timestamp.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number", description: "Agent ID" },
        orgId: { type: "number", description: "Organization ID" },
        status: { type: "string", enum: ["connected", "running", "paused", "error"] },
        metadata: { type: "object", description: "Additional status metadata" },
      },
      required: ["agentId", "orgId"],
    },
  },
]
