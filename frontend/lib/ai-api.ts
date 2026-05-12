const API_BASE_URL = process.env.AGENT_CREDENTIALS_API_URL ?? "http://127.0.0.1:3000"

export interface AIProviderInfo {
  id: string
  name: string
  models: string[]
  capabilities: string[]
}

export interface AIAgent {
  id: number
  orgId: number
  name: string
  description?: string
  provider: string
  model: string
  systemPrompt?: string
  capabilities: string[]
  status: "idle" | "initializing" | "running" | "paused" | "error" | "terminated"
  isActive: boolean
  credentials?: { type: string; maskedKey?: string }
  createdAt: string
  updatedAt: string
  lastRunAt?: string
}

export interface AgentRun {
  id: number
  agentId: number
  input: string
  output?: string
  error?: string
  status: "pending" | "running" | "completed" | "failed"
  toolCalls: { tool: string; arguments: Record<string, unknown>; result?: unknown; status: string; error?: string }[]
  tokensUsed?: number
  costUsd?: number
  startedAt: string
  completedAt?: string
}

export async function listProviders(): Promise<AIProviderInfo[]> {
  const response = await fetch(`${API_BASE_URL}/ai/providers`, { method: "POST" })
  if (!response.ok) throw new Error("Failed to list providers")
  return response.json()
}

export async function listModels(provider: string): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/ai/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  })
  if (!response.ok) throw new Error("Failed to list models")
  return response.json()
}

export async function createAIAgent(data: {
  orgId?: number
  name: string
  provider: string
  model?: string
  systemPrompt?: string
  description?: string
  credential?: { type: string; key?: string }
}): Promise<{ agentId: number; name: string; provider: string; model: string }> {
  const response = await fetch(`${API_BASE_URL}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error("Failed to create agent")
  return response.json()
}

export async function listAIAgents(orgId?: number): Promise<AIAgent[]> {
  const url = orgId ? `${API_BASE_URL}/ai?orgId=${orgId}` : `${API_BASE_URL}/ai`
  const response = await fetch(url)
  if (!response.ok) throw new Error("Failed to list agents")
  return response.json()
}

export async function getAIAgent(agentId: number): Promise<AIAgent | null> {
  const response = await fetch(`${API_BASE_URL}/ai/${agentId}`)
  if (!response.ok) return null
  return response.json()
}

export async function updateAIAgent(
  agentId: number,
  updates: Partial<{
    name: string
    model: string
    systemPrompt: string
    capabilities: string[]
    credential: { type: string; key?: string }
  }>
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/ai/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  if (!response.ok) throw new Error("Failed to update agent")
  return response.json()
}

export async function deleteAIAgent(agentId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/ai/${agentId}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("Failed to delete agent")
  return response.json()
}

export async function runAIAgent(
  agentId: number,
  input: string,
  options?: {
    stream?: boolean
    temperature?: number
    maxTokens?: number
    tools?: string[]
  }
): Promise<{
  success: boolean
  runId: number
  content?: string
  toolCalls?: { tool: string; arguments: Record<string, unknown> }[]
  usage?: { inputTokens: number; outputTokens: number; totalCost: number }
  error?: string
}> {
  const response = await fetch(`${API_BASE_URL}/ai/${agentId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, ...options }),
  })
  if (!response.ok) throw new Error("Failed to run agent")
  return response.json()
}

export async function getAIAgentRuns(
  agentId: number,
  limit = 10
): Promise<AgentRun[]> {
  const response = await fetch(`${API_BASE_URL}/ai/${agentId}/runs?limit=${limit}`)
  if (!response.ok) throw new Error("Failed to get runs")
  return response.json()
}