const API_BASE_URL = "/api"

export interface ExternalAgent {
  id: number
  orgId: number
  linkedAgentId?: number
  agentType: string
  name: string
  endpoint?: string
  hasApiKey?: boolean
  status: "disconnected" | "connecting" | "connected" | "error" | "running" | "paused"
  isActive: boolean
  createdAt: string
  updatedAt: string
  lastHeartbeatAt?: string
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

export interface AgentTypeInfo {
  id: string
  name: string
  icon: string
  capabilities: string[]
}

export async function listAgentTypes(): Promise<AgentTypeInfo[]> {
  const response = await fetch(`${API_BASE_URL}/external/types`)
  if (!response.ok) throw new Error("Failed to list agent types")
  return response.json()
}

export async function createExternalAgent(data: {
  orgId: number
  agentType: string
  name: string
  endpoint?: string
  metadata?: Record<string, unknown>
}): Promise<{ agentId: number; linkedAgentId: number; name: string; agentType: string }> {
  const response = await fetch(`${API_BASE_URL}/external`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error("Failed to create agent")
  return response.json()
}

export async function listExternalAgents(orgId?: number): Promise<ExternalAgent[]> {
  const url = orgId ? `${API_BASE_URL}/external?orgId=${orgId}` : `${API_BASE_URL}/external`
  const response = await fetch(url)
  if (!response.ok) throw new Error("Failed to list agents")
  return response.json()
}

export async function getExternalAgent(agentId: number): Promise<ExternalAgent | null> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}`)
  if (!response.ok) return null
  return response.json()
}

export async function updateExternalAgent(
  agentId: number,
  orgId: number,
  updates: Partial<{
    name: string
    endpoint: string
    apiKey: string
    apiSecret: string
    isActive: boolean
    metadata: Record<string, unknown>
  }>
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}?orgId=${orgId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  if (!response.ok) throw new Error("Failed to update agent")
  return response.json()
}

export async function deleteExternalAgent(agentId: number, orgId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}?orgId=${orgId}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("Failed to delete agent")
  return response.json()
}

export async function testAgentConnection(agentId: number, orgId: number): Promise<ConnectionTestResult> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/test?orgId=${orgId}`, {
    method: "POST",
  })
  if (!response.ok) throw new Error("Failed to test connection")
  return response.json()
}

export async function performSecurityAudit(agentId: number, orgId: number): Promise<SecurityAuditResult> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/audit?orgId=${orgId}`, {
    method: "POST",
  })
  if (!response.ok) throw new Error("Failed to perform security audit")
  return response.json()
}

export async function listVaultCredentials(agentId: number, orgId: number): Promise<VaultCredential[]> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/credentials?orgId=${orgId}`)
  if (!response.ok) throw new Error("Failed to list credentials")
  return response.json()
}

export async function addVaultCredential(
  agentId: number,
  orgId: number,
  data: { name: string; value: string; type?: string; expiresAt?: number }
): Promise<{ credentialId: number }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/credentials?orgId=${orgId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error("Failed to add credential")
  return response.json()
}

export async function deleteVaultCredential(agentId: number, credentialId: number, orgId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/credentials/${credentialId}?orgId=${orgId}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("Failed to delete credential")
  return response.json()
}

export async function listFundingAccounts(agentId: number, orgId: number): Promise<FundingAccount[]> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/funding?orgId=${orgId}`)
  if (!response.ok) throw new Error("Failed to list funding accounts")
  return response.json()
}

export async function addFundingAccount(
  agentId: number,
  orgId: number,
  data: { walletAddress: string; encryptedPrivateKey: string; dailyLimit?: string }
): Promise<{ accountId: number }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/funding?orgId=${orgId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error("Failed to add funding account")
  return response.json()
}

export async function deleteFundingAccount(agentId: number, accountId: number, orgId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/funding/${accountId}?orgId=${orgId}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("Failed to delete funding account")
  return response.json()
}

export async function listWhitelistedContracts(agentId: number, orgId: number): Promise<WhitelistedContract[]> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/contracts?orgId=${orgId}`)
  if (!response.ok) throw new Error("Failed to list contracts")
  return response.json()
}

export async function addWhitelistedContract(
  agentId: number,
  orgId: number,
  data: { address: string; name?: string; abi?: string }
): Promise<{ contractId: number }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/contracts?orgId=${orgId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error("Failed to add contract")
  return response.json()
}

export async function toggleWhitelistedContract(
  agentId: number,
  contractId: number,
  orgId: number,
  enabled: boolean
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/contracts/${contractId}?orgId=${orgId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) throw new Error("Failed to toggle contract")
  return response.json()
}

export async function deleteWhitelistedContract(agentId: number, contractId: number, orgId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/contracts/${contractId}?orgId=${orgId}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("Failed to delete contract")
  return response.json()
}
