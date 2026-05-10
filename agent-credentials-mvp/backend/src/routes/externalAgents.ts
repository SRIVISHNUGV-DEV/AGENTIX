import express from "express"
import { requireAuth } from "../middleware/auth"
import { ExternalAgentService } from "../services/externalAgent"
import type { AuthRequest } from "../types/http"
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

// V-001 FIX: Require authentication for all external agent routes
router.use(requireAuth)

router.get("/types", async (req, res) => {
  try {
    const types = ExternalAgentService.getSupportedAgentTypes()
    res.json(types)
  } catch (error) {
    respondWithError(res, error, "external.types")
  }
})

function resolveOrgId(req: AuthRequest): number {
  // V-001: Only allow authenticated orgId - no fallback to query/body
  if (!req.auth?.orgId) {
    throw new AppError(401, "authentication required")
  }
  return req.auth.orgId
}

router.post("/", async (req: AuthRequest, res) => {
  try {
    ensureBodyObject(req.body)
    const orgId = resolveOrgId(req)
    const agentType = requireString(req.body.agentType, "agentType")
    const name = requireString(req.body.name, "name")
    const endpoint = optionalString(req.body.endpoint, "endpoint")
    // V-004 FIX: Validate metadata to prevent prototype pollution
    const metadata = validateMetadata(req.body.metadata, "metadata")

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

router.get("/", async (req: AuthRequest, res) => {
  try {
    const agents = await agentService.listExternalAgents(resolveOrgId(req))
    res.json(agents)
  } catch (error) {
    respondWithError(res, error, "external.list")
  }
})

router.get("/:agentId", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const agent = await agentService.getExternalAgent(agentId, resolveOrgId(req))

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" })
    }

    res.json(agent)
  } catch (error) {
    respondWithError(res, error, "external.get")
  }
})

router.put("/:agentId", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)

    const updates: any = {}
    if (req.body.name) updates.name = req.body.name
    if (req.body.endpoint) updates.endpoint = req.body.endpoint
    if (req.body.apiKey) updates.apiKey = req.body.apiKey
    if (req.body.apiSecret) updates.apiSecret = req.body.apiSecret
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive
    // V-004 FIX: Validate metadata to prevent prototype pollution
    if (req.body.metadata) updates.metadata = validateMetadata(req.body.metadata, "metadata")

    const result = await agentService.updateExternalAgent(agentId, resolveOrgId(req), updates)
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.update")
  }
})

router.delete("/:agentId", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const result = await agentService.deleteExternalAgent(agentId, resolveOrgId(req))
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.delete")
  }
})

router.post("/:agentId/test", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const result = await agentService.testConnection(agentId, resolveOrgId(req))
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.test")
  }
})

router.post("/:agentId/audit", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const result = await agentService.performSecurityAudit(agentId, resolveOrgId(req))
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "external.audit")
  }
})

// Vault credentials routes
router.get("/:agentId/credentials", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const credentials = await agentService.listVaultCredentials(agentId, resolveOrgId(req))
    res.json(credentials)
  } catch (error) {
    respondWithError(res, error, "credentials.list")
  }
})

router.post("/:agentId/credentials", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const name = requireString(req.body.name, "name")
    const value = requireString(req.body.value, "value")
    const type = optionalString(req.body.type, "type")
    const expiresAt = req.body.expiresAt as number | undefined

    const result = await agentService.addVaultCredential(
      agentId,
      resolveOrgId(req),
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

router.delete("/:agentId/credentials/:credentialId", async (req: AuthRequest, res) => {
  try {
    const credentialId = requireInteger(req.params.credentialId, "credentialId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    const result = await agentService.deleteVaultCredential(agentId, credentialId, resolveOrgId(req))
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "credentials.delete")
  }
})

// Funding accounts routes
router.get("/:agentId/funding", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const accounts = await agentService.listFundingAccounts(agentId, resolveOrgId(req))
    res.json(accounts)
  } catch (error) {
    respondWithError(res, error, "funding.list")
  }
})

router.post("/:agentId/funding", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const walletAddress = requireString(req.body.walletAddress, "walletAddress")
    const encryptedPrivateKey = requireString(req.body.encryptedPrivateKey, "encryptedPrivateKey")
    const dailyLimit = optionalString(req.body.dailyLimit, "dailyLimit")

    const result = await agentService.addFundingAccount(
      agentId,
      resolveOrgId(req),
      walletAddress,
      encryptedPrivateKey,
      dailyLimit
    )
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "funding.create")
  }
})

router.delete("/:agentId/funding/:accountId", async (req: AuthRequest, res) => {
  try {
    const accountId = requireInteger(req.params.accountId, "accountId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    const result = await agentService.deleteFundingAccount(agentId, accountId, resolveOrgId(req))
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "funding.delete")
  }
})

// Contract whitelist routes
router.get("/:agentId/contracts", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    const contracts = await agentService.listWhitelistedContracts(agentId, resolveOrgId(req))
    res.json(contracts)
  } catch (error) {
    respondWithError(res, error, "contracts.list")
  }
})

router.post("/:agentId/contracts", async (req: AuthRequest, res) => {
  try {
    const agentId = requireInteger(req.params.agentId, "agentId")
    ensureBodyObject(req.body)
    const address = requireString(req.body.address, "address")
    const name = optionalString(req.body.name, "name")
    const abi = optionalString(req.body.abi, "abi")

    const result = await agentService.addWhitelistedContract(
      agentId,
      resolveOrgId(req),
      address,
      name,
      abi
    )
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "contracts.create")
  }
})

router.put("/:agentId/contracts/:contractId", async (req: AuthRequest, res) => {
  try {
    const contractId = requireInteger(req.params.contractId, "contractId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    const enabled = req.body.enabled === true
    await agentService.toggleContractWhitelist(agentId, contractId, resolveOrgId(req), enabled)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, error, "contracts.update")
  }
})

router.delete("/:agentId/contracts/:contractId", async (req: AuthRequest, res) => {
  try {
    const contractId = requireInteger(req.params.contractId, "contractId")
    const agentId = requireInteger(req.params.agentId, "agentId")
    const result = await agentService.deleteWhitelistedContract(agentId, contractId, resolveOrgId(req))
    res.json(result)
  } catch (error) {
    respondWithError(res, error, "contracts.delete")
  }
})

export default router
