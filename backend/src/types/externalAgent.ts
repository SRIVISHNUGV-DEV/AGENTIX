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
