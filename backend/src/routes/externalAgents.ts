import express from "express"
import crypto from "crypto"
import { initDB } from "../db"
import { ExternalAgentService } from "../services/externalAgent"
import { requireSignedAction } from "../services/actionAuth"
import type { Request, Response } from "express"
import { AppError, respondWithError } from "../utils/errors"
import {
  ensureBodyObject,
  optionalString,
  requireInteger,
  requireString,
  validateMetadata,
} from "../utils/validation"

const router = express.Router()
const agentService = new ExternalAgentService()

router.get("/types", async (req: Request, res: Response) => {
  try {
    const types = ExternalAgentService.getSupportedAgentTypes()
    res.json(types)
  } catch (error) {
    respondWithError(res, error, "external.types")
  }
})

router.post("/", async (req: Request, res: Response) => {
  try {
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const agentType = requireString(req.body.agentType, "agentType")
    const name = requireString(req.body.name, "name")
    const endpoint = optionalString(req.body.endpoint, "endpoint")
    const metadata = validateMetadata(req.body.metadata, "metadata")

    // Verify org exists
    const db = await initDB()
    const org = await db.get(`SELECT id FROM organizations WHERE id = ?`, orgId)
    if (!org) {
      return res.status(404).json({ error: "organization not found" })
    }

    await requireSignedAction(db, {
      orgId,
      action: "CREATE_EXTERNAL_AGENT",
      target: `org:${orgId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.createExternalAgent(
      orgId,
      agentType as any,
      name,
      endpoint,
      metadata
    )

    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.create")
  }
})

router.get("/", async (req: Request, res: Response) => {
  try {
    const orgIdParam = req.query.orgId as string

    if (!orgIdParam) {
      // No org context - return empty array
      return res.json([])
    }

    const orgId = requireInteger(orgIdParam, "orgId", 1)

    const agents = await agentService.listExternalAgents(orgId)
    res.json(agents)
  } catch (error) {
    respondWithError(res, error, "external.list")
  }
})

router.get("/:agentId", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const agent = await agentService.getExternalAgent(agentId, orgId)

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" })
    }

    res.json(agent)
  } catch (error) {
    respondWithError(res, error, "external.get")
  }
})

router.put("/:agentId", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "UPDATE_EXTERNAL_AGENT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const updates: any = {}
    if (req.body.name) updates.name = req.body.name
    if (req.body.endpoint) updates.endpoint = req.body.endpoint
    if (req.body.apiKey) updates.apiKey = req.body.apiKey
    if (req.body.apiSecret) updates.apiSecret = req.body.apiSecret
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive
    if (req.body.metadata) updates.metadata = validateMetadata(req.body.metadata, "metadata")

    const result = await agentService.updateExternalAgent(agentId, orgId, updates)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.update")
  }
})

router.delete("/:agentId", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "DELETE_EXTERNAL_AGENT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.deleteExternalAgent(agentId, orgId)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.delete")
  }
})

router.post("/:agentId/test", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "TEST_EXTERNAL_AGENT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.testConnection(agentId, orgId)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.test")
  }
})

router.post("/:agentId/audit", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "AUDIT_EXTERNAL_AGENT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.performSecurityAudit(agentId, orgId)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.audit")
  }
})

// Vault credentials routes
router.get("/:agentId/credentials", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const credentials = await agentService.listVaultCredentials(agentId, orgId)
    res.json(credentials)
  } catch (error) {
    respondWithError(res, error, "credentials.list")
  }
})

router.post("/:agentId/credentials", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const name = requireString(req.body.name, "name")
    const value = requireString(req.body.value, "value")
    const type = optionalString(req.body.type, "type")
    const expiresAt = req.body.expiresAt as number | undefined

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "ADD_CREDENTIAL",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.addVaultCredential(
      agentId,
      orgId,
      name,
      value,
      type ?? "api_key",
      expiresAt
    )
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "credentials.create")
  }
})

router.delete("/:agentId/credentials/:credentialId", async (req: Request, res: Response) => {
  try {
    const credentialId = requireInteger(req.params.credentialId, "credentialId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "DELETE_CREDENTIAL",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.deleteVaultCredential(agentId, credentialId, orgId)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "credentials.delete")
  }
})

// Funding accounts routes
router.get("/:agentId/funding", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const accounts = await agentService.listFundingAccounts(agentId, orgId)
    res.json(accounts)
  } catch (error) {
    respondWithError(res, error, "funding.list")
  }
})

router.post("/:agentId/funding", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const walletAddress = requireString(req.body.walletAddress, "walletAddress")
    const encryptedPrivateKey = requireString(req.body.encryptedPrivateKey, "encryptedPrivateKey")
    const dailyLimit = optionalString(req.body.dailyLimit, "dailyLimit")

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "ADD_FUNDING_ACCOUNT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.addFundingAccount(
      agentId,
      orgId,
      walletAddress,
      encryptedPrivateKey,
      dailyLimit
    )
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "funding.create")
  }
})

router.delete("/:agentId/funding/:accountId", async (req: Request, res: Response) => {
  try {
    const accountId = requireInteger(req.params.accountId, "accountId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "DELETE_FUNDING_ACCOUNT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.deleteFundingAccount(agentId, accountId, orgId)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "funding.delete")
  }
})

// Contract whitelist routes
router.get("/:agentId/contracts", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const contracts = await agentService.listWhitelistedContracts(agentId, orgId)
    res.json(contracts)
  } catch (error) {
    respondWithError(res, error, "contracts.list")
  }
})

router.post("/:agentId/contracts", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const address = requireString(req.body.address, "address")
    const name = optionalString(req.body.name, "name")
    const abi = optionalString(req.body.abi, "abi")

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "ADD_WHITELISTED_CONTRACT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.addWhitelistedContract(
      agentId,
      orgId,
      address,
      name,
      abi
    )
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "contracts.create")
  }
})

router.put("/:agentId/contracts/:contractId", async (req: Request, res: Response) => {
  try {
    const contractId = requireInteger(req.params.contractId, "contractId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const enabled = req.body.enabled === true

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "TOGGLE_CONTRACT_WHITELIST",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    await agentService.toggleContractWhitelist(agentId, contractId, orgId, enabled)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, error, "contracts.update")
  }
})

router.delete("/:agentId/contracts/:contractId", async (req: Request, res: Response) => {
  try {
    const contractId = requireInteger(req.params.contractId, "contractId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const orgId = requireInteger(req.body.orgId, "orgId", 1)

    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "DELETE_WHITELISTED_CONTRACT",
      target: `agent:${agentId}`,
      payload: req.body ?? {}
    })

    const result = await agentService.deleteWhitelistedContract(agentId, contractId, orgId)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "contracts.delete")
  }
})

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
router.post("/:agentId/execute", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)

    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const action = requireString(req.body.action, "action")
    const params = req.body.params || {}
    const nonce = req.body.nonce || crypto.randomUUID()
    const timeout = req.body.timeout || 30000
    const proof = req.body.credentialProof || undefined

    // Validate action type
    const validActions = [
      "read_file", "write_file", "execute_command", "query",
      "api_call", "sign_transaction", "deploy_contract", "custom"
    ]
    if (!validActions.includes(action)) {
      return res.status(400).json({
        error: `Invalid action. Must be one of: ${validActions.join(", ")}`
      })
    }

    // Verify signature
    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "EXECUTE_AGENT_REQUEST",
      target: `agent:${agentId}`,
      payload: req.body // Contains walletAddress, signature, nonce, requestedAt
    })

    // Execute the request
    const result = await agentService.executeRequest(
      agentId,
      orgId,
      {
        action: action as any,
        params,
        nonce,
        requestedAt: Math.floor(Date.now() / 1000),
        timeout
      },
      proof
    )

    res.json({
      success: result.success,
      result: result.result,
      executionId: result.executionId,
      executionTime: result.executionTime,
      error: result.error
    })
  } catch (error) {
    respondWithError(res, error, "execute")
  }
})

/**
 * Get execution logs for an agent
 * GET /external/agents/:agentId/executions
 *
 * Query params:
 * - limit: Number of logs to return (default 50)
 * - offset: Pagination offset
 * - action: Filter by action type
 */
router.get("/:agentId/executions", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const action = req.query.action as string | undefined

    const logs = await agentService.getExecutionLogs(agentId, orgId, {
      limit,
      offset,
      action
    })

    res.json(logs)
  } catch (error) {
    respondWithError(res, error, "executions.list")
  }
})

/**
 * Get a single execution by ID
 * GET /external/agents/:agentId/executions/:executionId
 */
router.get("/:agentId/executions/:executionId", async (req: Request, res: Response) => {
  try {
    const executionId = requireInteger(req.params.executionId, "executionId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const execution = await agentService.getExecution(executionId, orgId)

    if (!execution) {
      return res.status(404).json({ error: "Execution not found" })
    }

    res.json(execution)
  } catch (error) {
    respondWithError(res, error, "executions.get")
  }
})

/**
 * Get execution statistics for an agent
 * GET /external/agents/:agentId/executions/stats
 */
router.get("/:agentId/executions/stats", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const stats = await agentService.getExecutionStats(agentId, orgId)
    res.json(stats)
  } catch (error) {
    respondWithError(res, error, "executions.stats")
  }
})

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
router.post("/:agentId/proof", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)

    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const action = requireString(req.body.action, "action")
    const expirySeconds = req.body.expirySeconds || 3600
    const secret = req.body.secret // client-provided secret (optional — can prove client-side via SDK)

    // Verify signature
    const db = await initDB()
    await requireSignedAction(db, {
      orgId,
      action: "GENERATE_AUTHORIZATION_PROOF",
      target: `agent:${agentId}`,
      payload: req.body // Contains walletAddress, signature, nonce, requestedAt
    })

    // Generate the proof — uses client-provided secret if given, otherwise client proves via SDK
    const result = await agentService.generateAuthorizationProof(
      agentId,
      orgId,
      action,
      expirySeconds,
      secret
    )

    res.json({
      success: true,
      proof: result.proof,
      permissionBitmask: result.permissionBitmask,
      expiresAt: result.expiresAt
    })
  } catch (error) {
    respondWithError(res, error, "proof.generate")
  }
})

/**
 * Verify an authorization proof
 * POST /external/agents/:agentId/proof/verify
 *
 * Request body:
 * - proof: The proof to verify
 * - action: The action to verify against
 */
router.post("/:agentId/proof/verify", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)

    const orgId = requireInteger(req.body.orgId, "orgId", 1)
    const proof = req.body.proof
    const action = requireString(req.body.action, "action")

    if (!proof || !proof.nullifier || !proof.root) {
      return res.status(400).json({
        error: "Invalid proof format"
      })
    }

    const result = await agentService.verifyAuthorizationProof(
      agentId,
      orgId,
      proof,
      action
    )

    res.json({
      valid: result.valid,
      error: result.error
    })
  } catch (error) {
    respondWithError(res, error, "proof.verify")
  }
})

/**
 * Get agent permissions
 * GET /external/agents/:agentId/permissions
 */
router.get("/:agentId/permissions", async (req: Request, res: Response) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

    const db = await initDB()
    const agent = await db.get(
      `SELECT ea.agent_name, c.permissions, c.expiry
       FROM external_agents ea
       LEFT JOIN credentials c ON ea.linked_agent_id = c.agent_id
       WHERE ea.id = ? AND ea.org_id = ?`,
      agentId,
      orgId
    )

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" })
    }

    const permissions = agent.permissions || 255
    const permissionList = []

    if (permissions & 1) permissionList.push("read_file")
    if (permissions & 2) permissionList.push("write_file")
    if (permissions & 4) permissionList.push("execute_command")
    if (permissions & 8) permissionList.push("query")
    if (permissions & 16) permissionList.push("api_call")
    if (permissions & 32) permissionList.push("sign_transaction")
    if (permissions & 64) permissionList.push("deploy_contract")
    if (permissions & 128) permissionList.push("custom")

    res.json({
      agentName: agent.agent_name,
      permissions: permissionList,
      permissionBitmask: permissions,
      expiry: agent.expiry
    })
  } catch (error) {
    respondWithError(res, error, "permissions.get")
  }
})

export default router
