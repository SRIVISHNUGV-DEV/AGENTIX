import { initDB } from "../db"

export type AnomalyAlert = {
  id: number
  orgId: number
  anomalyType: string
  severity: string
  status: string
  title: string
  summary: string
  fingerprint: string
  relatedResourceType?: string | null
  relatedResourceId?: string | null
  details: Record<string, unknown>
  detectedAt: number
  resolvedAt?: number | null
}

function buildFingerprint(orgId: number, anomalyType: string, scope: string) {
  return `${orgId}:${anomalyType}:${scope}`
}

async function upsertAlert(input: Omit<AnomalyAlert, "id">) {
  const db = await initDB()
  await db.run(
    `INSERT INTO anomaly_alerts (
      org_id, anomaly_type, severity, status, title, summary, fingerprint,
      related_resource_type, related_resource_id, details, detected_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      severity = excluded.severity,
      status = excluded.status,
      title = excluded.title,
      summary = excluded.summary,
      related_resource_type = excluded.related_resource_type,
      related_resource_id = excluded.related_resource_id,
      details = excluded.details,
      detected_at = excluded.detected_at,
      resolved_at = excluded.resolved_at`,
    input.orgId,
    input.anomalyType,
    input.severity,
    input.status,
    input.title,
    input.summary,
    input.fingerprint,
    input.relatedResourceType ?? null,
    input.relatedResourceId ?? null,
    JSON.stringify(input.details ?? {}),
    input.detectedAt,
    input.resolvedAt ?? null
  )
}

export async function runAnomalyDetection(orgId: number): Promise<AnomalyAlert[]> {
  const db = await initDB()
  const detectedAt = Math.floor(Date.now() / 1000)
  const alerts: AnomalyAlert[] = []

  const failedExecutions = await db.all(
    `SELECT external_agent_id, COUNT(*) as failures
     FROM agent_execution_logs
     WHERE org_id = ? AND success = false
       AND created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour')::INTEGER
     GROUP BY external_agent_id
     HAVING COUNT(*) >= 5`,
    orgId
  )

  for (const row of failedExecutions) {
    const alert: Omit<AnomalyAlert, "id"> = {
      orgId,
      anomalyType: "execution_failure_spike",
      severity: "high",
      status: "open",
      title: "Execution failure spike detected",
      summary: `External agent ${row.external_agent_id} failed ${row.failures} executions in the last hour.`,
      fingerprint: buildFingerprint(orgId, "execution_failure_spike", `agent:${row.external_agent_id}`),
      relatedResourceType: "external_agent",
      relatedResourceId: String(row.external_agent_id),
      details: { failuresLastHour: Number(row.failures) },
      detectedAt,
      resolvedAt: null,
    }
    await upsertAlert(alert)
  }

  const heavySpendSessions = await db.all(
    `SELECT s.id, s.external_agent_id, s.daily_spend_limit, u.spend_used
     FROM agent_sessions s
     JOIN session_usage u ON u.session_id = s.id
     WHERE s.revoked = false
       AND u.usage_date = CURRENT_DATE
       AND CAST(u.spend_used AS NUMERIC) >= CAST(s.daily_spend_limit AS NUMERIC) * 0.8`,
    []
  )

  for (const row of heavySpendSessions) {
    const alert: Omit<AnomalyAlert, "id"> = {
      orgId,
      anomalyType: "session_spend_surge",
      severity: "medium",
      status: "open",
      title: "Session nearing spend cap",
      summary: `Session ${row.id} has consumed at least 80% of its daily spend limit.`,
      fingerprint: buildFingerprint(orgId, "session_spend_surge", `session:${row.id}`),
      relatedResourceType: "session",
      relatedResourceId: String(row.id),
      details: {
        externalAgentId: row.external_agent_id,
        spendUsed: String(row.spend_used),
        dailySpendLimit: String(row.daily_spend_limit),
      },
      detectedAt,
      resolvedAt: null,
    }
    await upsertAlert(alert)
  }

  const sessionCreationBursts = await db.all(
    `SELECT resource_id, COUNT(*) as created_count
     FROM audit_log
     WHERE org_id = ? AND action = 'session.create'
       AND created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')::INTEGER
     GROUP BY resource_id
     HAVING COUNT(*) >= 4`,
    orgId
  )

  for (const row of sessionCreationBursts) {
    const resourceId = row.resource_id || "unknown"
    const alert: Omit<AnomalyAlert, "id"> = {
      orgId,
      anomalyType: "session_creation_burst",
      severity: "medium",
      status: "open",
      title: "Frequent session creation detected",
      summary: `Resource ${resourceId} created ${row.created_count} sessions in the last 24 hours.`,
      fingerprint: buildFingerprint(orgId, "session_creation_burst", `resource:${resourceId}`),
      relatedResourceType: "session",
      relatedResourceId: String(resourceId),
      details: { sessionCountLast24h: Number(row.created_count) },
      detectedAt,
      resolvedAt: null,
    }
    await upsertAlert(alert)
  }

  const rows = await db.all(
    `SELECT * FROM anomaly_alerts WHERE org_id = ? ORDER BY detected_at DESC LIMIT 100`,
    orgId
  )

  for (const row of rows) {
    alerts.push({
      id: row.id,
      orgId: row.org_id,
      anomalyType: row.anomaly_type,
      severity: row.severity,
      status: row.status,
      title: row.title,
      summary: row.summary,
      fingerprint: row.fingerprint,
      relatedResourceType: row.related_resource_type,
      relatedResourceId: row.related_resource_id,
      details: row.details ? JSON.parse(row.details) : {},
      detectedAt: row.detected_at,
      resolvedAt: row.resolved_at,
    })
  }

  return alerts
}

export async function listAnomalyAlerts(orgId: number): Promise<AnomalyAlert[]> {
  const db = await initDB()
  const rows = await db.all(
    `SELECT * FROM anomaly_alerts WHERE org_id = ? ORDER BY detected_at DESC LIMIT 100`,
    orgId
  )

  return rows.map((row: any) => ({
    id: row.id,
    orgId: row.org_id,
    anomalyType: row.anomaly_type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    summary: row.summary,
    fingerprint: row.fingerprint,
    relatedResourceType: row.related_resource_type,
    relatedResourceId: row.related_resource_id,
    details: row.details ? JSON.parse(row.details) : {},
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
  }))
}
