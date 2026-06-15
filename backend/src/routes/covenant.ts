import express from "express"
import { requireAuth } from "../middleware/auth"
import { CovenantClient } from "../integrations/covenant/covenant-client"
import { SessionValidator } from "../integrations/covenant/session-validator"
import { requireCovenantAuth, auditCovenantAction } from "../integrations/covenant/middleware"
import type { CovenantAuthRequest } from "../integrations/covenant/middleware"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, requireString, requireInteger } from "../utils/validation"

const router = express.Router()
const covenantClient = new CovenantClient()
const sessionValidator = new SessionValidator()

router.get("/health", async (req, res) => {
  try {
    const health = await covenantClient.healthCheck()
    res.json({
      integration: "agentix-covenant",
      covenant: health,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    respondWithError(res, error, "covenant.health")
  }
})

router.post("/authorize", requireAuth, async (req: CovenantAuthRequest, res) => {
  try {
    ensureBodyObject(req.body)

    const sessionId = requireString(req.body.sessionId, "sessionId")
    const agentId = requireInteger(req.body.agentId, "agentId", 1)
    const orgId = (req as any).auth!.orgId
    const action = requireString(req.body.action, "action")
    const value = req.body.value as number | undefined

    const result = await sessionValidator.validateSession({
      sessionId,
      agentId,
      orgId,
      action,
      target: req.body.target || "covenant",
      value,
      metadata: req.body.metadata
    })

    res.json(result)
  } catch (error) {
    respondWithError(res, error, "covenant.authorize")
  }
})

router.post("/task", requireAuth, requireCovenantAuth("create_task"), async (req: CovenantAuthRequest, res) => {
  try {
    ensureBodyObject(req.body)

    const worker = requireString(req.body.worker, "worker")
    const payment = requireString(req.body.payment, "payment")
    const deadline = requireInteger(req.body.deadline, "deadline", 1)
    const metaHash = requireString(req.body.metaHash, "metaHash")

    const result = await covenantClient.createTask(
      { worker, payment, deadline, metaHash },
      req.covenantAuth!.wallet
    )

    await auditCovenantAction(
      req.covenantAuth!.orgId,
      req.covenantAuth!.agentId,
      req.covenantAuth!.userId,
      req.covenantAuth!.sessionId,
      "create_task",
      { success: true, txHash: result.txHash, value: parseFloat(payment) }
    )

    res.json({
      success: true,
      taskId: result.taskId,
      txHash: result.txHash,
      signer: req.covenantAuth!.wallet?.address || "default",
      session: {
        sessionId: req.covenantAuth!.sessionId,
        spendingLimit: req.covenantAuth!.spendingLimit,
        remainingBudget: req.covenantAuth!.remainingBudget
      }
    })
  } catch (error) {
    if (req.covenantAuth) {
      await auditCovenantAction(
        req.covenantAuth.orgId,
        req.covenantAuth.agentId,
        req.covenantAuth.userId,
        req.covenantAuth.sessionId,
        "create_task",
        { success: false, error: error instanceof Error ? error.message : String(error) }
      )
    }
    respondWithError(res, error, "covenant.create_task")
  }
})

router.post("/task/:taskId/submit", requireAuth, requireCovenantAuth("submit_work"), async (req: CovenantAuthRequest, res) => {
  try {
    const taskId = requireInteger(req.params.taskId, "taskId", 1)
    ensureBodyObject(req.body)
    const deliverableHash = requireString(req.body.deliverableHash, "deliverableHash")

    const result = await covenantClient.submitWork(
      taskId,
      deliverableHash,
      req.covenantAuth!.wallet
    )

    await auditCovenantAction(
      req.covenantAuth!.orgId,
      req.covenantAuth!.agentId,
      req.covenantAuth!.userId,
      req.covenantAuth!.sessionId,
      "submit_work",
      { success: true, txHash: result.txHash }
    )

    res.json({ success: true, txHash: result.txHash })
  } catch (error) {
    if (req.covenantAuth) {
      await auditCovenantAction(
        req.covenantAuth.orgId,
        req.covenantAuth.agentId,
        req.covenantAuth.userId,
        req.covenantAuth.sessionId,
        "submit_work",
        { success: false, error: error instanceof Error ? error.message : String(error) }
      )
    }
    respondWithError(res, error, "covenant.submit_work")
  }
})

router.post("/task/:taskId/complete", requireAuth, requireCovenantAuth("complete_task"), async (req: CovenantAuthRequest, res) => {
  try {
    const taskId = requireInteger(req.params.taskId, "taskId", 1)
    ensureBodyObject(req.body)
    const clientSignature = requireString(req.body.clientSignature, "clientSignature")

    const result = await covenantClient.completeTask(
      taskId,
      clientSignature,
      req.covenantAuth!.wallet
    )

    await auditCovenantAction(
      req.covenantAuth!.orgId,
      req.covenantAuth!.agentId,
      req.covenantAuth!.userId,
      req.covenantAuth!.sessionId,
      "complete_task",
      { success: true, txHash: result.txHash }
    )

    res.json({ success: true, txHash: result.txHash })
  } catch (error) {
    if (req.covenantAuth) {
      await auditCovenantAction(
        req.covenantAuth.orgId,
        req.covenantAuth.agentId,
        req.covenantAuth.userId,
        req.covenantAuth.sessionId,
        "complete_task",
        { success: false, error: error instanceof Error ? error.message : String(error) }
      )
    }
    respondWithError(res, error, "covenant.complete_task")
  }
})

router.post("/task/:taskId/dispute", requireAuth, requireCovenantAuth("dispute_task"), async (req: CovenantAuthRequest, res) => {
  try {
    const taskId = requireInteger(req.params.taskId, "taskId", 1)

    const result = await covenantClient.disputeTask(
      taskId,
      req.covenantAuth!.wallet
    )

    await auditCovenantAction(
      req.covenantAuth!.orgId,
      req.covenantAuth!.agentId,
      req.covenantAuth!.userId,
      req.covenantAuth!.sessionId,
      "dispute_task",
      { success: true, txHash: result.txHash }
    )

    res.json({ success: true, txHash: result.txHash })
  } catch (error) {
    if (req.covenantAuth) {
      await auditCovenantAction(
        req.covenantAuth.orgId,
        req.covenantAuth.agentId,
        req.covenantAuth.userId,
        req.covenantAuth.sessionId,
        "dispute_task",
        { success: false, error: error instanceof Error ? error.message : String(error) }
      )
    }
    respondWithError(res, error, "covenant.dispute_task")
  }
})

router.get("/task/:taskId", requireAuth, async (req: CovenantAuthRequest, res) => {
  try {
    const taskId = requireInteger(req.params.taskId, "taskId", 1)
    const task = await covenantClient.getTask(taskId)
    res.json(task)
  } catch (error) {
    respondWithError(res, error, "covenant.get_task")
  }
})

router.get("/agent/:address", requireAuth, async (req: CovenantAuthRequest, res) => {
  try {
    const address = requireString(req.params.address, "address")
    const agent = await covenantClient.getAgent(address)
    res.json(agent)
  } catch (error) {
    respondWithError(res, error, "covenant.get_agent")
  }
})

router.get("/audit", requireAuth, async (req: CovenantAuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    const entries = await covenantClient.getAuditTrail({
      orgId: (req as any).auth!.orgId,
      limit,
      offset
    })

    res.json(entries)
  } catch (error) {
    respondWithError(res, error, "covenant.audit")
  }
})

export default router
