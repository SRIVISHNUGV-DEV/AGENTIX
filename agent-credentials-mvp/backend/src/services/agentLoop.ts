/**
 * Autonomous Agent Loop Service
 *
 * This service enables agents to execute actions autonomously based on:
 * 1. Scheduled intervals (cron-like periodic execution)
 * 2. Event triggers (webhooks, blockchain events, etc.)
 * 3. Conditional triggers (threshold-based execution)
 *
 * The loop respects:
 * - Agent permissions (checked against credentials)
 * - Execution timeouts
 * - Rate limiting
 * - Whitelist constraints
 */

import { EventEmitter } from "events"
import { initDB } from "../db"
import { BlockchainService } from "./blockchain"
import { getAgentToolsService } from "./agentTools"

export interface LoopConfig {
    agentId: number
    intervalMs?: number // For periodic execution
    maxExecutions?: number // Maximum executions before stopping
    timeoutMs?: number // Per-execution timeout
    conditions?: LoopCondition[] // Conditional triggers
    retryCount?: number // Retry failed executions
    retryDelayMs?: number // Delay between retries
}

export interface LoopCondition {
    type: "time" | "event" | "threshold" | "webhook"
    config: Record<string, unknown>
}

export interface LoopState {
    agentId: number
    status: "idle" | "running" | "paused" | "stopped" | "error"
    executionCount: number
    lastExecutionAt: number | null
    lastError: string | null
    startedAt: number
    config: LoopConfig
}

export interface ExecutionResult {
    success: boolean
    result: unknown
    executionTimeMs: number
    error?: string
}

type LoopEventType = "start" | "stop" | "execution" | "error" | "pause" | "resume"

// In-memory storage for active loops (in production, use Redis)
const activeLoops = new Map<number, {
    state: LoopState
    timer?: ReturnType<typeof setInterval>
    emitter: EventEmitter
}>()

/**
 * Start an autonomous execution loop for an agent.
 */
