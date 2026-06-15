import { InMemoryStore } from "./store.js"
import { checkCircuits, generateProof, getProverStatus } from "./circuits.js"
import { ethers } from "ethers"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import fs from "fs"
import path from "path"
import { buildPoseidon } from "circomlibjs"

const store = new InMemoryStore()

const CHAIN_ID = Number(process.env.CHAIN_ID || "84532")
const RPC_URL = process.env.RPC_URL || "https://base-sepolia.g.alchemy.com/v2/demo"

const CONTRACT_ADDRESSES = {
  verifier: process.env.VERIFIER_ADDRESS || "0x6cBbB06df8Ddc8D28992F5149C755aAe0E0EB61f",
  credentialRegistry: process.env.CREDENTIAL_REGISTRY_ADDRESS || "0x83e0e671c0D31a288B93B9F04B7c4e116a065F5c",
  sessionManager: process.env.SESSION_MANAGER_ADDRESS || "0xcC0a3400397F8A54e54DA2c7A703bC5B27354C58",
  capabilityRegistry: process.env.CAPABILITY_REGISTRY_ADDRESS || "0xA5624939Fd99ed689Bc564FB2a09B3bc59198297",
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS || "0xa52e7C76811FAAC1514712eb0137d8f1631202DA",
  agentWalletFactory: process.env.AGENT_WALLET_FACTORY_ADDRESS || "0x6313d16266FB2e60c8Ef142274e317878ba71677",
  entryPoint: process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
}

let provider: ethers.JsonRpcProvider | null = null
function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true })
  }
  return provider
}

type ToolHandler = (args: any) => Promise<{
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}>

const handlers: Record<string, ToolHandler> = {}

// ─── Agent Registration ───────────────────────────────────────

handlers.register_agent = async (args) => {
  const { orgId, agentType, name } = args
  const agent = store.createAgent({ orgId, agentType, name })
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, agent }, null, 2) }],
  }
}

handlers.list_agents = async (args) => {
  const { orgId } = args
  const agents = store.listAgents(orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ agents }, null, 2) }],
  }
}

handlers.get_agent_state = async (args) => {
  const { agentId, orgId } = args
  const agent = store.getAgent(agentId, orgId)
  if (!agent) return { content: [{ type: "text", text: JSON.stringify({ error: "Agent not found" }) }], isError: true }
  return {
    content: [{ type: "text", text: JSON.stringify({ agent }, null, 2) }],
  }
}

handlers.revoke_agent = async (args) => {
  const { agentId, orgId } = args
  store.deleteAgent(agentId, orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true }) }],
  }
}

// ─── Capability Registry ──────────────────────────────────────

handlers.create_capability = async (args) => {
  const { orgId, action, effect, constraints, resourcePattern, expiresAt } = args
  const cap = store.createCapability({ orgId, action, effect, constraints, resourcePattern, expiresAt })
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, capability: cap }, null, 2) }],
  }
}

handlers.list_capabilities = async (args) => {
  const { orgId } = args
  const capabilities = store.listCapabilities(orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ capabilities }, null, 2) }],
  }
}

handlers.grant_capability = async (args) => {
  const { orgId, grantorAgentId, granteeAgentId, capabilityId, constraints, expiresAt } = args
  const grant = store.grantCapability({ orgId, grantorAgentId, granteeAgentId, capabilityId, constraints, expiresAt })
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, grant }, null, 2) }],
  }
}

handlers.revoke_grant = async (args) => {
  const { orgId, grantId } = args
  store.revokeGrant(grantId, orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true }) }],
  }
}

handlers.check_capability = async (args) => {
  const { agentId, orgId, action } = args
  const result = store.checkCapability(agentId, orgId, action)
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  }
}

handlers.list_agent_grants = async (args) => {
  const { agentId, orgId } = args
  const grants = store.getGrantsForAgent(agentId, orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ grants }, null, 2) }],
  }
}

// ─── Delegation ───────────────────────────────────────────────

handlers.create_delegation = async (args) => {
  const { orgId, delegatorAgentId, delegateAgentId, scope, expiresAt, maxDepth, label } = args
  const delegation = store.createDelegation({ orgId, delegatorAgentId, delegateAgentId, scope, expiresAt, maxDepth, label })
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, delegation }, null, 2) }],
  }
}

handlers.revoke_delegation = async (args) => {
  const { orgId, delegationId } = args
  store.revokeDelegation(delegationId, orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true }) }],
  }
}

handlers.check_delegation = async (args) => {
  const { delegateAgentId, orgId, requiredAction } = args
  const result = store.checkDelegation(delegateAgentId, orgId, requiredAction)
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  }
}

handlers.get_delegation_chain = async (args) => {
  const { delegateAgentId, orgId } = args
  const chain = store.getDelegationChain(delegateAgentId, orgId)
  return {
    content: [{ type: "text", text: JSON.stringify({ chain }, null, 2) }],
  }
}

// ─── Chain Discovery ──────────────────────────────────────────

