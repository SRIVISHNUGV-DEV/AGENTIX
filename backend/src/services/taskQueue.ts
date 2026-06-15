/**
 * Persistent Task Queue
 *
 * Replaces in-memory Map with DB-backed queue using PostgreSQL.
 * Survives restarts, supports prioritization, retries, and monitoring.
 */

import { initDB } from "../db"
import { dispatchTask, agentEvents } from "./agentComms"

export interface QueuedTask {
  id: number
  agentId: number
  action: string
  params: Record<string, unknown>
  status: "pending" | "running" | "completed" | "failed" | "retry"
  priority: number
  attempts: number
  maxAttempts: number
  result?: unknown
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface EnqueueOptions {
  priority?: number // 0 = highest, 10 = lowest
  maxAttempts?: number
  delayMs?: number
  deduplicationKey?: string
}

// Active polling intervals per agent
const pollingIntervals = new Map<number, ReturnType<typeof setInterval>>()

/**
 * Enqueue a task for an agent
 */
export async function enqueueTask(
  agentId: number,
  action: string,
  params: Record<string, unknown>,
  options: EnqueueOptions = {}
): Promise<number> {
  const db = await initDB()
  const {
    priority = 5,
    maxAttempts = 3,
    deduplicationKey,
  } = options

  // Deduplication: skip if same action+params already pending
  if (deduplicationKey) {
    const existing = await db.get(
      `SELECT id FROM agent_execution_queue
       WHERE agent_id = ? AND status IN ('pending', 'running') AND deduplication_key = ?`,
      agentId,
      deduplicationKey
    )
    if (existing) {
      return existing.id
    }
  }

  const result = await db.run(
    `INSERT INTO agent_execution_queue (
      agent_id, action, params, status, priority, max_attempts, deduplication_key, created_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)`,
    agentId,
    action,
    JSON.stringify(params),
    priority,
    maxAttempts,
    deduplicationKey || null
  )

  const taskId = result.lastID as number

  // Trigger immediate processing if agent is connected
  processNextTask(agentId).catch(() => {})

  return taskId
}

/**
 * Process next pending task for an agent
 */
export async function processNextTask(agentId: number): Promise<boolean> {
  const db = await initDB()

  // Get next pending task by priority
  const task = await db.get(
    `SELECT * FROM agent_execution_queue
     WHERE agent_id = ? AND status = 'pending'
     ORDER BY priority ASC, created_at ASC
     LIMIT 1`,
    agentId
  )

  if (!task) return false

  // Mark as running
  await db.run(
    `UPDATE agent_execution_queue SET status = 'running', started_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
    task.id
  )

  try {
    const result = await dispatchTask(
      agentId,
      task.id,
      task.action,
      JSON.parse(task.params || "{}"),
      30000
    )

    if (result.success) {
      await db.run(
        `UPDATE agent_execution_queue SET
          status = 'completed',
          result = ?,
          completed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
         WHERE id = ?`,
        JSON.stringify(result.result),
        task.id
      )
    } else {
      await handleTaskFailure(task, result.error || "Unknown error")
    }
  } catch (error) {
    await handleTaskFailure(task, error instanceof Error ? error.message : "Unknown error")
  }

  // Process next task
  return processNextTask(agentId)
}

async function handleTaskFailure(task: any, error: string) {
  const db = await initDB()
  const attempts = (task.attempts || 0) + 1

  if (attempts >= (task.max_attempts || 3)) {
    await db.run(
      `UPDATE agent_execution_queue SET
        status = 'failed',
        error = ?,
        attempts = ?,
        completed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
       WHERE id = ?`,
      error,
      attempts,
      task.id
    )
  } else {
    await db.run(
      `UPDATE agent_execution_queue SET
        status = 'retry',
        error = ?,
        attempts = ?
       WHERE id = ?`,
      error,
      attempts,
      task.id
    )

    // Re-enqueue after delay
    setTimeout(() => {
      db.run(
        `UPDATE agent_execution_queue SET status = 'pending' WHERE id = ?`,
        task.id
      ).then(() => processNextTask(task.agent_id).catch(() => {}))
    }, 5000 * attempts) // Exponential backoff
  }
}

/**
 * Start polling for tasks for connected agents
 */
export function startAgentPolling(agentId: number, intervalMs = 5000) {
  stopAgentPolling(agentId)

  const interval = setInterval(() => {
    processNextTask(agentId).catch(() => {})
  }, intervalMs)

  pollingIntervals.set(agentId, interval)
}

/**
 * Stop polling for an agent
 */
export function stopAgentPolling(agentId: number) {
  const interval = pollingIntervals.get(agentId)
  if (interval) {
    clearInterval(interval)
    pollingIntervals.delete(agentId)
  }
}

/**
 * Get queue stats for an agent
 */
export async function getQueueStats(agentId: number) {
  const db = await initDB()

  const stats = await db.get(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'running') as running,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) as total
     FROM agent_execution_queue
     WHERE agent_id = ?`,
    agentId
  )

  return stats || { pending: 0, running: 0, completed: 0, failed: 0, total: 0 }
}

// Listen for agent connections to start polling
agentEvents.on("agent:connected", (agentId: number) => {
  startAgentPolling(agentId)
})

agentEvents.on("agent:disconnected", (agentId: number) => {
  stopAgentPolling(agentId)
})
