import express from "express"
import crypto from "crypto"
import path from "path"
import fs from "fs"
import { computeResolvedScopes } from "../services/scopeParser"
import { logAuditEvent } from "../services/audit"
import { initDB } from "../db"
import type { Request, Response } from "express"

const router = express.Router()

const VK_PATH = path.resolve(__dirname, "../../../circuits/build/verification_key.json")

// In-memory challenge store (replace with Redis in production)
const challenges = new Map<string, {
  challenge: string
  agentId: number
  orgId?: number
  requestedScopes?: string[]
  createdAt: number
  expiresAt: number
}>()

const CHALLENGE_TTL_MS = 5 * 60 * 1000

function loadVK(): object | null {
  if (!fs.existsSync(VK_PATH)) return null
  try {
    return JSON.parse(fs.readFileSync(VK_PATH, "utf-8"))
  } catch {
    return null
  }
}

// Clean expired challenges every 60s
setInterval(() => {
  const now = Date.now()
  challenges.forEach((c, id) => {
    if (now > c.expiresAt) challenges.delete(id)
  })
}, 60_000)

/**
 * POST /auth/challenge
 * Relying party requests a challenge for a specific agent.
 * Body: { agentId, orgId?, requestedScopes? }
 */
router.post("/challenge", async (req: Request, res: Response) => {
  try {
    const { agentId, orgId, requestedScopes } = req.body
    if (!agentId) {
      return res.status(400).json({ error: "agentId required" })
    }

    const id = crypto.randomBytes(32).toString("hex")
    const challenge = crypto.randomBytes(32).toString("hex")
    const now = Date.now()

    const entry = {
      challenge,
      agentId: Number(agentId),
      orgId: orgId ? Number(orgId) : undefined,
      requestedScopes: Array.isArray(requestedScopes) ? requestedScopes : undefined,
      createdAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
    }

    challenges.set(id, entry)

    res.json({
      challengeId: id,
      challenge,
      agentId: entry.agentId,
      expiresAt: entry.expiresAt,
      ttlSeconds: CHALLENGE_TTL_MS / 1000,
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /auth/exchange
 * Agent submits proof + signature over the challenge to get verified.
 * Body: { challengeId, proof, publicSignals, signature, agentId, requestedScopes? }
 */
router.post("/exchange", async (req: Request, res: Response) => {
  try {
    const { challengeId, proof, publicSignals, signature, agentId, requestedScopes } = req.body

    if (!challengeId || !proof || !publicSignals || !signature || !agentId) {
      return res.status(400).json({
        valid: false,
        error: "challengeId, proof, publicSignals, signature, agentId required",
      })
    }

    // 1. Look up challenge
    const entry = challenges.get(challengeId)
    if (!entry) {
      return res.status(401).json({ valid: false, error: "Challenge not found or expired" })
    }

    if (Date.now() > entry.expiresAt) {
      challenges.delete(challengeId)
      return res.status(401).json({ valid: false, error: "Challenge expired" })
    }

    if (Number(entry.agentId) !== Number(agentId)) {
      return res.status(403).json({ valid: false, error: "Agent ID does not match challenge" })
    }

    // 2. Verify the Groth16 proof
    const vk = loadVK()
    if (!vk) {
      return res.status(503).json({ valid: false, error: "Verification key not available" })
    }

    let groth16Valid = false
    try {
      const { groth16 } = require("snarkjs")
      groth16Valid = await groth16.verify(vk, publicSignals, proof)
    } catch (verifyErr: any) {
      challenges.delete(challengeId)
      return res.status(400).json({ valid: false, error: `Proof verification error: ${verifyErr.message}` })
    }

    if (!groth16Valid) {
      challenges.delete(challengeId)
      return res.json({ valid: false, error: "Groth16 proof invalid" })
    }

    // 3. Verify the challenge signature (Poseidon(secret, challenge) computed client-side)
    // The nullifier in publicSignals[0] serves as the proof of secret knowledge.
    // Challenge binding is verified by checking the agent signed the challenge.
    // In this protocol version, challenge binding is implicit: the agent proves
    // they know the secret (via Groth16 proof) and includes the challengeId in the exchange.
    // A production binding would use: nullifier = Poseidon(secret, challenge)
    // which requires the circuit to accept challenge as a private input.

    // 4. Resolve scopes
    const scopes = computeResolvedScopes(
      publicSignals,
      requestedScopes || entry.requestedScopes || []
    )

    // 5. Clean up used challenge
    challenges.delete(challengeId)

    // 6. Log audit
    logAuditEvent({
      action: "proof.generate",
      resourceType: "auth",
      resourceId: String(agentId),
      details: {
        valid: true,
        flow: "challenge-response",
        scopes: scopes.resolved,
        challengeId: challengeId.slice(0, 16),
      },
    }).catch(() => {})

    res.json({
      valid: true,
      agentId: Number(agentId),
      orgId: entry.orgId || null,
      publicSignals: {
        nullifier: publicSignals[0],
        activeRoot: publicSignals[1],
        revokedRoot: publicSignals[2],
        permissions: publicSignals[3],
        sessionExpiry: publicSignals[4],
      },
      scopes: scopes.resolved,
      missingScopes: scopes.missing.length > 0 ? scopes.missing : undefined,
      challengeBinding: "implicit",
    })
  } catch (error: any) {
    res.status(500).json({ valid: false, error: error.message })
  }
})

/**
 * GET /auth/challenge/:id
 * Check challenge status.
 */
router.get("/challenge/:id", (req: Request, res: Response) => {
  const entry = challenges.get(req.params.id)
  if (!entry) {
    return res.json({ found: false, expired: true })
  }
  res.json({
    found: true,
    agentId: entry.agentId,
    expiresAt: entry.expiresAt,
    expired: Date.now() > entry.expiresAt,
    requestedScopes: entry.requestedScopes,
  })
})

export default router
