const API_BASE_URL = "/api"

// Signature payload type for wallet-authenticated requests
export type SignaturePayload = {
  walletAddress: string
  signature: string
  nonce: string
  requestedAt: number
}

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

export async function connectExternalAgentToProtocolAgent(
  data: {
    protocolAgentId: number
    orgId: number
    runtimeType: string
    name: string
  },
  signature: SignaturePayload
): Promise<{ success: boolean; agentId: number; linkedAgentId: number }> {
  const response = await fetch(`${API_BASE_URL}/external`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orgId: data.orgId,
      agentType: data.runtimeType,
      name: data.name,
      linkedAgentId: data.protocolAgentId,
      metadata: { ownerAddress: signature.walletAddress },
      walletAddress: signature.walletAddress,
      signature: signature.signature,
      nonce: signature.nonce,
      requestedAt: signature.requestedAt,
    }),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Failed to connect runtime" }))
    throw new Error(errorData.error || "Failed to connect runtime")
  }
  return response.json()
}

export async function disconnectExternalAgent(agentId: number, orgId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to disconnect runtime" }))
    throw new Error(error.error || "Failed to disconnect runtime")
  }
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

// ============================================
// Chat Execution API - Runtime Agnostic
// ============================================

export interface ChatMessageResult {
  success: boolean
  response?: string
  result?: {
    type: "transaction" | "whitelist" | "deposit" | "withdraw" | "custom"
    txHash?: string
    amount?: string
    address?: string
    addresses?: string[]
    [key: string]: unknown
  }
  error?: string
}

export interface RuntimeStatus {
  connected: boolean
  lastPing?: number
  endpoint?: string
  status: "disconnected" | "connecting" | "connected" | "error"
}

/**
 * Send a chat message to the agent runtime
 * Routes through backend which forwards to the correct runtime endpoint
 * Works with any runtime type: local, Lambda, Cloudflare, self-hosted
 */
export async function executeChatMessage(
  externalAgentId: number,
  message: string,
  orgId: number,
  signature?: SignaturePayload
): Promise<ChatMessageResult> {
  const response = await fetch(`${API_BASE_URL}/external/${externalAgentId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "chat",
      params: { message },
      orgId,
      ...(signature || {}),
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Chat execution failed" }))
    return { success: false, error: error.error || response.statusText }
  }

  return response.json()
}

/**
 * Execute a specific action on the agent runtime
 * Actions: send_transaction, batch_transactions, deposit_gas, whitelist, withdraw
 */
export async function executeAgentAction(
  externalAgentId: number,
  action: string,
  params: Record<string, unknown>,
  orgId: number,
  signature?: SignaturePayload
): Promise<ChatMessageResult> {
  const response = await fetch(`${API_BASE_URL}/external/${externalAgentId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      params,
      orgId,
      ...(signature || {}),
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Action execution failed" }))
    return { success: false, error: error.error || response.statusText }
  }

  return response.json()
}

/**
 * Get runtime connection status
 */
export async function getRuntimeStatus(externalAgentId: number): Promise<RuntimeStatus> {
  const response = await fetch(`${API_BASE_URL}/external/${externalAgentId}/status`)

  if (!response.ok) {
    return { connected: false, status: "error" }
  }

  return response.json()
}

/**
 * Deposit ETH to EntryPoint for gas
 * Owner wallet funds the agent's smart account for transaction execution
 */
export async function depositToEntryPoint(
  externalAgentId: number,
  amount: string,
  orgId: number,
  signature: SignaturePayload
): Promise<ChatMessageResult> {
  return executeAgentAction(externalAgentId, "deposit_gas", { amount }, orgId, signature)
}

/**
 * Add address to whitelist
 */
export async function addToWhitelist(
  externalAgentId: number,
  address: string,
  orgId: number,
  signature: SignaturePayload
): Promise<ChatMessageResult> {
  return executeAgentAction(externalAgentId, "whitelist", { address, action: "add" }, orgId, signature)
}

/**
 * Remove address from whitelist
 */
export async function removeFromWhitelist(
  externalAgentId: number,
  address: string,
  orgId: number,
  signature: SignaturePayload
): Promise<ChatMessageResult> {
  return executeAgentAction(externalAgentId, "whitelist", { address, action: "remove" }, orgId, signature)
}

export interface ProvisionResult {
  success: boolean
  walletAddress?: string
  entryPointAddress?: string
  session?: {
    id: string
    sessionIdOnChain: string
    sessionKeyPublic: string
    dailySpendLimit: string
    dailyTxLimit: number
    expiresAt: number
  }
  funding?: {
    walletTxHash: string
    gasDepositTxHash: string
    walletFunded: string
    gasDeposited: string
  }
  error?: string
}

/**
 * Fully provision an agent — creates wallet, funds it, deposits gas, creates session.
 * One call to go from "just created" to "ready to transact".
 */
export async function provisionAgent(
  agentId: number,
  orgId: number,
  ownerAddress: string,
  options?: {
    dailySpendLimitWei?: string
    dailyTxLimit?: number
    walletFundingEth?: string
    gasDepositEth?: string
    sessionExpiryDays?: number
  }
): Promise<ProvisionResult> {
  const response = await fetch(`${API_BASE_URL}/external/${agentId}/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, ownerAddress, ...options }),
  })

  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: text || `Provisioning failed: ${response.status}` }
  }

  return response.json()
}

export interface AgentProvisioningStatus {
  hasWallet: boolean
  hasSession: boolean
  isReady: boolean
  walletAddress?: string
  sessionInfo?: {
    id: string
    dailySpendLimit: string
    dailyTxLimit: number
    expiresAt: number
  }
}

/**
 * Check if an agent is fully provisioned (has wallet + active session)
 */
export async function getAgentProvisioningStatus(
  agentId: number
): Promise<AgentProvisioningStatus> {
  try {
    const response = await fetch(`${API_BASE_URL}/external/${agentId}/provision-status`)

    if (!response.ok) {
      return { hasWallet: false, hasSession: false, isReady: false }
    }

    const data = await response.json()
    return {
      hasWallet: data.hasWallet ?? false,
      hasSession: data.hasSession ?? false,
      isReady: (data.hasWallet ?? false) && (data.hasSession ?? false),
      walletAddress: data.walletAddress,
      sessionInfo: data.sessionInfo,
    }
  } catch {
    return { hasWallet: false, hasSession: false, isReady: false }
  }
}