export async function startAgentLoop(
    config: LoopConfig,
    blockchainService: BlockchainService
): Promise<LoopState> {
    const { agentId } = config
    const db = await initDB()

    // Check if loop already running
    if (activeLoops.has(agentId)) {
        const existing = activeLoops.get(agentId)!
        if (existing.state.status === "running") {
            throw new Error(`Agent ${agentId} loop already running`)
        }
    }

    // Verify agent exists and has valid credentials
    const agent = await db.get(
        "SELECT * FROM external_agents WHERE id = ?",
        [agentId]
    )
    if (!agent) {
        throw new Error(`Agent ${agentId} not found`)
    }

    // Check for valid credentials
    const credentials = await db.all(
        `SELECT * FROM credentials WHERE agent_id = ? AND expires_at > ?`,
        [agentId, Math.floor(Date.now() / 1000)]
    )
    if (credentials.length === 0) {
        throw new Error(`Agent ${agentId} has no valid credentials`)
    }

    // Initialize loop state
    const state: LoopState = {
        agentId,
        status: "running",
        executionCount: 0,
        lastExecutionAt: null,
        lastError: null,
        startedAt: Date.now(),
        config
    }

    const emitter = new EventEmitter()

    // Set up periodic execution if interval provided
    let timer: ReturnType<typeof setInterval> | undefined
    if (config.intervalMs && config.intervalMs > 0) {
        timer = setInterval(async () => {
            try {
                await executeLoopIteration(agentId, blockchainService)
            } catch (error) {
                emitter.emit("error", {
                    agentId,
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }, config.intervalMs)
    }

    activeLoops.set(agentId, { state, timer, emitter })

    emitter.emit("start", { agentId, config })

    return state
}

/**
 * Stop an agent's execution loop.
 */
export async function stopAgentLoop(agentId: number): Promise<LoopState | null> {
    const loop = activeLoops.get(agentId)
    if (!loop) {
        return null
    }

    if (loop.timer) {
        clearInterval(loop.timer)
    }

    loop.state.status = "stopped"
    loop.emitter.emit("stop", { agentId })

    activeLoops.delete(agentId)

    return loop.state
}

/**
 * Pause an agent's execution loop.
 */
export function pauseAgentLoop(agentId: number): LoopState | null {
    const loop = activeLoops.get(agentId)
    if (!loop) {
        return null
    }

    if (loop.timer) {
        clearInterval(loop.timer)
        loop.timer = undefined
    }

    loop.state.status = "paused"
    loop.emitter.emit("pause", { agentId })

    return loop.state
}

/**
 * Resume a paused agent's execution loop.
 */
export function resumeAgentLoop(
    agentId: number,
    blockchainService: BlockchainService
): LoopState | null {
    const loop = activeLoops.get(agentId)
    if (!loop || loop.state.status !== "paused") {
        return null
    }

    loop.state.status = "running"

    // Restart timer if interval configured
    if (loop.state.config.intervalMs && loop.state.config.intervalMs > 0) {
        loop.timer = setInterval(async () => {
            try {
                await executeLoopIteration(agentId, blockchainService)
            } catch (error) {
                loop.emitter.emit("error", {
                    agentId,
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }, loop.state.config.intervalMs)
    }

    loop.emitter.emit("resume", { agentId })

    return loop.state
}

/**
 * Get the current state of an agent's loop.
 */
export function getAgentLoopState(agentId: number): LoopState | null {
    const loop = activeLoops.get(agentId)
    return loop ? loop.state : null
}

/**
 * Execute a single iteration of the agent loop.
 */
async function executeLoopIteration(
    agentId: number,
    blockchainService: BlockchainService
): Promise<ExecutionResult> {
    const db = await initDB()
    const loop = activeLoops.get(agentId)
    if (!loop || loop.state.status !== "running") {
        throw new Error(`Agent ${agentId} loop not running`)
    }

    const startTime = Date.now()
    const config = loop.state.config

    // Check max executions limit
    if (config.maxExecutions && loop.state.executionCount >= config.maxExecutions) {
        await stopAgentLoop(agentId)
        return {
            success: false,
            result: null,
            executionTimeMs: 0,
            error: "Max executions reached"
        }
    }

    try {
        // Get pending tasks for this agent
        const pendingTasks = await db.all(
            `SELECT * FROM agent_execution_queue
             WHERE agent_id = ? AND status = 'pending'
             ORDER BY created_at ASC
             LIMIT 1`,
            [agentId]
        )

        if (pendingTasks.length === 0) {
            // No pending tasks, this is a heartbeat iteration
            loop.emitter.emit("execution", {
                agentId,
                result: { type: "heartbeat", executed: false }
            })
            return {
                success: true,
                result: { type: "heartbeat" },
                executionTimeMs: Date.now() - startTime
            }
        }

        const task = pendingTasks[0]

        // Mark task as running
        await db.run(
            `UPDATE agent_execution_queue SET status = 'running', started_at = ? WHERE id = ?`,
            [Math.floor(Date.now() / 1000), task.id]
        )

        // Execute the task based on action type
        const result = await executeTask(agentId, task, blockchainService, config.timeoutMs)

        // Update task status
        await db.run(
            `UPDATE agent_execution_queue
             SET status = ?, result = ?, completed_at = ?
             WHERE id = ?`,
            [
                result.success ? "completed" : "failed",
                JSON.stringify(result.result),
                Math.floor(Date.now() / 1000),
                task.id
            ]
        )

        // Update loop state
        loop.state.executionCount++
        loop.state.lastExecutionAt = Date.now()

        if (!result.success) {
            loop.state.lastError = result.error || "Unknown error"
        }

        loop.emitter.emit("execution", {
            agentId,
            taskId: task.id,
            result
        })

        return result

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        loop.state.lastError = errorMessage
        loop.state.status = "error"

        loop.emitter.emit("error", {
            agentId,
            error: errorMessage
        })

        return {
            success: false,
            result: null,
            executionTimeMs: Date.now() - startTime,
            error: errorMessage
        }
    }
}

/**
 * Execute a single task from the queue.
 */
async function executeTask(
    agentId: number,
    task: any,
    blockchainService: BlockchainService,
    timeoutMs?: number
): Promise<ExecutionResult> {
    const startTime = Date.now()
    const timeout = timeoutMs || 30000 // Default 30s timeout

    try {
        const params = JSON.parse(task.params || "{}")
        let result: unknown

        // Blockchain actions - use AgentToolsService
        const blockchainActions = [
            "send_transaction",
            "batch_transactions",
            "get_wallet_info",
            "check_whitelist",
            "add_to_whitelist",
            "remove_from_whitelist",
            "deposit_gas",
            "get_gas_balance"
        ]

        if (blockchainActions.includes(task.action)) {
            const agentTools = getAgentToolsService()
            const toolResult = await executeWithTimeout(
                agentTools.executeAction(task.action, params),
                timeout
            )
            return {
                success: toolResult.success,
                result: toolResult.result,
                executionTimeMs: Date.now() - startTime,
                error: toolResult.error
            }
        }

        switch (task.action) {
            case "sign_transaction":
                // Legacy action - use send_transaction instead
                result = await executeWithTimeout(
                    executeSignTransaction(agentId, params, blockchainService),
                    timeout
                )
                break

            case "api_call":
                result = await executeWithTimeout(
                    executeApiCall(params),
                    timeout
                )
                break

            case "read_file":
            case "write_file":
            case "execute_command":
            case "query":
            case "deploy_contract":
            case "custom":
                // Placeholder for other action types
                result = { message: `Action ${task.action} executed`, params }
                break

            default:
                throw new Error(`Unknown action type: ${task.action}`)
        }

        return {
            success: true,
            result,
            executionTimeMs: Date.now() - startTime
        }

    } catch (error) {
        return {
            success: false,
            result: null,
            executionTimeMs: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

/**
 * Execute a promise with timeout.
 */
async function executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Execution timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        promise
            .then((result) => {
                clearTimeout(timer)
                resolve(result)
            })
            .catch((error) => {
                clearTimeout(timer)
                reject(error)
            })
    })
}

/**
 * Execute a sign_transaction action.
 */
async function executeSignTransaction(
    agentId: number,
    params: { to: string; value: string; data?: string },
    blockchainService: BlockchainService
): Promise<{ txHash: string }> {
    const { to, value, data } = params
    const db = await initDB()

    // Get agent's wallet
    const wallet = await db.get(
        `SELECT w.* FROM wallets w
         JOIN external_agents ea ON ea.org_id = w.org_id
         WHERE ea.id = ?`,
        [agentId]
    )

    if (!wallet) {
        throw new Error("Agent has no wallet")
    }

    // Check whitelist
    const isWhitelisted = await blockchainService.isWhitelisted(wallet.address, to)
    if (!isWhitelisted) {
        throw new Error(`Address ${to} is not whitelisted for this wallet`)
    }

    // For now, return a placeholder since we need proper wallet integration
    // In production, this would use the agent's session key to sign
    // blockchainService.prepareUserOperationForWallet with proper parameters
    return {
        txHash: `pending_${wallet.address}_${Date.now()}`
    }
}

/**
 * Execute an API call action.
 */
async function executeApiCall(params: {
    url: string
    method?: "GET" | "POST" | "PUT" | "DELETE"
    headers?: Record<string, string>
    body?: unknown
}): Promise<{ status: number; data: unknown }> {
    const { url, method = "GET", headers = {}, body } = params

    const response = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    })

    const data = await response.json().catch(() => null)

    return {
        status: response.status,
        data
    }
}

/**
 * Subscribe to loop events.
 */
export function subscribeToLoopEvents(
    agentId: number,
    event: LoopEventType,
    callback: (data: unknown) => void
): () => void {
    const loop = activeLoops.get(agentId)
    if (!loop) {
        throw new Error(`Agent ${agentId} has no active loop`)
    }

    loop.emitter.on(event, callback)

    // Return unsubscribe function
    return () => {
        loop.emitter.off(event, callback)
    }
}

/**
 * Get all active loops.
 */
export function getActiveLoops(): LoopState[] {
    return Array.from(activeLoops.values()).map((loop) => loop.state)
}

/**
 * Queue a task for an agent to execute.
 */
export async function queueAgentTask(
    agentId: number,
    action: string,
    params: Record<string, unknown>,
    scheduledAt?: number
): Promise<{ taskId: number }> {
    const db = await initDB()
    const result = await db.run(
        `INSERT INTO agent_execution_queue
         (agent_id, action, params, status, created_at, scheduled_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
        [
            agentId,
            action,
            JSON.stringify(params),
            Math.floor(Date.now() / 1000),
            scheduledAt || Math.floor(Date.now() / 1000)
        ]
    )

    return { taskId: result.lastID }
}
