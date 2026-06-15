import express from "express"
import crypto from "crypto"
import { ethers } from "ethers"
import { initDB } from "../db"
import { generateApiKey, hashApiKey, signAccessToken, signRefreshToken, verifyToken } from "../services/jwt"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"

const router = express.Router()

router.post("/api-key", async (req, res) => {
    try {
        const db = await initDB()
        const { apiKey } = req.body

        if (!apiKey || typeof apiKey !== "string") {
            return res.status(400).json({ error: "apiKey is required" })
        }

        const keyHash = hashApiKey(apiKey)
        const keyRow = await db.get(
            `SELECT ak.*, a.agent_name, a.org_id as agent_org_id
             FROM agent_api_keys ak
             INNER JOIN agents a ON a.id = ak.agent_id
             WHERE ak.api_key_hash = $1 AND ak.is_active = 1`,
            keyHash
        )

        if (!keyRow) {
            return res.status(401).json({ error: "invalid API key" })
        }

        if (keyRow.expires_at && keyRow.expires_at < Math.floor(Date.now() / 1000)) {
            return res.status(401).json({ error: "API key expired" })
        }

        const agent = await db.get(
            `SELECT id, org_id, agent_name FROM agents WHERE id = $1`,
            keyRow.agent_id
        )

        if (!agent) {
            return res.status(401).json({ error: "agent not found" })
        }

        const tokenPayload = {
            sub: `agent:${agent.id}`,
            orgId: agent.org_id,
            role: "agent",
            type: "agent" as const,
            name: agent.agent_name || `Agent ${agent.id}`,
            agentId: agent.id,
            permissions: keyRow.permissions?.toString() || "0",
            spendingCap: keyRow.spending_limit_wei?.toString() || "0",
        }

        const accessToken = await signAccessToken(tokenPayload)
        const refresh = await signRefreshToken(`agent:${agent.id}`)

        await db.run(
            `INSERT INTO audit_log (org_id, action, resource_type, resource_id, details)
             VALUES ($1, 'agent.login', 'agent', $2, $3)`,
            agent.org_id,
            agent.id.toString(),
            JSON.stringify({ keyPrefix: keyRow.key_prefix })
        )

        res.json({
            success: true,
            accessToken,
            refreshToken: refresh.token,
            accessTokenExpires: Math.floor(Date.now() / 1000) + 900,
            refreshTokenExpires: refresh.expiresAt,
            agent: {
                id: agent.id,
                name: agent.agent_name,
                orgId: agent.org_id,
            },
        })
    } catch (error) {
        respondWithError(res, error, "agentAuth.apiKey")
    }
})

router.post("/eip191", async (req, res) => {
    try {
        const db = await initDB()
        const { address, message, signature, agentId } = req.body

        if (!address || !message || !signature) {
            return res.status(400).json({ error: "address, message, and signature are required" })
        }

        const expectedPrefix = "Sign in to AgentIX at "
        if (!message.startsWith(expectedPrefix)) {
            return res.status(400).json({ error: "invalid message format" })
        }

        const timestamp = parseInt(message.replace(expectedPrefix, ""), 10)
        if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
            return res.status(400).json({ error: "message expired or invalid timestamp" })
        }

        let recoveredAddress: string
        try {
            recoveredAddress = ethers.verifyMessage(message, signature)
        } catch {
            return res.status(401).json({ error: "invalid signature" })
        }

        if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
            return res.status(401).json({ error: "signature does not match address" })
        }

        const agentIdNum = agentId ? parseInt(agentId, 10) : null
        let agent: any

        if (agentIdNum) {
            agent = await db.get(
                `SELECT id, org_id, agent_name FROM agents WHERE id = $1`,
                agentIdNum
            )
        }

        if (!agent) {
            const walletAgent = await db.get(
                `SELECT a.id, a.org_id, a.agent_name
                 FROM wallets w
                 INNER JOIN agents a ON a.id = w.agent_id
                 WHERE LOWER(w.owner_address) = LOWER($1)
                 OR LOWER(w.wallet_address) = LOWER($1)
                 LIMIT 1`,
                address
            )
            agent = walletAgent
        }

        if (!agent) {
            agent = await db.get(
                `SELECT id, org_id, agent_name FROM agents WHERE LOWER(managed_secret) = LOWER($1)`,
                address
            )
        }

        if (!agent) {
            return res.status(404).json({ error: "no agent found for this address" })
        }

        const tokenPayload = {
            sub: `agent:${agent.id}`,
            orgId: agent.org_id,
            role: "agent",
            type: "agent" as const,
            name: agent.agent_name || `Agent ${agent.id}`,
            agentId: agent.id,
        }

        const accessToken = await signAccessToken(tokenPayload)
        const refresh = await signRefreshToken(`agent:${agent.id}`)

        await db.run(
            `INSERT INTO audit_log (org_id, action, resource_type, resource_id, details)
             VALUES ($1, 'agent.login_eip191', 'agent', $2, $3)`,
            agent.org_id,
            agent.id.toString(),
            JSON.stringify({ address })
        )

        res.json({
            success: true,
            accessToken,
            refreshToken: refresh.token,
            accessTokenExpires: Math.floor(Date.now() / 1000) + 900,
            refreshTokenExpires: refresh.expiresAt,
            agent: {
                id: agent.id,
                name: agent.agent_name,
                orgId: agent.org_id,
            },
        })
    } catch (error) {
        respondWithError(res, error, "agentAuth.eip191")
    }
})

