import { Hono } from "hono"
import { getAuditLogs, getAuditLogById, getAuditStats, logAuditEvent, type AuditAction } from "../services/audit"
import { listAnomalyAlerts, runAnomalyDetection } from "../services/anomalyDetection"
import type { AppContext, AppVariables } from "../types/http"
import { respondWithError } from "../utils/errors"
import { requireInteger } from "../utils/validation"

const router = new Hono<{ Variables: AppVariables }>()

router.post("/events", async (c) => {
    try {
        const body = await c.req.json()
        const { events, orgId, agentId } = body

        if (!Array.isArray(events) || events.length === 0) {
            return c.json({ error: "events array required" }, 400)
        }

        const results: { index: number; success: boolean; error?: string }[] = []

        for (let i = 0; i < events.length; i++) {
            try {
                const ev = events[i]
                await logAuditEvent({
                    orgId,
                    userId: agentId,
                    action: ev.action as AuditAction,
                    resourceType: ev.resourceType,
                    resourceId: ev.resourceId,
                    details: {
                        ...(ev.details ?? {}),
                        clientTimestamp: ev.timestamp,
                    },
                })
                results.push({ index: i, success: true })
            } catch (err: any) {
                results.push({ index: i, success: false, error: err.message })
            }
        }

        return c.json({ ingested: results.filter(r => r.success).length, results })
    } catch (error) {
        return respondWithError(c, error, "audit.ingest")
    }
})

router.get("/", async (c) => {
    try {
        const auth = c.get("auth")
        const orgIdParam = c.req.query("orgId")
        const orgId = orgIdParam
            ? requireInteger(orgIdParam, "orgId", 1)
            : auth?.orgId

        if (!orgId) {
            return c.json({ error: "orgId required" }, 400)
        }

        const result = await getAuditLogs(orgId, {
            action: c.req.query("action") as AuditAction | undefined,
            userId: c.req.query("userId") ? Number(c.req.query("userId")) : undefined,
            resourceType: c.req.query("resourceType") as string | undefined,
            search: c.req.query("search") as string | undefined,
            from: c.req.query("from") ? Number(c.req.query("from")) : undefined,
            to: c.req.query("to") ? Number(c.req.query("to")) : undefined,
            limit: Math.min(Number(c.req.query("limit") ?? 100), 500),
            offset: Number(c.req.query("offset") ?? 0),
        })

        return c.json(result)
    } catch (error) {
        return respondWithError(c, error, "audit.list")
    }
})

router.get("/stats", async (c) => {
    try {
        const auth = c.get("auth")
        const orgIdParam = c.req.query("orgId")
        const orgId = orgIdParam
            ? requireInteger(orgIdParam, "orgId", 1)
            : auth?.orgId

        if (!orgId) {
            return c.json({ error: "orgId required" }, 400)
        }

        const stats = await getAuditStats(orgId)
        return c.json(stats)
    } catch (error) {
        return respondWithError(c, error, "audit.stats")
    }
})

router.get("/anomalies", async (c) => {
    try {
        const auth = c.get("auth")
        const orgIdParam = c.req.query("orgId")
        const orgId = orgIdParam
            ? requireInteger(orgIdParam, "orgId", 1)
            : auth?.orgId

        if (!orgId) {
            return c.json({ error: "orgId required" }, 400)
        }

        const run = c.req.query("run") === "true"
        const alerts = run
            ? await runAnomalyDetection(orgId)
            : await listAnomalyAlerts(orgId)

        return c.json({ items: alerts })
    } catch (error) {
        return respondWithError(c, error, "audit.anomalies")
    }
})

router.get("/export", async (c) => {
    try {
        const auth = c.get("auth")
        const orgIdParam = c.req.query("orgId")
        const orgId = orgIdParam
            ? requireInteger(orgIdParam, "orgId", 1)
            : auth?.orgId

        if (!orgId) {
            return c.json({ error: "orgId required" }, 400)
        }

        const format = c.req.query("format") || "json"
        const result = await getAuditLogs(orgId, {
            action: c.req.query("action") as AuditAction | undefined,
            search: c.req.query("search") as string | undefined,
            from: c.req.query("from") ? Number(c.req.query("from")) : undefined,
            to: c.req.query("to") ? Number(c.req.query("to")) : undefined,
            limit: 10000,
            offset: 0,
        })

        if (format === "csv") {
            const header = "id,action,resource_type,resource_id,user_id,org_id,ip_address,created_at"
            const rows = result.items.map((item: any) =>
                [
                    item.id,
                    item.action,
                    item.resource_type,
                    item.resource_id ? `"${item.resource_id.replace(/"/g, '""')}"` : "",
                    item.user_id ?? "",
                    item.org_id ?? "",
                    item.ip_address ? `"${item.ip_address}"` : "",
                    item.created_at,
                ].join(",")
            )
            c.header("Content-Type", "text/csv")
            c.header("Content-Disposition", `attachment; filename="audit-log-org-${orgId}.csv"`)
            return c.text([header, ...rows].join("\n"))
        }

        return c.json(result)
    } catch (error) {
        return respondWithError(c, error, "audit.export")
    }
})

router.get("/:id", async (c) => {
    try {
        const logId = requireInteger(c.req.param("id"), "id", 1)
        const auth = c.get("auth")
        const orgIdParam = c.req.query("orgId")
        const orgId = orgIdParam
            ? requireInteger(orgIdParam, "orgId", 1)
            : auth?.orgId

        if (!orgId) {
            return c.json({ error: "orgId required" }, 400)
        }

        const entry = await getAuditLogById(orgId, logId)
        if (!entry) {
            return c.json({ error: "audit log not found" }, 404)
        }

        return c.json(entry)
    } catch (error) {
        return respondWithError(c, error, "audit.get")
    }
})

export default router
