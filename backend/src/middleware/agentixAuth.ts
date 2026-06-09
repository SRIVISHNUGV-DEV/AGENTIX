import type { Request, Response, NextFunction } from "express"
import path from "path"
import fs from "fs"

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

export interface AgentixAuthResult {
  valid: boolean
  agentId?: number
  scopes?: string[]
  nullifier?: string
  permissions?: string
  sessionExpiry?: number
  error?: string
}

declare global {
  namespace Express {
    interface Request {
      agentix?: AgentixAuthResult
    }
  }
}

/**
 * Parse and verify an Agentix Authorization header.
 *
 * Header format:
 *   Authorization: Agentix <base64-encoded JSON>
 *
 * The decoded JSON:
 *   { proof, publicSignals, agentId, scopes }
 */
async function verifyAgentixToken(token: string): Promise<AgentixAuthResult> {
  let decoded: any
  try {
    const buf = Buffer.from(token, "base64")
    decoded = JSON.parse(buf.toString("utf-8"))
  } catch {
    return { valid: false, error: "Invalid Agentix token format" }
  }

  const { proof, publicSignals, agentId, scopes } = decoded

  if (!proof || !publicSignals || !agentId) {
    return { valid: false, error: "Token missing proof, publicSignals, or agentId" }
  }

  const vk = loadVK()
  if (!vk) {
    return { valid: false, error: "Verification key not available" }
  }

  try {
    const { groth16 } = require("snarkjs")
    const valid = await groth16.verify(vk, publicSignals, proof)

    if (!valid) {
      return { valid: false, error: "Groth16 proof invalid" }
    }

    return {
      valid: true,
      agentId: Number(agentId),
      scopes: Array.isArray(scopes) ? scopes : undefined,
      nullifier: publicSignals[0],
      permissions: publicSignals[3],
      sessionExpiry: parseInt(publicSignals[4], 10),
    }
  } catch (err: any) {
    return { valid: false, error: `Verification error: ${err.message}` }
  }
}

/**
 * Express middleware that validates Agentix Authorization header.
 * On success, sets req.agentix with the verification result.
 *
 * Usage:
 *   app.use("/api/protected", agentixAuthMiddleware, handler)
 *   // req.agentix.agentId, req.agentix.scopes
 */
export function agentixAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith("Agentix ")) {
    req.agentix = { valid: false, error: "Missing or invalid Authorization header" }
    return next()
  }

  const token = authHeader.slice("Agentix ".length).trim()

  verifyAgentixToken(token)
    .then((result) => {
      req.agentix = result
      next()
    })
    .catch((err) => {
      req.agentix = { valid: false, error: err.message }
      next()
    })
}

/**
 * Middleware factory: requires a valid Agentix auth.
 * Returns 401 if no valid proof.
 *
 * Usage:
 *   app.use("/api/admin", requireAgentixAuth(), handler)
 */
export function requireAgentixAuth(options?: {
  requiredScopes?: string[]
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.agentix?.valid) {
      return res.status(401).json({
        error: "Agentix authentication required",
        detail: req.agentix?.error,
      })
    }

    if (options?.requiredScopes?.length) {
      const missing = options.requiredScopes.filter(
        (s) => !req.agentix?.scopes?.includes(s)
      )
      if (missing.length > 0) {
        return res.status(403).json({
          error: "Missing required scopes",
          missingScopes: missing,
        })
      }
    }

    next()
  }
}
