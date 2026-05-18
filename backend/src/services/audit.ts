// FLAW 13 FIX: Audit trail for critical operations
// Logs who authorized what action, when, from where

import { IncomingHttpHeaders } from "http"
import { initDB } from "../db"

export type AuditAction =
    | "org.create"
    | "org.delete"
    | "agent.create"
    | "agent.delete"
    | "credential.issue"
    | "credential.revoke"
    | "session.create"
    | "session.terminate"
    | "wallet.create"
    | "wallet.transfer"
    | "auth.login"
    | "auth.logout"
    | "proof.generate"
    | "external_agent.connect"
    | "external_agent.disconnect"

export type AuditLogEntry = {
    orgId?: number
    userId?: number
    action: AuditAction
    resourceType: string
    resourceId?: string
    details?: Record<string, unknown>
    ipAddress?: string
    userAgent?: string
}

/**
 * Log an audit event to the audit_log table
 * This should be called for all critical operations
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
    const db = await initDB()

    await db.run(
        `
        INSERT INTO audit_log
        (org_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, EXTRACT(EPOCH FROM NOW())::INTEGER)
        `,
        entry.orgId ?? null,
        entry.userId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null
    )
}

/**
 * Extract client IP from request headers
 * Handles X-Forwarded-For and X-Real-IP
 */
export function extractClientIP(headers: IncomingHttpHeaders): string | undefined {
    const forwarded = headers["x-forwarded-for"]
    if (forwarded) {
        const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded
        return forwardedStr.split(",")[0].trim()
    }

    const realIP = headers["x-real-ip"]
    if (typeof realIP === "string") {
        return realIP
    }

    return undefined
}

/**
 * Extract user agent from request headers
 */
export function extractUserAgent(headers: IncomingHttpHeaders): string | undefined {
    const ua = headers["user-agent"]
    return typeof ua === "string" ? ua : undefined
}

/**
 * Query audit logs for an organization
 */
export async function getAuditLogs(
    orgId: number,
    options?: {
        action?: AuditAction
        userId?: number
        resourceType?: string
        limit?: number
        offset?: number
    }
): Promise<Array<{
    id: number
    org_id: number | null
    user_id: number | null
    action: string
    resource_type: string
    resource_id: string | null
    details: string | null
    ip_address: string | null
    user_agent: string | null
    created_at: number
}>> {
    const db = await initDB()

    const conditions: string[] = ["org_id = $1"]
    const params: (string | number)[] = [orgId]
    let paramIndex = 2

    if (options?.action) {
        conditions.push(`action = $${paramIndex}`)
        params.push(options.action)
        paramIndex++
    }

    if (options?.userId) {
        conditions.push(`user_id = $${paramIndex}`)
        params.push(options.userId)
        paramIndex++
    }

    if (options?.resourceType) {
        conditions.push(`resource_type = $${paramIndex}`)
        params.push(options.resourceType)
        paramIndex++
    }

    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0

    params.push(limit, offset)

    return db.all(
        `
        SELECT *
        FROM audit_log
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `,
        ...params
    )
}

/**
 * Get audit statistics for an organization
 */
export async function getAuditStats(orgId: number): Promise<{
    totalEvents: number
    eventsByAction: Record<string, number>
    eventsByUser: Array<{ user_id: number; count: number }>
    recentActivity: number
}> {
    const db = await initDB()

    const totalResult = await db.get(
        `SELECT COUNT(*) as count FROM audit_log WHERE org_id = $1`,
        orgId
    )

    const byActionResult = await db.all(
        `
        SELECT action, COUNT(*) as count
        FROM audit_log
        WHERE org_id = $1
        GROUP BY action
        ORDER BY count DESC
        `,
        orgId
    )

    const byUserResult = await db.all(
        `
        SELECT user_id, COUNT(*) as count
        FROM audit_log
        WHERE org_id = $1 AND user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY count DESC
        LIMIT 10
        `,
        orgId
    )

    const recentResult = await db.get(
        `
        SELECT COUNT(*) as count
        FROM audit_log
        WHERE org_id = $1
          AND created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')::INTEGER
        `,
        orgId
    )

    return {
        totalEvents: totalResult?.count ?? 0,
        eventsByAction: Object.fromEntries(
            byActionResult.map((r: any) => [r.action, r.count])
        ),
        eventsByUser: byUserResult.map((r: any) => ({
            user_id: r.user_id,
            count: r.count
        })),
        recentActivity: recentResult?.count ?? 0
    }
}
