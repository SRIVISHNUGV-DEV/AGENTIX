import type { Request, Response, NextFunction } from "express"
import { initDB } from "../../db"
import { AppError } from "../../utils/errors"
import { SessionValidator } from "./session-validator"
import { CovenantClient } from "./covenant-client"
import { BudgetTracker } from "./budget-tracker"
import { WalletManager } from "./wallet-manager"
import type { CovenantAuthorizationRequest } from "./types"

const sessionValidator = new SessionValidator()
const covenantClient = new CovenantClient()
const budgetTracker = new BudgetTracker()
const walletManager = new WalletManager()

export type CovenantAuthRequest = Request & {
  covenantAuth?: {
    sessionId: string
    agentId: number
    orgId: number
    userId: number
    action: string
    authorized: boolean
    spendingLimit: number
    remainingBudget: number
    expiresAt: number
    scopes: string[]
    wallet?: any
  }
}

const isDev = process.env.NODE_ENV !== "production"

export function requireCovenantAuth(action: string) {
  return async (req: CovenantAuthRequest, res: Response, next: NextFunction) => {
    try {
      // DEV BYPASS: skip covenant auth when DEV_AUTH_BYPASS=true
      if (isDev && process.env.DEV_AUTH_BYPASS === "true") {
        const authReq = req as any
        req.covenantAuth = {
          sessionId: String(req.headers["x-covenant-session-id"] || `dev_session_${Date.now()}`),
          agentId: Number(req.headers["x-covenant-agent-id"]) || 1,
          orgId: Number(req.headers["x-covenant-org-id"]) || 1,
          userId: authReq.auth?.userId || 1,
          action,
          authorized: true,
          spendingLimit: 10000,
          remainingBudget: 10000,
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
          scopes: ["read_file", "write_file", "execute_command", "api_call", "sign_transaction"],
          wallet: undefined
        }
        return next()
      }

      const sessionId = req.headers["x-covenant-session-id"] as string
      const agentId = Number(req.headers["x-covenant-agent-id"])
      const orgId = Number(req.headers["x-covenant-org-id"])

      if (!sessionId || !agentId || !orgId) {
        throw new AppError(401, "Missing Covenant authorization headers: x-covenant-session-id, x-covenant-agent-id, x-covenant-org-id")
      }

      const request: CovenantAuthorizationRequest = {
        sessionId,
        agentId,
        orgId,
        action,
        target: req.path,
        value: req.body?.payment ? Number(req.body.payment) : undefined,
        metadata: req.body
      }

      const result = await sessionValidator.validateSession(request)

      if (!result.authorized) {
        return res.status(403).json({
          error: "Covenant authorization failed",
          details: result.error,
          action
        })
      }

      let wallet: any = undefined
      try {
        wallet = await walletManager.getWalletForAgent(agentId)
      } catch {
        // No per-agent wallet — will use default backend wallet
      }

      if (request.value && request.value > 0) {
        const budget = await budgetTracker.tryDeduct(sessionId, request.value)
        if (!budget.allowed) {
          return res.status(403).json({
            error: "Spending limit exceeded",
            details: budget.error,
            remaining: budget.remaining,
            action
          })
        }
      }

      const authReq = req as any
      const userId = authReq.auth?.userId || 0

      req.covenantAuth = {
        sessionId: result.sessionId,
        agentId: result.agentId,
        orgId: result.orgId,
        userId,
        action: result.action,
        authorized: result.authorized,
        spendingLimit: result.spendingLimit,
        remainingBudget: request.value
          ? result.spendingLimit - request.value
          : result.spendingLimit,
        expiresAt: result.expiresAt,
        scopes: result.scopes,
        wallet
      }

      next()
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      next(error)
    }
  }
}

export async function auditCovenantAction(
  orgId: number,
  agentId: number,
  userId: number,
  sessionId: string,
  action: string,
  result: { success: boolean; txHash?: string; error?: string; value?: number }
) {
  const db = await initDB()

  await db.run(
    `INSERT INTO audit_log
     (org_id, user_id, action, resource_type, resource_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    orgId,
    userId,
    `covenant.${action}`,
    "covenant_action",
    `agent:${agentId}:session:${sessionId}`,
    JSON.stringify({
      sessionId,
      agentId,
      covenantAction: action,
      txHash: result.txHash || null,
      success: result.success,
      error: result.error || null,
      value: result.value || null
    })
  )
}

export { budgetTracker, walletManager, covenantClient }
