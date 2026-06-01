import { initDB } from "../db"
import { AppError } from "../utils/errors"

export const DEFAULT_PROTOCOL_TOOLS = [
  "send_transaction",
  "batch_transactions",
  "get_wallet_info",
  "check_whitelist",
  "add_to_whitelist",
  "remove_from_whitelist",
  "deposit_gas",
  "get_gas_balance",
] as const

export const DEFAULT_RUNTIME_ACTIONS = [
  "chat",
  "query",
  "api_call",
  "custom",
] as const

const DEFAULT_DAILY_SPEND_LIMIT_WEI = "100000000000000000"
const DEFAULT_MAX_SINGLE_TX_WEI = "25000000000000000"
const DEFAULT_DEFAULT_SESSION_DURATION_SECONDS = 4 * 60 * 60
const DEFAULT_MAX_SESSION_DURATION_SECONDS = 3 * 24 * 60 * 60
const DEFAULT_DAILY_TX_LIMIT = 25
const DEFAULT_CREDENTIAL_CEILING = "18446744073709551615"

export type AgentCapabilityPolicy = {
  id: number
  agentId: number
  orgId: number
  status: "active" | "disabled"
  policyVersion: number
  credentialCeiling: string
  defaultSessionDurationSeconds: number
  maxSessionDurationSeconds: number
  dailySpendLimitWei: string
  dailyTxLimit: number
  maxSingleTxWei: string
  allowedRuntimeActions: string[]
  allowedProtocolTools: string[]
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type PolicyUpdateInput = Partial<{
  status: "active" | "disabled"
  credentialCeiling: string
  defaultSessionDurationSeconds: number
  maxSessionDurationSeconds: number
  dailySpendLimitWei: string
  dailyTxLimit: number
  maxSingleTxWei: string
  allowedRuntimeActions: string[]
  allowedProtocolTools: string[]
  metadata: Record<string, unknown>
}>

type RequestedSessionBounds = {
  dailySpendLimitWei?: string | bigint | null
  dailyTxLimit?: number | null
  expiresInSeconds?: number | null
}

function parseStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!value) return [...fallback]
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        : [...fallback]
    } catch {
      return [...fallback]
    }
  }
  return [...fallback]
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeBigIntString(value: string | bigint | number | null | undefined, fallback: string) {
  if (value === null || value === undefined || value === "") return fallback
  try {
    return BigInt(value).toString()
  } catch {
    throw new AppError(400, `Invalid bigint value: ${String(value)}`)
  }
}

function normalizePositiveInt(value: number | null | undefined, fallback: number, field: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  const parsed = Math.floor(value)
  if (parsed <= 0) {
    throw new AppError(400, `${field} must be greater than zero`)
  }
  return parsed
}

export class CapabilityPolicyService {
  async getPolicyForAgent(agentId: number, orgId: number): Promise<AgentCapabilityPolicy | null> {
    const db = await initDB()
    const row = await db.get(
      `SELECT * FROM agent_capability_policies WHERE agent_id = ? AND org_id = ?`,
      agentId,
      orgId
    )

    return row ? this.mapPolicyRow(row) : null
  }