handlers.get_chains = async () => {
  let healthy = false
  try {
    const p = getProvider()
    await p.getBlockNumber()
    healthy = true
  } catch {}
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        chains: [{
          chainId: CHAIN_ID,
          name: process.env.NETWORK_NAME || "sepolia",
          rpcUrl: RPC_URL,
          contractAddresses: CONTRACT_ADDRESSES,
          healthy,
        }],
      }, null, 2),
    }],
  }
}

handlers.get_chain_contracts = async () => {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        chainId: CHAIN_ID,
        name: process.env.NETWORK_NAME || "sepolia",
        contracts: CONTRACT_ADDRESSES,
      }, null, 2),
    }],
  }
}

// ─── Proof Generation ─────────────────────────────────────────

handlers.generate_proof = async (args) => {
  const { agentId, orgId, action, expirySeconds } = args

  const agent = store.getAgent(agentId, orgId)
  if (!agent) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Agent not found" }) }], isError: true }
  }

  const circuitStatus = getProverStatus()
  if (!circuitStatus.available) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Circuit files not found and no prover available.",
          circuitStatus,
          resolution: "Place credential.wasm and .zkey files in circuits/build/ or set CIRCUIT_DIR env var.",
        }, null, 2),
      }],
      isError: true,
    }
  }

  const poseidon = await buildPoseidon()
  const permissions = 255
  const expiresAt = Math.floor(Date.now() / 1000) + (expirySeconds || 3600)
  const cryptoMod = await import("crypto")
  const secretBytes = cryptoMod.randomBytes(31)
  const secret = BigInt("0x" + Array.from(secretBytes)
    .map((b: number) => b.toString(16).padStart(2, "0")).join(""))

  const sessionNonce = BigInt(Math.floor(Date.now() / 1000))
  const nullifier = poseidon([secret, sessionNonce])

  const depth = 20
  const activePathElements = Array(depth).fill("0")
  const activePathIndices = Array(depth).fill("0")
  const activeRoot = "0"

  const revokedSiblings = Array(depth).fill("0")
  const revokedOldKey = "0"
  const revokedOldValue = "0"
  const revokedIsOld0 = 1
  const revokedRoot = "0"

  const input = {
    agentId: String(agentId),
    orgId: String(orgId),
    permissions: String(permissions),
    expiry: String(expiresAt),
    secret: String(secret),
    sessionNonce: String(sessionNonce),
    activePathElements,
    activePathIndices,
    revokedSiblings,
    revokedOldKey,
    revokedOldValue,
    revokedIsOld0,
    activeRoot,
    revokedRoot,
    maxValue: String(permissions),
    sessionExpiry: String(expiresAt),
  }

  const result = await generateProof(input)
  const proof = result.proof
  const publicSignals = result.publicSignals

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        proof: {
          nullifier: BigInt(poseidon.F.toString(nullifier)).toString(),
          root: activeRoot,
          revokedRoot,
          proof: {
            a: [proof.pi_a[0]?.toString() ?? "0", proof.pi_a[1]?.toString() ?? "0"],
            b: [[proof.pi_b[0][1]?.toString() ?? "0", proof.pi_b[0][0]?.toString() ?? "0"],
                [proof.pi_b[1][1]?.toString() ?? "0", proof.pi_b[1][0]?.toString() ?? "0"]],
            c: [proof.pi_c[0]?.toString() ?? "0", proof.pi_c[1]?.toString() ?? "0"],
          },
          publicSignals,
        },
        permissionBitmask: permissions,
        expiresAt,
      }, null, 2),
    }],
  }
}

handlers.verify_proof = async (args) => {
  const { proof: inputProof, action } = args

  if (!inputProof || !inputProof.proof || !inputProof.publicSignals) {
    return { content: [{ type: "text", text: JSON.stringify({ valid: false, error: "Invalid proof structure" }) }], isError: true }
  }

  const { wasm, zkey } = checkCircuits()
  if (!wasm || !zkey) {
    return {
      content: [{ type: "text", text: JSON.stringify({
        valid: false,
        error: "No circuit files available for proof verification",
      }), }],
      isError: true,
    }
  }

  try {
    const { groth16 } = await import("snarkjs")
    const vkPath = path.resolve(__dirname, "../../../circuits/build/verification_key.json")
    if (!fs.existsSync(vkPath)) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          valid: false,
          error: "verification_key.json not found",
        }), }],
        isError: true,
      }
    }
    const vk = JSON.parse(fs.readFileSync(vkPath, "utf-8"))
    const valid = await groth16.verify(vk, inputProof.publicSignals, inputProof.proof)
    return {
      content: [{ type: "text", text: JSON.stringify({
        valid,
        action,
        publicSignals: inputProof.publicSignals,
      }, null, 2), }],
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: JSON.stringify({ valid: false, error: err.message }), }],
      isError: true,
    }
  }
}

// ─── Heartbeat ────────────────────────────────────────────────

handlers.heartbeat = async (args) => {
  const { agentId } = args
  store.heartbeat(agentId)
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, receivedAt: Math.floor(Date.now() / 1000) }, null, 2) }],
  }
}

