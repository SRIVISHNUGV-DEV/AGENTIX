import express from "express"
import { initDB } from "../db"
import { requireAuth } from "../middleware/auth"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"

const router = express.Router()

router.get("/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId

        const [agents, sessions, wallets, recentEvents] = await Promise.all([
            db.get(`SELECT COUNT(*)::int as count FROM agents WHERE org_id = $1`, orgId),
            db.get(`SELECT COUNT(*)::int as count FROM sessions s INNER JOIN agents a ON a.id = s.agent_id WHERE a.org_id = $1`, orgId),
            db.get(`SELECT COUNT(*)::int as count FROM wallets WHERE org_id = $1`, orgId),
            db.get(`SELECT COUNT(*)::int as count FROM audit_log WHERE org_id = $1 AND created_at > EXTRACT(EPOCH FROM NOW())::INTEGER - 86400`, orgId),
        ])

        res.json({
            success: true,
            data: {
                totalAgents: agents?.count || 0,
                totalSessions: sessions?.count || 0,
                totalWallets: wallets?.count || 0,
                recentEvents: recentEvents?.count || 0,
            },
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.stats")
    }
})

router.get("/actions", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId
        const limit = Math.min(parseInt(String(req.query.limit) || "50", 10), 200)
        const offset = parseInt(String(req.query.offset) || "0", 10)
        const agentId = req.query.agentId ? String(req.query.agentId) : undefined

        let query = `
            SELECT al.*, a.agent_name
            FROM audit_log al
            LEFT JOIN agents a ON a.id = CAST(al.resource_id AS INTEGER)
            WHERE al.org_id = $1
        `
        const params: any[] = [orgId]

        if (agentId) {
            params.push(parseInt(agentId, 10))
            query += ` AND al.resource_id = $${params.length}`
        }

        query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
        params.push(limit, offset)

        const actions = await db.all(query, ...params)

        const total = await db.get(
            `SELECT COUNT(*)::int as count FROM audit_log WHERE org_id = $1`,
            orgId
        )

        res.json({
            success: true,
            data: actions,
            total: total?.count || 0,
            limit,
            offset,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.actions")
    }
})

router.get("/payments", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId
        const limit = Math.min(parseInt(String(req.query.limit) || "50", 10), 200)

        const payments = await db.all(
            `SELECT csl.*, a.agent_name
             FROM covenant_spending_log csl
             INNER JOIN agents a ON a.id = csl.agent_id
             WHERE csl.org_id = $1
             ORDER BY csl.created_at DESC
             LIMIT $2`,
            orgId, limit
        )

        res.json({
            success: true,
            data: payments,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.payments")
    }
})

router.get("/policies", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId

        const policies = await db.all(
            `SELECT ap.*, a.agent_name
             FROM agent_policies ap
             LEFT JOIN agents a ON a.id = ap.agent_id
             WHERE ap.org_id = $1
             ORDER BY ap.created_at DESC`,
            orgId
        )

        res.json({
            success: true,
            data: policies,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.policies")
    }
})

router.post("/policies", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId
        const { agentId, policyType, policyValue } = req.body

        if (!policyType || !policyValue) {
            return res.status(400).json({ error: "policyType and policyValue are required" })
        }

        const result = await db.run(
            `INSERT INTO agent_policies (org_id, agent_id, policy_type, policy_value)
             VALUES ($1, $2, $3, $4)`,
            orgId,
            agentId || null,
            policyType,
            JSON.stringify(policyValue)
        )

        res.json({
            success: true,
            policyId: result.lastID,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.createPolicy")
    }
})

router.delete("/policies/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId
        const policyId = parseInt(String(req.params.id), 10)

        const policy = await db.get(
            `SELECT id FROM agent_policies WHERE id = $1 AND org_id = $2`,
            policyId, orgId
        )
        if (!policy) {
            return res.status(404).json({ error: "policy not found" })
        }

        await db.run(
            `UPDATE agent_policies SET is_active = 0 WHERE id = $1`,
            policyId
        )

        res.json({ success: true })
    } catch (error) {
        respondWithError(res, error, "dashboard.deletePolicy")
    }
})

router.get("/whitelist", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId

        const parties = await db.all(
            `SELECT wp.*, u.name as set_by_name
             FROM whitelisted_parties wp
             LEFT JOIN users u ON u.id = wp.set_by
             WHERE wp.org_id = $1
             ORDER BY wp.created_at DESC`,
            orgId
        )

        res.json({
            success: true,
            data: parties,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.whitelist")
    }
})

router.post("/whitelist", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId
        const { address, label, maxPaymentWei } = req.body

        if (!address) {
            return res.status(400).json({ error: "address is required" })
        }

        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
            return res.status(400).json({ error: "invalid Ethereum address" })
        }

        const existing = await db.get(
            `SELECT id FROM whitelisted_parties WHERE org_id = $1 AND LOWER(address) = LOWER($2)`,
            orgId, address
        )
        if (existing) {
            return res.status(409).json({ error: "address already whitelisted" })
        }

        const result = await db.run(
            `INSERT INTO whitelisted_parties (org_id, address, label, max_payment_wei, set_by)
             VALUES ($1, $2, $3, $4, $5)`,
            orgId, address, label || null, maxPaymentWei || "0", req.auth!.userId
        )

        res.json({
            success: true,
            partyId: result.lastID,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.addWhitelist")
    }
})

router.delete("/whitelist/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId
        const partyId = parseInt(String(req.params.id), 10)

        const party = await db.get(
            `SELECT id FROM whitelisted_parties WHERE id = $1 AND org_id = $2`,
            partyId, orgId
        )
        if (!party) {
            return res.status(404).json({ error: "party not found" })
        }

        await db.run(
            `DELETE FROM whitelisted_parties WHERE id = $1`,
            partyId
        )

        res.json({ success: true })
    } catch (error) {
        respondWithError(res, error, "dashboard.removeWhitelist")
    }
})

router.get("/agents", requireAuth, async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const orgId = req.auth!.orgId

        const agents = await db.all(
            `SELECT a.*,
                (SELECT COUNT(*)::int FROM sessions s WHERE s.agent_id = a.id) as session_count,
                (SELECT COUNT(*)::int FROM agent_api_keys ak WHERE ak.agent_id = a.id AND ak.is_active = 1) as api_key_count
             FROM agents a
             WHERE a.org_id = $1
             ORDER BY a.created_at DESC`,
            orgId
        )

        res.json({
            success: true,
            data: agents,
        })
    } catch (error) {
        respondWithError(res, error, "dashboard.agents")
    }
})

export default router
