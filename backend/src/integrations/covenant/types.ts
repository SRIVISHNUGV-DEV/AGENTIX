export interface CovenantConfig {
  apiUrl: string
  apiKey?: string
  chainId?: number
}

export interface CovenantAgent {
  address: string
  name: string
  reputation: number
  capabilities: string[]
  stake: string
  isActive: boolean
  tasksCompleted: number
  tasksFailed: number
}

export interface CovenantTask {
  taskId: number
  client: string
  worker: string
  amount: string
  deadline: number
  metaHash: string
  status: number
  statusLabel: string
  disputeCount: number
}

export interface CovenantSession {
  sessionKey: string
  agentId: number
  orgId: number
  userId: number
  maxValue: number
  expiry: number
  permissionScopes: string[]
  isActive: boolean
  nullifier?: string
}

export interface CovenantAuthorizationRequest {
  sessionId: string
  agentId: number
  orgId: number
  action: string
  target: string
  value?: number
  metadata?: Record<string, unknown>
}

export interface CovenantAuthorizationResult {
  authorized: boolean
  sessionId: string
  agentId: number
  orgId: number
  action: string
  spendingLimit: number
  remainingBudget: number
  expiresAt: number
  scopes: string[]
  error?: string
}

export interface CovenantEscrowRequest {
  sessionId: string
  agentId: number
  orgId: number
  worker: string
  payment: string
  deadline: number
  metaHash: string
}

export interface CovenantEscrowResult {
  success: boolean
  taskId?: number
  txHash?: string
  status: string
  error?: string
}

export interface CovenantSettlementRequest {
  sessionId: string
  agentId: number
  orgId: number
  taskId: number
  clientSignature: string
}

export interface CovenantSettlementResult {
  success: boolean
  txHash?: string
  status: string
  error?: string
}

export interface CovenantAuditEntry {
  timestamp: number
  action: string
  agentId: number
  orgId: number
  userId: number
  sessionId: string
  covenantAction: string
  covenantResult: string
  txHash?: string
  error?: string
}
