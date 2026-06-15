/**
 * Agent Communications Service
 *
 * Handles bidirectional communication between backend and agent runtimes:
 * 1. WebSocket — real-time bidirectional for connected agents
 * 2. Webhooks — agent pushes status/results to backend
 * 3. HTTP fallback — backend calls agent's /execute endpoint
 */

import { EventEmitter } from "events"
import { initDB } from "../db"
import { AppError } from "../utils/errors"

export type AgentMessage =
  | { type: "task"; taskId: number; action: string; params: Record<string, unknown> }
  | { type: "status"; status: string; error?: string }
  | { type: "result"; taskId: number; success: boolean; result: unknown; error?: string }
  | { type: "heartbeat" }
  | { type: "ping" }
  | { type: "pong" }

export interface ConnectedAgent {
  agentId: number
  ws: any // WebSocket
  lastSeen: number
  metadata?: Record<string, unknown>
}

// Active WebSocket connections keyed by agentId
const connectedAgents = new Map<number, ConnectedAgent>()

// Event emitter for agent events
export const agentEvents = new EventEmitter()

/**
 * Register a WebSocket connection for an agent
 */
export function registerAgentConnection(agentId: number, ws: any, metadata?: Record<string, unknown>) {
  // Close existing connection if any
  const existing = connectedAgents.get(agentId)
  if (existing) {
    try { existing.ws.close(1000, "Reconnected") } catch {}
  }

  connectedAgents.set(agentId, {
    agentId,
    ws,
    lastSeen: Date.now(),
    metadata,
  })

  agentEvents.emit("agent:connected", agentId)
  console.log(`[comms] Agent ${agentId} connected via WebSocket`)
}

/**
 * Unregister a WebSocket connection
 */
export function unregisterAgentConnection(agentId: number) {
  connectedAgents.delete(agentId)
  agentEvents.emit("agent:disconnected", agentId)
  console.log(`[comms] Agent ${agentId} disconnected`)
}

/**
 * Send a message to a connected agent via WebSocket
 */
export function sendToAgent(agentId: number, message: AgentMessage): boolean {
  const agent = connectedAgents.get(agentId)
  if (!agent) return false

  try {
    agent.ws.send(JSON.stringify(message))
    agent.lastSeen = Date.now()
    return true
  } catch {
    unregisterAgentConnection(agentId)
    return false
  }
}

/**
 * Check if an agent is connected via WebSocket
 */
export function isAgentConnected(agentId: number): boolean {
  return connectedAgents.has(agentId)
}

/**
 * Get all connected agents
 */
export function getConnectedAgents(): number[] {
  return Array.from(connectedAgents.keys())
}

/**
 * Handle incoming webhook from an agent
 * Agents POST to /agents/:agentId/webhook with their status/results
 */
export async function handleAgentWebhook(
  agentId: number,
  payload: {
    type: "status" | "result" | "heartbeat"
    taskId?: number
    status?: string
    success?: boolean
    result?: unknown
    error?: string
    metadata?: Record<string, unknown>
  }
): Promise<{ received: true }> {
  const db = await initDB()

  // Update last seen
  await db.run(
    `UPDATE external_agents SET last_heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
    agentId
  )

  // Update status if provided
  if (payload.status) {
    await db.run(
      `UPDATE external_agents SET status = ? WHERE id = ?`,
      payload.status,
      agentId
    )
  }

  // Record execution result if provided
  if (payload.taskId && payload.result !== undefined) {
    await db.run(
      `UPDATE agent_execution_queue SET
        status = ?,
        result = ?,
        completed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
       WHERE id = ?`,
      payload.success ? "completed" : "failed",
      JSON.stringify(payload.result),
      payload.taskId
    )
  }

  // Emit event for listeners
  agentEvents.emit("agent:webhook", agentId, payload)

  // If agent is also connected via WebSocket, update last seen
  const wsAgent = connectedAgents.get(agentId)
  if (wsAgent) {
    wsAgent.lastSeen = Date.now()
  }

  return { received: true }
}

/**
 * Send task to agent via WebSocket, fall back to HTTP
 */
export async function dispatchTask(
  agentId: number,
  taskId: number,
  action: string,
  params: Record<string, unknown>,
  timeoutMs = 30000
): Promise<{ success: boolean; result?: unknown; error?: string; via: "websocket" | "webhook" | "http" }> {
  // Try WebSocket first
  if (isAgentConnected(agentId)) {
    const sent = sendToAgent(agentId, {
      type: "task",
      taskId,
      action,
      params,
    })

    if (sent) {
      // Wait for result via WebSocket (with timeout)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          agentEvents.removeListener(`result:${taskId}`, handler)
          resolve({ success: false, error: "WebSocket response timeout", via: "websocket" })
        }, timeoutMs)

        const handler = (result: any) => {
          clearTimeout(timer)
          agentEvents.removeListener(`result:${taskId}`, handler)
          resolve({ ...result, via: "websocket" })
        }

        agentEvents.on(`result:${taskId}`, handler)
      })
    }
  }

  // Fall back to HTTP call
  const db = await initDB()
  const agent = await db.get(
    `SELECT endpoint FROM external_agents WHERE id = ?`,
    agentId
  )

  if (!agent?.endpoint) {
    return { success: false, error: "Agent not connected and no endpoint configured", via: "http" }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(`${agent.endpoint}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, action, params }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}`, via: "http" }
    }

    const result = await response.json()
    return { success: true, result, via: "http" }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "HTTP call failed",
      via: "http",
    }
  }
}
