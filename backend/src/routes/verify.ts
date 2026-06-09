import express from "express"
import path from "path"
import fs from "fs"
import { parsePublicSignals, computeResolvedScopes } from "../services/scopeParser"
import { logAuditEvent } from "../services/audit"

const router = express.Router()

const VK_PATH = path.resolve(__dirname, "../../../circuits/build/verification_key.json")

let verificationKeyCache: object | null = null

function loadVK(): object | null {
  if (verificationKeyCache) return verificationKeyCache
  if (!fs.existsSync(VK_PATH)) return null
  try {
    verificationKeyCache = JSON.parse(fs.readFileSync(VK_PATH, "utf-8"))
    return verificationKeyCache
  } catch {
    return null
  }
}

router.post("/", async (req, res) => {
  try {
    const { proof, publicSignals, requestedScopes } = req.body

    if (!proof || !publicSignals || !Array.isArray(publicSignals)) {
      return res.status(400).json({
        valid: false,
        error: "Invalid request: proof and publicSignals[] required",
      })
    }

    if (publicSignals.length < 5) {
      return res.status(400).json({
        valid: false,
        error: `Expected 5 public signals, got ${publicSignals.length}`,
      })
    }

    const vk = loadVK()
    if (!vk) {
      return res.status(503).json({
        valid: false,
        error: "Verification key not available on this server",
      })
    }

    let groth16Valid = false
    try {
      const { groth16 } = require("snarkjs")
      groth16Valid = await groth16.verify(vk, publicSignals, proof)
    } catch (verifyErr: any) {
      return res.status(400).json({
        valid: false,
        error: `Proof verification failed: ${verifyErr.message}`,
      })
    }

    if (!groth16Valid) {
      return res.json({
        valid: false,
        error: "Groth16 proof verification failed",
        publicSignals: parsePublicSignals(publicSignals),
      })
    }

    const parsed = parsePublicSignals(publicSignals)
    const scopes = requestedScopes
      ? computeResolvedScopes(publicSignals, requestedScopes)
      : null

    const result: any = {
      valid: true,
      proof: {
        nullifier: parsed["agentix:scope:nullifier"],
        permissions: parsed["agentix:scope:permissions"],
        sessionExpiry: parseInt(parsed["agentix:scope:session-expiry"], 10),
        activeRoot: parsed["agentix:scope:root:active"],
        revokedRoot: parsed["agentix:scope:root:revoked"],
      },
      publicSignals: parsed,
    }

    if (scopes) {
      result.requestedScopes = scopes.resolved
      if (scopes.missing.length > 0) {
        result.missingScopes = scopes.missing
      }
    }

    logAuditEvent({
      action: "proof.generate",
      resourceType: "proof",
      resourceId: parsed["agentix:scope:nullifier"]?.slice(0, 20),
      details: {
        valid: true,
        scopes: scopes?.resolved,
        permissions: parsed["agentix:scope:permissions"],
      },
    }).catch(() => {})

    res.json(result)
  } catch (error: any) {
    res.status(500).json({
      valid: false,
      error: `Verification error: ${error.message}`,
    })
  }
})

router.get("/", (_req, res) => {
  res.json({
    endpoint: "POST /verify",
    description: "Verify a Groth16 ZK proof and get resolved agent attributes",
    usage: {
      proof: "Groth16 proof object",
      publicSignals: "Array of 5 public signal strings",
      requestedScopes: "Optional array of scope strings to resolve",
    },
    scopes: "GET /.well-known/agentix for scope definitions",
  })
})

export default router
