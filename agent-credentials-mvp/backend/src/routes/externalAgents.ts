import express from "express"
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
    const orgId = requireInteger(req.query.orgId as string, "orgId", 1)

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

export default router
