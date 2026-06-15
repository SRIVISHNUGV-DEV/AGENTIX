import express from "express"
import fs from "fs"
import path from "path"
import { STANDARD_SCOPES } from "../services/scopeParser"
import { getPublicJWK } from "../services/jwt"

const router = express.Router()

function timestamp() {
  return Math.floor(Date.now() / 1000)
}

router.get("/agentix", (_req, res) => {
  const config = {
    issuer: process.env.AGENTIX_ISSUER || "agentix://network/base-sepolia",
    version: "0.1.0",
    description: "Agentix — privacy-preserving agent identity and authorization protocol",
    docs_url: "https://github.com/SRIVISHNUGV-DEV/AGENTIX",

    credential_registry: process.env.CREDENTIAL_REGISTRY || null,
    session_manager: process.env.SESSION_MANAGER || null,

    circuits: [
      {
        id: "credential_v1",
        n_public: 5,
        public_signals: [
          { index: 0, name: "nullifier", description: "Unique proof fingerprint (replay protection)" },
          { index: 1, name: "activeRoot", description: "Active credential Merkle root" },
          { index: 2, name: "revokedRoot", description: "Revoked credential Merkle root" },
          { index: 3, name: "maxValue", description: "Permission bitmask / max spend value" },
          { index: 4, name: "sessionExpiry", description: "Session expiry timestamp" },
        ],
        verification_key_url: "/circuit/verification-key",
      },
    ],

    scopes: Object.entries(STANDARD_SCOPES).map(([scope, def]) => ({
      name: scope,
      description: def.description,
      reveals: def.reveals,
      category: def.category,
    })),

    endpoints: {
      verification: "/verify",
      verification_proof: "/external/agents/:agentId/proof",
      circuit_config: "/circuit/config",
      audit: "/audit",
      well_known: "/.well-known/agentix",
    },

    authentication: {
      type: "groth16",
      curve: "bn128",
      proving_scheme: "groth16",
    },

    meta: {
      generated_at: timestamp(),
      network: process.env.NETWORK_NAME || "sepolia",
      chain_id: parseInt(process.env.CHAIN_ID || "84532", 10),
    },
  }

  res.json(config)
})

router.get("/agentix/jwks.json", async (_req, res) => {
  try {
    const jwk = await getPublicJWK()
    res.json({
      keys: [jwk],
    })
  } catch (error) {
    console.error("[jwks] Failed to generate JWK:", error)
    res.status(500).json({ error: "failed to generate JWKS" })
  }
})

router.get("/agentix/oauth-issuer.json", (_req, res) => {
  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`
  res.json({
    issuer: process.env.JWT_ISSUER || "agentix",
    authorization_endpoint: `${baseUrl}/auth/oauth/authorize`,
    token_endpoint: `${baseUrl}/auth/oauth/token`,
    jwks_uri: `${baseUrl}/.well-known/agentix/jwks.json`,
    revocation_endpoint: `${baseUrl}/auth/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "agent:read", "agent:write", "agent:execute"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "email", "name", "org_id", "role"],
  })
})

export default router
