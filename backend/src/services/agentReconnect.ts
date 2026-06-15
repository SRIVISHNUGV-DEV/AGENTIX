/**
 * Agent Auto-Reconnection Service
 *
 * Periodically checks agent health and attempts reconnection.
 * - Polls agent /health endpoints
 * - Updates agent status in DB
 * - Emits events for monitoring
 * - Triggers reconnection callbacks
 */

import { initDB } from "../db"
import { agentEvents, isAgentConnected } from "./agentComms"

const HEALTH_CHECK_INTERVAL = 30_000 // 30 seconds
const RECONNECT_INTERVAL = 60_000 // 1 minute
const STALE_THRESHOLD = 120_000 // 2 minutes without heartbeat = disconnected

let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start health checking and auto-reconnection
 */
export function startAutoReconnect() {
  if (healthCheckTimer) return

  console.log("[reconnect] Starting auto-reconnection service")

  // Health check loop
  healthCheckTimer = setInterval(async () => {
    try {
      await checkAllAgentHealth()
    } catch (error) {
      console.error("[reconnect] Health check error:", error)
    }
  }, HEALTH_CHECK_INTERVAL)

  // Reconnection loop
  reconnectTimer = setInterval(async () => {
    try {
      await attemptReconnections()
    } catch (error) {
      console.error("[reconnect] Reconnection error:", error)
    }
  }, RECONNECT_INTERVAL)
}

/**
 * Stop auto-reconnection
 */
export function stopAutoReconnect() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
  if (reconnectTimer) {
    clearInterval(reconnectTimer)
    reconnectTimer = null
  }
}

/**
 * Check health of all registered agents
 */
async function checkAllAgentHealth() {
  const db = await initDB()

  const agents = await db.all(
    `SELECT id, endpoint, status FROM external_agents WHERE endpoint IS NOT NULL AND endpoint != ''`
  )

  for (const agent of agents) {
    // Skip if already connected via WebSocket
    if (isAgentConnected(agent.id)) {
      // Still check health to update status
      if (agent.status !== "connected") {
        await db.run(
          `UPDATE external_agents SET status = 'connected', last_heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
          agent.id
        )
      }
      continue
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`${agent.endpoint}/health`, {
        signal: controller.signal,
        headers: { "User-Agent": "Agentix-Backend/1.0" },
      })

      clearTimeout(timer)

      if (response.ok) {
        if (agent.status !== "connected") {
          await db.run(
            `UPDATE external_agents SET status = 'connected', last_heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
            agent.id
          )
          agentEvents.emit("agent:recovered", agent.id)
          console.log(`[reconnect] Agent ${agent.id} recovered via HTTP health check`)
        }
      } else {
        if (agent.status !== "error") {
          await db.run(
            `UPDATE external_agents SET status = 'error' WHERE id = ?`,
            agent.id
          )
          agentEvents.emit("agent:unhealthy", agent.id, `HTTP ${response.status}`)
        }
      }
    } catch {
      // Agent unreachable
      if (agent.status !== "disconnected" && agent.status !== "error") {
        await db.run(
          `UPDATE external_agents SET status = 'disconnected' WHERE id = ?`,
          agent.id
        )
        agentEvents.emit("agent:unreachable", agent.id)
        console.log(`[reconnect] Agent ${agent.id} unreachable`)
      }
    }
  }
}

/**
 * Attempt to reconnect to disconnected agents
 */
async function attemptReconnections() {
  const db = await initDB()

  const disconnectedAgents = await db.all(
    `SELECT id, endpoint, metadata FROM external_agents
     WHERE status = 'disconnected' AND endpoint IS NOT NULL AND endpoint != ''`
  )

  for (const agent of disconnectedAgents) {
    // Skip if already connected via WebSocket
    if (isAgentConnected(agent.id)) continue

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`${agent.endpoint}/health`, {
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (response.ok) {
        await db.run(
          `UPDATE external_agents SET status = 'connected', last_heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
          agent.id
        )
        agentEvents.emit("agent:reconnected", agent.id)
        console.log(`[reconnect] Agent ${agent.id} reconnected`)

        // Process any pending tasks
        const { processNextTask } = await import("./taskQueue")
        processNextTask(agent.id).catch(() => {})
      }
    } catch {
      // Still unreachable, skip
    }
  }
}

/**
 * Get reconnection status for all agents
 */
export async function getReconnectionStatus() {
  const db = await initDB()

  const agents = await db.all(
    `SELECT id, agent_name, status, last_heartbeat_at, endpoint FROM external_agents`
  )

  return agents.map((agent: any) => ({
    agentId: agent.id,
    name: agent.agent_name,
    status: agent.status,
    isConnected: isAgentConnected(agent.id),
    lastHeartbeat: agent.last_heartbeat_at,
    hasEndpoint: !!agent.endpoint,
    timeSinceLastHeartbeat: agent.last_heartbeat_at
      ? Math.floor(Date.now() / 1000) - agent.last_heartbeat_at
      : null,
  }))
}
