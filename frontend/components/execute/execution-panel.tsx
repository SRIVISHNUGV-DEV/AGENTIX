"use client"

import { useState, useEffect, useCallback } from "react"
import { Play, Loader2, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  executeAgentAction,
  getAgentExecutions,
  getAgentExecutionStats,
} from "@/lib/mock-api"
import {
  ExecutionAction,
  Execution,
  ExecutionStats,
  AGENT_PERMISSIONS,
  PermissionKey,
} from "@/lib/types"
import { formatDate } from "@/lib/utils"

interface ExecutionPanelProps {
  agentId: string
  agentName: string
  orgId: number
}

const ACTION_OPTIONS: { value: ExecutionAction; label: string; description: string }[] = [
  { value: "read_file", label: "Read File", description: "Read contents of a file" },
  { value: "write_file", label: "Write File", description: "Write content to a file" },
  { value: "execute_command", label: "Execute Command", description: "Run a shell command" },
  { value: "query", label: "Query", description: "Execute a database query" },
  { value: "api_call", label: "API Call", description: "Make an HTTP request" },
  { value: "sign_transaction", label: "Sign Transaction", description: "Sign a blockchain transaction" },
  { value: "deploy_contract", label: "Deploy Contract", description: "Deploy a smart contract" },
  { value: "custom", label: "Custom", description: "Custom action with arbitrary params" },
]

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  READ_FILE: "Read File",
  WRITE_FILE: "Write File",
  EXECUTE_COMMAND: "Execute Command",
  QUERY: "Query",
  API_CALL: "API Call",
  SIGN_TRANSACTION: "Sign Transaction",
  DEPLOY_CONTRACT: "Deploy Contract",
  CUSTOM: "Custom",
  ALL: "All Permissions",
}

export function ExecutionPanel({ agentId, agentName, orgId }: ExecutionPanelProps) {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [stats, setStats] = useState<ExecutionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedResult, setExpandedResult] = useState<string | null>(null)

  // Form state
  const [selectedAction, setSelectedAction] = useState<ExecutionAction>("query")
  const [paramsJson, setParamsJson] = useState('{\n  "query": "SELECT * FROM users LIMIT 10"\n}')
  const [timeoutMs, setTimeoutMs] = useState(30000)

  const fetchData = useCallback(async () => {
    try {
      const [execsRes, statsRes] = await Promise.all([
        getAgentExecutions(agentId, orgId, 20),
        getAgentExecutionStats(agentId, orgId),
      ])
      if (execsRes.success) setExecutions(execsRes.data)
      if (statsRes.success) setStats(statsRes.data)
    } catch (err) {
      console.error("Failed to fetch execution data:", err)
    } finally {
      setLoading(false)
    }
  }, [agentId, orgId])

  useEffect(() => {
    fetchData()
    // Poll for updates every 5 seconds if there are pending executions
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleExecute = async () => {
    setExecuting(true)
    setError(null)

    try {
      const params = JSON.parse(paramsJson)
      const result = await executeAgentAction(agentId, {
        action: selectedAction,
        params,
        timeout: timeoutMs,
      })

      if (result.success) {
        // Refresh the list
        await fetchData()
      } else {
        setError("Execution failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute action")
    } finally {
      setExecuting(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-2xl font-bold">{stats.totalExecutions}</div>
            <div className="text-xs text-zinc-500">Total Executions</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-2xl font-bold text-emerald-400">{stats.successfulExecutions}</div>
            <div className="text-xs text-zinc-500">Successful</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-2xl font-bold text-red-400">{stats.failedExecutions}</div>
            <div className="text-xs text-zinc-500">Failed</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-2xl font-bold">{(stats.avgExecutionTimeMs ?? 0).toFixed(0)}ms</div>
            <div className="text-xs text-zinc-500">Avg Time</div>
          </div>
        </div>
      )}

      {/* Execute Form */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
        <h3 className="font-medium mb-4">Execute Action</h3>

        <div className="space-y-4">
          {/* Action Selector */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Action Type</label>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value as ExecutionAction)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} - {opt.description}
                </option>
              ))}
            </select>
          </div>

          {/* Params Editor */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Parameters (JSON)</label>
            <textarea
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600"
              placeholder='{"key": "value"}'
              suppressHydrationWarning
            />
          </div>

          {/* Timeout */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Timeout (ms)</label>
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600"
              min={1000}
              max={300000}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-900/20 border border-red-800 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Execute Button */}
          <Button
            onClick={handleExecute}
            disabled={executing}
            className="w-full bg-white text-black hover:bg-zinc-200"
          >
            {executing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Execute Action
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Execution History */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
        <h3 className="font-medium mb-4">Execution History</h3>

        {executions.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No executions yet. Run an action above to see history.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {executions.map((exec) => (
              <div
                key={exec.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/50 overflow-hidden"
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-800/50"
                  onClick={() => setExpandedResult(expandedResult === exec.id ? null : exec.id)}
                >
                  <div className="flex items-center gap-3">
                    {exec.success ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                    <div>
                      <div className="font-mono text-sm">{exec.action}</div>
                      <div className="text-xs text-zinc-500">
                        {formatDate(exec.createdAt)} · {exec.executionTimeMs}ms
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        exec.success
                          ? "bg-emerald-900/30 text-emerald-400"
                          : "bg-red-900/30 text-red-400"
                      }`}
                    >
                      {exec.success ? "Success" : "Failed"}
                    </span>
                    {expandedResult === exec.id ? (
                      <ChevronUp className="h-4 w-4 text-zinc-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-zinc-500" />
                    )}
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedResult === exec.id ? (
                  <div className="border-t border-zinc-800 p-3 space-y-3">
                    {/* Params */}
                    <div>
                      <div className="text-xs text-zinc-500 mb-1">Parameters</div>
                      <pre className="text-xs bg-zinc-950 rounded p-2 overflow-x-auto">
                        {JSON.stringify(exec.params, null, 2)}
                      </pre>
                    </div>

                    {/* Result or Error */}
                    {exec.result ? (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-zinc-500">Result</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => copyToClipboard(JSON.stringify(exec.result, null, 2))}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <pre className="text-xs bg-zinc-950 rounded p-2 overflow-x-auto max-h-48">
                          {JSON.stringify(exec.result, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    {exec.errorMessage ? (
                      <div>
                        <div className="text-xs text-red-500 mb-1">Error</div>
                        <pre className="text-xs bg-red-950/30 rounded p-2 text-red-400">
                          {exec.errorMessage}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