router.post("/refresh", async (req, res) => {
    try {
        const db = await initDB()
        const { refreshToken } = req.body

        if (!refreshToken) {
            return res.status(400).json({ error: "refreshToken is required" })
        }

        const payload = await verifyToken(refreshToken)
        if (!payload || payload.type !== "refresh") {
            return res.status(401).json({ error: "invalid refresh token" })
        }

        const sub = payload.sub as string
        let newAccessToken: string

        if (sub.startsWith("agent:")) {
            const agentId = parseInt(sub.replace("agent:", ""), 10)
            const agent = await db.get(
                `SELECT id, org_id, agent_name FROM agents WHERE id = $1`,
                agentId
            )
            if (!agent) {
                return res.status(401).json({ error: "agent not found" })
            }

            const apiKey = await db.get(
                `SELECT permissions, spending_limit_wei
                 FROM agent_api_keys WHERE agent_id = $1 AND is_active = 1
                 ORDER BY created_at DESC LIMIT 1`,
                agentId
            )

            newAccessToken = await signAccessToken({
                sub,
                orgId: agent.org_id,
                role: "agent",
                type: "agent",
                name: agent.agent_name || `Agent ${agent.id}`,
                agentId: agent.id,
                permissions: apiKey?.permissions?.toString() || "0",
                spendingCap: apiKey?.spending_limit_wei?.toString() || "0",
            })
        } else {
            const userId = parseInt(sub.replace("user:", ""), 10)
            const user = await db.get(
                `SELECT id, org_id, email, name, role FROM users WHERE id = $1`,
                userId
            )
            if (!user) {
                return res.status(401).json({ error: "user not found" })
            }

            newAccessToken = await signAccessToken({
                sub,
                orgId: user.org_id,
                role: user.role,
                type: "user",
                email: user.email,
                name: user.name,
            })
        }

        res.json({
            success: true,
            accessToken: newAccessToken,
            accessTokenExpires: Math.floor(Date.now() / 1000) + 900,
        })
    } catch (error) {
        respondWithError(res, error, "agentAuth.refresh")
    }
})

router.post("/api-key/generate", async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const { agentId, permissions, spendingLimitWei, expiresAt } = req.body

        if (!req.auth) {
            return res.status(401).json({ error: "authentication required" })
        }

        if (!agentId) {
            return res.status(400).json({ error: "agentId is required" })
        }

        const agent = await db.get(
            `SELECT id, org_id, agent_name FROM agents WHERE id = $1 AND org_id = $2`,
            agentId, req.auth.orgId
        )
        if (!agent) {
            return res.status(404).json({ error: "agent not found in your organization" })
        }

        const { key, hash, prefix } = generateApiKey()

        await db.run(
            `INSERT INTO agent_api_keys (agent_id, org_id, api_key_hash, key_prefix, permissions, spending_limit_wei, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            agent.id,
            req.auth.orgId,
            hash,
            prefix,
            permissions || "00000000",
            spendingLimitWei || "0",
            expiresAt || null
        )

        await db.run(
            `INSERT INTO audit_log (org_id, user_id, action, resource_type, resource_id, details)
             VALUES ($1, $2, 'agent.api_key_created', 'agent', $3, $4)`,
            req.auth.orgId,
            req.auth.userId,
            agent.id.toString(),
            JSON.stringify({ keyPrefix: prefix })
        )

        res.json({
            success: true,
            apiKey: key,
            prefix,
            message: "Store this key securely — it will not be shown again",
        })
    } catch (error) {
        respondWithError(res, error, "agentAuth.generateApiKey")
    }
})

export default router
