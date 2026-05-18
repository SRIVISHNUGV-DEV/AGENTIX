export type ExternalAgentType = 
  | "openclaude"
  | "langchain"
  | "claude_code"
  | "custom"
  | "crewai"
  | "llama_index"
  | "autogen"
  | "smolagents"

export type AgentStatus = 
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "running"
  | "paused"

export interface ExternalAgent {
  id: number
  orgId: number
  linkedAgentId?: number
  agentType: ExternalAgentType
  name: string
  endpoint?: string
  hasApiKey?: boolean
  hasApiSecret?: boolean
  status: AgentStatus
  isActive: boolean
  createdAt: number
  updatedAt: number
  lastHeartbeatAt?: number
  metadata?: string
}

export interface VaultCredential {
  id: number
  externalAgentId: number
  name: string
  maskedValue: string
  type: string
  isSecret: boolean
  expiresAt?: number
  createdAt: number
}

export interface FundingAccount {
  id: number
  externalAgentId: number
  address: string
  maskedKey: string
  balance: string
  dailyLimit: string
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface WhitelistedContract {
  id: number
  externalAgentId: number
  address: string
  name?: string
  abi?: string
  isEnabled: boolean
  createdAt: number
}

export interface SecurityAuditResult {
  agentId: number
  passed: boolean
  score: number
  checks: Array<{
    name: string
    passed: boolean
    severity: "critical" | "high" | "medium" | "low"
    details: string
  }>
  performedAt: string
  error?: string
}

export interface ConnectionTestResult {
  success: boolean
  latency: number
  status?: string
  error?: string
}

// Execution Layer Types
export type ExecutionAction =
  | "read_file"
  | "write_file"
  | "execute_command"
  | "query"
  | "api_call"
  | "sign_transaction"
  | "deploy_contract"
  | "custom"

export interface ExecutionRequest {
  action: ExecutionAction
  params: Record<string, any>
  nonce: string
  requestedAt: number
  timeout?: number
}

export interface ExecutionProof {
  nullifier: string
  root: string
  revokedRoot: string
  proof: {
    a: [string, string]
    b: [[string, string], [string, string]]
    c: [string, string]
  }
  publicSignals: [string, string, string, string, string]
}

export interface ExecutionResult {
  success: boolean
  result?: any
  error?: string
  executionTime: number
  timestamp: number
  proofOfExecution?: ExecutionProof
}

export interface AgentExecutionLog {
  id: number
  externalAgentId: number
  orgId: number
  requestId: string
  action: ExecutionAction
  params: string // JSON string
  proof: string | null // JSON string of ExecutionProof
  result: string | null // JSON string
  success: boolean
  errorMessage: string | null
  executionTimeMs: number
  createdAt: number
}
