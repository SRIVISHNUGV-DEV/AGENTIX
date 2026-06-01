import { metrics, errorTracker } from "./monitoring"

export function formatPrometheusMetrics(): string {
    const lines: string[] = []
    const ts = Date.now()

    // Help and type headers
    lines.push("# HELP agentix_requests_total Total request count")
    lines.push("# TYPE agentix_requests_total counter")
    lines.push("# HELP agentix_errors_total Total error count by type")
    lines.push("# TYPE agentix_errors_total counter")
    lines.push("# HELP agentix_request_duration_ms Request latency in ms")
    lines.push("# TYPE agentix_request_duration_ms gauge")
    lines.push("# HELP agentix_up Is the server up")
    lines.push("# TYPE agentix_up gauge")
    lines.push("# HELP agentix_uptime_seconds Server uptime in seconds")
    lines.push("# TYPE agentix_uptime_seconds gauge")
    lines.push("# HELP agentix_memory_bytes Memory usage in bytes")
    lines.push("# TYPE agentix_memory_bytes gauge")

    // Up
    lines.push(`agentix_up 1 ${ts}`)

    // Uptime
    lines.push(`agentix_uptime_seconds ${process.uptime()} ${ts}`)

    // Memory
    const mem = process.memoryUsage()
    lines.push(`agentix_memory_bytes{type="rss"} ${mem.rss} ${ts}`)
    lines.push(`agentix_memory_bytes{type="heapTotal"} ${mem.heapTotal} ${ts}`)
    lines.push(`agentix_memory_bytes{type="heapUsed"} ${mem.heapUsed} ${ts}`)
    lines.push(`agentix_memory_bytes{type="external"} ${mem.external} ${ts}`)

    // Metrics from collector
    const collected = metrics.getMetrics()
    for (const [name, val] of Object.entries(collected)) {
        const data = val as { count: number; lastValue: number }
        if (name.startsWith("errors.")) {
            lines.push(`agentix_errors_total{type="${name.replace("errors.", "")}"} ${data.count} ${ts}`)
        } else if (name.startsWith("requests.")) {
            lines.push(`agentix_requests_total{type="${name.replace("requests.", "")}"} ${data.count} ${ts}`)
        } else if (name.startsWith("latency.")) {
            lines.push(`agentix_request_duration_ms{type="${name.replace("latency.", "")}"} ${data.lastValue} ${ts}`)
        } else {
            lines.push(`agentix_${name.replace(/[^a-zA-Z0-9_]/g, "_")} ${data.count} ${ts}`)
        }
    }

    // Error tracker - recent error count
    const recentErrors = errorTracker.getErrors(Date.now() - 3600000) // last hour
    lines.push(`agentix_recent_errors_total ${recentErrors.length} ${ts}`)

    return lines.join("\n") + "\n"
}