  async getOrCreatePolicyForAgent(agentId: number, orgId: number): Promise<AgentCapabilityPolicy> {
    const existing = await this.getPolicyForAgent(agentId, orgId)
    if (existing) return existing

    const db = await initDB()
    const credential = await db.get(
      `SELECT permissions, expiry FROM credentials WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1`,
      agentId
    )

    const credentialCeiling = credential?.permissions
      ? BigInt(credential.permissions).toString()
      : DEFAULT_CREDENTIAL_CEILING

    const result = await db.run(
      `INSERT INTO agent_capability_policies (
        agent_id, org_id, status, policy_version, credential_ceiling,
        default_session_duration_seconds, max_session_duration_seconds,
        daily_spend_limit_wei, daily_tx_limit, max_single_tx_wei,
        allowed_runtime_actions, allowed_protocol_tools, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agentId,
      orgId,
      "active",
      1,
      credentialCeiling,
      DEFAULT_DEFAULT_SESSION_DURATION_SECONDS,
      DEFAULT_MAX_SESSION_DURATION_SECONDS,
      DEFAULT_DAILY_SPEND_LIMIT_WEI,
      DEFAULT_DAILY_TX_LIMIT,
      DEFAULT_MAX_SINGLE_TX_WEI,
      JSON.stringify(DEFAULT_RUNTIME_ACTIONS),
      JSON.stringify(DEFAULT_PROTOCOL_TOOLS),
      JSON.stringify({})
    )

    return {
      id: result.lastID || 0,
      agentId,
      orgId,
      status: "active",
      policyVersion: 1,
      credentialCeiling,
      defaultSessionDurationSeconds: DEFAULT_DEFAULT_SESSION_DURATION_SECONDS,
      maxSessionDurationSeconds: DEFAULT_MAX_SESSION_DURATION_SECONDS,
      dailySpendLimitWei: DEFAULT_DAILY_SPEND_LIMIT_WEI,
      dailyTxLimit: DEFAULT_DAILY_TX_LIMIT,
      maxSingleTxWei: DEFAULT_MAX_SINGLE_TX_WEI,
      allowedRuntimeActions: [...DEFAULT_RUNTIME_ACTIONS],
      allowedProtocolTools: [...DEFAULT_PROTOCOL_TOOLS],
      metadata: {},
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    }
  }

  async getPolicyForExternalAgent(externalAgentId: number, orgId: number): Promise<AgentCapabilityPolicy> {
    const db = await initDB()
    const linked = await db.get(
      `SELECT linked_agent_id FROM external_agents WHERE id = ? AND org_id = ?`,
      externalAgentId,
      orgId
    )

    if (!linked) {
      throw new AppError(404, "External agent not found")
    }

    if (!linked.linked_agent_id) {
      throw new AppError(400, "External agent is not linked to a protocol agent")
    }

    return this.getOrCreatePolicyForAgent(linked.linked_agent_id, orgId)
  }

  async updatePolicyForAgent(
    agentId: number,
    orgId: number,
    updates: PolicyUpdateInput,
    changedBy?: string
  ): Promise<AgentCapabilityPolicy> {
    const db = await initDB()
    const current = await this.getOrCreatePolicyForAgent(agentId, orgId)

    const next: AgentCapabilityPolicy = {
      ...current,
      status: updates.status ?? current.status,
      policyVersion: current.policyVersion + 1,
      credentialCeiling: normalizeBigIntString(updates.credentialCeiling, current.credentialCeiling),
      defaultSessionDurationSeconds: normalizePositiveInt(
        updates.defaultSessionDurationSeconds,
        current.defaultSessionDurationSeconds,
        "defaultSessionDurationSeconds"
      ),
      maxSessionDurationSeconds: normalizePositiveInt(
        updates.maxSessionDurationSeconds,
        current.maxSessionDurationSeconds,
        "maxSessionDurationSeconds"
      ),
      dailySpendLimitWei: normalizeBigIntString(updates.dailySpendLimitWei, current.dailySpendLimitWei),
      dailyTxLimit: normalizePositiveInt(updates.dailyTxLimit, current.dailyTxLimit, "dailyTxLimit"),
      maxSingleTxWei: normalizeBigIntString(updates.maxSingleTxWei, current.maxSingleTxWei),
      allowedRuntimeActions: updates.allowedRuntimeActions ?? current.allowedRuntimeActions,
      allowedProtocolTools: updates.allowedProtocolTools ?? current.allowedProtocolTools,
      metadata: updates.metadata ?? current.metadata,
      updatedAt: Math.floor(Date.now() / 1000),
    }

    if (next.defaultSessionDurationSeconds > next.maxSessionDurationSeconds) {
      throw new AppError(400, "defaultSessionDurationSeconds cannot exceed maxSessionDurationSeconds")
    }

    await db.run(
      `UPDATE agent_capability_policies SET
        status = ?,
        policy_version = ?,
        credential_ceiling = ?,
        default_session_duration_seconds = ?,
        max_session_duration_seconds = ?,
        daily_spend_limit_wei = ?,
        daily_tx_limit = ?,
        max_single_tx_wei = ?,
        allowed_runtime_actions = ?,
        allowed_protocol_tools = ?,
        metadata = ?,
        updated_at = ?
      WHERE id = ?`,
      next.status,
      next.policyVersion,
      next.credentialCeiling,
      next.defaultSessionDurationSeconds,
      next.maxSessionDurationSeconds,
      next.dailySpendLimitWei,
      next.dailyTxLimit,
      next.maxSingleTxWei,
      JSON.stringify(next.allowedRuntimeActions),
      JSON.stringify(next.allowedProtocolTools),
      JSON.stringify(next.metadata),
      next.updatedAt,
      current.id
    )

    await db.run(
      `INSERT INTO capability_policy_revisions (
        agent_capability_policy_id, agent_id, org_id, policy_version, changed_by,
        status, credential_ceiling, default_session_duration_seconds,
        max_session_duration_seconds, daily_spend_limit_wei, daily_tx_limit,
        max_single_tx_wei, allowed_runtime_actions, allowed_protocol_tools, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      current.id,
      agentId,
      orgId,
      next.policyVersion,
      changedBy ?? null,
      next.status,
      next.credentialCeiling,
      next.defaultSessionDurationSeconds,
      next.maxSessionDurationSeconds,
      next.dailySpendLimitWei,
      next.dailyTxLimit,
      next.maxSingleTxWei,
      JSON.stringify(next.allowedRuntimeActions),
      JSON.stringify(next.allowedProtocolTools),
      JSON.stringify(next.metadata)
    )

    return next
  }

  async resolveSessionBounds(
    agentId: number,
    orgId: number,
    requested?: RequestedSessionBounds
  ): Promise<{
    policy: AgentCapabilityPolicy
    dailySpendLimitWei: bigint
    dailyTxLimit: number
    expiresInSeconds: number
  }> {
    const policy = await this.getOrCreatePolicyForAgent(agentId, orgId)
    if (policy.status !== "active") {
      throw new AppError(403, "Capability policy is disabled for this agent")
    }

    const requestedDuration = requested?.expiresInSeconds ?? policy.defaultSessionDurationSeconds
    const expiresInSeconds = Math.min(
      normalizePositiveInt(requestedDuration, policy.defaultSessionDurationSeconds, "expiresInSeconds"),
      policy.maxSessionDurationSeconds
    )

    const requestedSpend = normalizeBigIntString(requested?.dailySpendLimitWei, policy.dailySpendLimitWei)
    const dailySpendLimitWei = BigInt(requestedSpend)
    const maxPolicySpend = BigInt(policy.dailySpendLimitWei)
    const finalSpend = dailySpendLimitWei > maxPolicySpend ? maxPolicySpend : dailySpendLimitWei

    const requestedDailyTx = requested?.dailyTxLimit ?? policy.dailyTxLimit
    const finalDailyTx = Math.min(
      normalizePositiveInt(requestedDailyTx, policy.dailyTxLimit, "dailyTxLimit"),
      policy.dailyTxLimit
    )

    return {
      policy,
      dailySpendLimitWei: finalSpend,
      dailyTxLimit: finalDailyTx,
      expiresInSeconds,
    }
  }

  ensureRuntimeActionAllowed(policy: AgentCapabilityPolicy, action: string) {
    if (policy.status !== "active") {
      throw new AppError(403, "Capability policy is disabled for this agent")
    }
    if (!policy.allowedRuntimeActions.includes(action)) {
      throw new AppError(403, `Runtime action not allowed by policy: ${action}`)
    }
  }

  ensureProtocolToolAllowed(policy: AgentCapabilityPolicy, action: string) {
    if (policy.status !== "active") {
      throw new AppError(403, "Capability policy is disabled for this agent")
    }
    if (!policy.allowedProtocolTools.includes(action)) {
      throw new AppError(403, `Protocol tool not allowed by policy: ${action}`)
    }
  }

  private mapPolicyRow(row: any): AgentCapabilityPolicy {
    return {
      id: row.id,
      agentId: row.agent_id,
      orgId: row.org_id,
      status: row.status,
      policyVersion: row.policy_version,
      credentialCeiling: row.credential_ceiling,
      defaultSessionDurationSeconds: row.default_session_duration_seconds,
      maxSessionDurationSeconds: row.max_session_duration_seconds,
      dailySpendLimitWei: row.daily_spend_limit_wei,
      dailyTxLimit: row.daily_tx_limit,
      maxSingleTxWei: row.max_single_tx_wei,
      allowedRuntimeActions: parseStringArray(row.allowed_runtime_actions, DEFAULT_RUNTIME_ACTIONS),
      allowedProtocolTools: parseStringArray(row.allowed_protocol_tools, DEFAULT_PROTOCOL_TOOLS),
      metadata: parseMetadata(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
