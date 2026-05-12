// AI API routes are proxied through Next.js to handle authentication
const API_BASE_URL = "/api/ai"

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
  }
}

export interface AIProviderInfo {
  id: string
  name: string
  models: string[]
}

export interface AIAgent {
  id: number
  orgId: number
  name: string
  provider: string
  model: string
  config: Record<string, unknown>
  status: "idle" | "initializing" | "running" | "paused" | "error" | "terminated"
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentRun {
  id: number
  agentId: number
  prompt: string
  output?: string
  error?: string
  status: "pending" | "running" | "completed" | "failed"
  createdAt: string
  completedAt?: string
}

// Get supported AI providers
export async function listProviders(): Promise<{ providers: AIProviderInfo[] }> {
  const response = await fetch(`${API_BASE_URL}/providers`, {
    method: "GET",
    headers: getHeaders(),
  })
  if (!response.ok) throw new Error(`Failed to list providers: ${response.status}`)
  return response.json()
}

// Get available models (optionally filtered by provider)
export async function listModels(provider?: string): Promise<{ models: string[] | { id: string; provider: string }[] }> {
  const url = provider
    ? `${API_BASE_URL}/models?provider=${encodeURIComponent(provider)}`
    : `${API_BASE_URL}/models`
  const response = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
  })
  if (!response.ok) throw new Error(`Failed to list models: ${response.status}`)
  return response.json()
}

// Create AI agent
export async function createAIAgent(data: {
  name: string
  provider: string
  model: string
  apiKey?: string
  config?: Record<string, unknown>
}): Promise<{ agent: AIAgent }> {
  const response = await fetch(`${API_BASE_URL}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error(`Failed to create agent: ${response.status}`)
  return response.json()
}

// List all AI agents for the org
export async function listAIAgents(): Promise<{ agents: AIAgent[] }> {
  const response = await fetch(`${API_BASE_URL}`, {
    headers: getHeaders(),
  })
  if (!response.ok) throw new Error(`Failed to list agents: ${response.status}`)
  return response.json()
}

// Get AI agent by ID
export async function getAIAgent(agentId: number): Promise<{ agent: AIAgent } | null> {
  const response = await fetch(`${API_BASE_URL}/${agentId}`, {
    headers: getHeaders(),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to get agent: ${response.status}`)
  return response.json()
}

// Update AI agent
export async function updateAIAgent(
  agentId: number,
  updates: Partial<{
    name: string
    model: string
    provider: string
    apiKey: string
    config: Record<string, unknown>
  }>
): Promise<{ agent: AIAgent }> {
  const response = await fetch(`${API_BASE_URL}/${agentId}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(updates),
  })
  if (!response.ok) throw new Error(`Failed to update agent: ${response.status}`)
  return response.json()
}

// Delete AI agent
export async function deleteAIAgent(agentId: number): Promise<{ success: boolean; deleted: number }> {
  const response = await fetch(`${API_BASE_URL}/${agentId}`, {
    method: "DELETE",
    headers: getHeaders(),
  })
  if (!response.ok) throw new Error(`Failed to delete agent: ${response.status}`)
  return response.json()
}

// Run AI agent inference
export async function runAIAgent(
  agentId: number,
  prompt: string,
  options?: Record<string, unknown>
): Promise<{
  runId: number
  status: string
  provider: string
  model: string
}> {
  const response = await fetch(`${API_BASE_URL}/${agentId}/run`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ prompt, ...options }),
  })
  if (!response.ok) throw new Error(`Failed to run agent: ${response.status}`)
  return response.json()
}

// Get run history for an agent
export async function getAIAgentRuns(
  agentId: number,
  limit = 20
): Promise<{ runs: AgentRun[]; total: number }> {
  const response = await fetch(`${API_BASE_URL}/${agentId}/runs?limit=${limit}`, {
    headers: getHeaders(),
  })
  if (!response.ok) throw new Error(`Failed to get runs: ${response.status}`)
  return response.json()
}