// ─── Tool Definitions ─────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "register_agent",
    description: "Register a new test agent (in-memory, no DB required)",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number", description: "Organization ID" },
        agentType: { type: "string", enum: ["openclaude", "langchain", "claude_code", "custom", "crewai", "llama_index", "autogen", "smolagents"], description: "Agent type" },
        name: { type: "string", description: "Agent name" },
      },
      required: ["orgId", "agentType", "name"],
    },
  },
  {
    name: "list_agents",
    description: "List all agents for an organization",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number", description: "Organization ID" },
      },
      required: ["orgId"],
    },
  },
  {
    name: "get_agent_state",
    description: "Get agent state",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number" },
        orgId: { type: "number" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: "revoke_agent",
    description: "Delete agent from test store",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number" },
        orgId: { type: "number" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: "create_capability",
    description: "Create a capability definition",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number" },
        action: { type: "string" },
        effect: { type: "string", enum: ["allow", "deny", "audit"] },
        constraints: { type: "object" },
        resourcePattern: { type: "string" },
        expiresAt: { type: "number" },
      },
      required: ["orgId", "action"],
    },
  },
  {
    name: "list_capabilities",
    description: "List capability definitions",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number" },
      },
      required: ["orgId"],
    },
  },
  {
    name: "grant_capability",
    description: "Grant a capability to an agent",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number" },
        grantorAgentId: { type: "number" },
        granteeAgentId: { type: "number" },
        capabilityId: { type: "number" },
        constraints: { type: "object" },
        expiresAt: { type: "number" },
      },
      required: ["orgId", "grantorAgentId", "granteeAgentId", "capabilityId"],
    },
  },
  {
    name: "revoke_grant",
    description: "Revoke a capability grant",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number" },
        grantId: { type: "number" },
      },
      required: ["orgId", "grantId"],
    },
  },
  {
    name: "check_capability",
    description: "Check if an agent has a capability",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number" },
        orgId: { type: "number" },
        action: { type: "string" },
      },
      required: ["agentId", "orgId", "action"],
    },
  },
  {
    name: "list_agent_grants",
    description: "List grants for an agent",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number" },
        orgId: { type: "number" },
      },
      required: ["agentId", "orgId"],
    },
  },
  {
    name: "create_delegation",
    description: "Create a delegation",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number" },
        delegatorAgentId: { type: "number" },
        delegateAgentId: { type: "number" },
        scope: { type: "object" },
        expiresAt: { type: "number" },
        maxDepth: { type: "number" },
        label: { type: "string" },
      },
      required: ["orgId", "delegatorAgentId", "delegateAgentId", "scope"],
    },
  },
  {
    name: "revoke_delegation",
    description: "Revoke a delegation",
    inputSchema: {
      type: "object" as const,
      properties: {
        orgId: { type: "number" },
        delegationId: { type: "number" },
      },
      required: ["orgId", "delegationId"],
    },
  },
  {
    name: "check_delegation",
    description: "Check delegation permission",
    inputSchema: {
      type: "object" as const,
      properties: {
        delegateAgentId: { type: "number" },
        orgId: { type: "number" },
        requiredAction: { type: "string" },
      },
      required: ["delegateAgentId", "orgId", "requiredAction"],
    },
  },
  {
    name: "get_delegation_chain",
    description: "Trace delegation chain",
    inputSchema: {
      type: "object" as const,
      properties: {
        delegateAgentId: { type: "number" },
        orgId: { type: "number" },
      },
      required: ["delegateAgentId", "orgId"],
    },
  },
  {
    name: "get_chains",
    description: "List blockchain chains and contract addresses",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_chain_contracts",
    description: "Get deployed contract addresses for the configured chain",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "generate_proof",
    description: "Generate a real Groth16 ZK proof using rapidsnark (WSL) with snarkjs fallback.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number" },
        orgId: { type: "number" },
        action: { type: "string" },
        expirySeconds: { type: "number" },
      },
      required: ["agentId", "orgId", "action"],
    },
  },
  {
    name: "verify_proof",
    description: "Verify a ZK proof using Groth16 verification (snarkjs/on-chain).",
    inputSchema: {
      type: "object" as const,
      properties: {
        proof: { type: "object" },
        action: { type: "string" },
      },
      required: ["proof", "action"],
    },
  },
  {
    name: "heartbeat",
    description: "Update agent heartbeat timestamp",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "number" },
        orgId: { type: "number" },
      },
      required: ["agentId", "orgId"],
    },
  },
]

export function createMCPServer(): Server {
  const serverInfo = {
    name: "agentix-mcp-test",
    version: process.env.npm_package_version || "0.1.0",
  }

  const server = new Server(serverInfo, {
    capabilities: { tools: {} },
  })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const handler = handlers[name]
    if (!handler) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      }
    }
    try {
      return await handler(args || {})
    } catch (err: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
        isError: true,
      }
    }
  })

  return server
}
