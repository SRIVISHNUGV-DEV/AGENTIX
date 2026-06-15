import { initDB } from "../../db"
import { AppError } from "../../utils/errors"
import type { CovenantAuthorizationRequest, CovenantAuthorizationResult } from "./types"

const COVENANT_ACTIONS: Record<string, { permissionBit: number; maxSpending?: number }> = {
  create_task: { permissionBit: 1 << 4, maxSpending: 1000 },
  fund_task: { permissionBit: 1 << 5, maxSpending: 5000 },
  submit_work: { permissionBit: 1 << 3, maxSpending: 0 },
  complete_task: { permissionBit: 1 << 5, maxSpending: 5000 },
  dispute_task: { permissionBit: 1 << 5, maxSpending: 0 },
  register_agent: { permissionBit: 1 << 6, maxSpending: 100 },
  deactivate_agent: { permissionBit: 1 << 6, maxSpending: 0 },
  grant_capability: { permissionBit: 1 << 6, maxSpending: 0 },
  revoke_capability: { permissionBit: 1 << 6, maxSpending: 0 }
}

export class SessionValidator {
  async validateSession(
    request: CovenantAuthorizationRequest
  ): Promise<CovenantAuthorizationResult> {
    const db = await initDB()

    // FIX 1: Bind org_id to prevent cross-org session misuse
    const session = await db.get(
      `SELECT s.*, a.org_id, a.id as agent_id
       FROM sessions s
       INNER JOIN agents a ON a.id = s.agent_id
       WHERE s.session_id = ? AND a.org_id = ?`,
      request.sessionId,
      request.orgId
    )

    if (!session) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: 0,
        remainingBudget: 0,
        expiresAt: 0,
        scopes: [],
        error: "Session not found"
      }
    }

    const now = Math.floor(Date.now() / 1000)
    if (session.expires_at && Number(session.expires_at) < now) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: 0,
        remainingBudget: 0,
        expiresAt: Number(session.expires_at),
        scopes: [],
        error: "Session expired"
      }
    }

    // FIX 4: Check if session has been revoked via nullifier
    if (session.nullifier) {
      const used = await db.get(
        `SELECT id FROM used_nullifiers WHERE nullifier = ?`,
        session.nullifier
      )
      if (used) {
        return {
          authorized: false,
          sessionId: request.sessionId,
          agentId: request.agentId,
          orgId: request.orgId,
          action: request.action,
          spendingLimit: 0,
          remainingBudget: 0,
          expiresAt: 0,
          scopes: [],
          error: "Session has been revoked"
        }
      }
    }

    const credential = await db.get(
      `SELECT permissions, expiry FROM credentials WHERE agent_id = ?`,
      session.agent_id
    )

    if (!credential) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: 0,
        remainingBudget: 0,
        expiresAt: 0,
        scopes: [],
        error: "No credential found for agent"
      }
    }

    if (credential.expiry && Number(credential.expiry) < now) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: 0,
        remainingBudget: 0,
        expiresAt: Number(credential.expiry),
        scopes: [],
        error: "Credential expired"
      }
    }

    const actionConfig = COVENANT_ACTIONS[request.action]
    if (!actionConfig) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: 0,
        remainingBudget: 0,
        expiresAt: 0,
        scopes: [],
        error: `Unknown action: ${request.action}`
      }
    }

    // FIX 5: Default to 0 (no permissions) instead of 255 (all permissions)
    const permissions = Number(credential.permissions) || 0
    if ((permissions & actionConfig.permissionBit) === 0) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: 0,
        remainingBudget: 0,
        expiresAt: 0,
        scopes: [],
        error: `Permission denied for action: ${request.action}`
      }
    }

    const sessionData = JSON.parse(session.public_signals || "{}")
    const maxValue = sessionData.maxValue || 0

    if (request.value && request.value > maxValue) {
      return {
        authorized: false,
        sessionId: request.sessionId,
        agentId: request.agentId,
        orgId: request.orgId,
        action: request.action,
        spendingLimit: maxValue,
        remainingBudget: maxValue,
        expiresAt: Number(session.expires_at || 0),
        scopes: [],
        error: `Spending limit exceeded: requested ${request.value}, limit ${maxValue}`
      }
    }

    const scopes = this.resolveScopes(permissions)

    return {
      authorized: true,
      sessionId: request.sessionId,
      agentId: request.agentId,
      orgId: request.orgId,
      action: request.action,
      spendingLimit: maxValue,
      remainingBudget: maxValue - (request.value || 0),
      expiresAt: Number(session.expires_at || 0),
      scopes
    }
  }

  private resolveScopes(permissions: number): string[] {
    const scopes: string[] = []
    if (permissions & 1) scopes.push("read_file")
    if (permissions & 2) scopes.push("write_file")
    if (permissions & 4) scopes.push("execute_command")
    if (permissions & 8) scopes.push("query")
    if (permissions & 16) scopes.push("api_call")
    if (permissions & 32) scopes.push("sign_transaction")
    if (permissions & 64) scopes.push("deploy_contract")
    if (permissions & 128) scopes.push("custom")
    return scopes
  }
}
