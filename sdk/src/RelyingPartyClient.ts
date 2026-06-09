import axios from "axios"

export interface RelyingPartyConfig {
  issuer: string
  verificationEndpoint: string
  challengeEndpoint: string
  exchangeEndpoint: string
  wellKnownUrl: string
}

export interface ChallengeRequest {
  agentId: number
  orgId?: number
  requestedScopes?: string[]
}

export interface ChallengeResponse {
  challengeId: string
  challenge: string
  agentId: number
  expiresAt: number
  ttlSeconds: number
}

export interface VerificationResult {
  valid: boolean
  error?: string
  agentId?: number
  orgId?: number | null
  scopes?: string[]
  missingScopes?: string[]
  publicSignals?: {
    nullifier: string
    activeRoot: string
    revokedRoot: string
    permissions: string
    sessionExpiry: string
  }
}

/**
 * RelyingPartyClient — the SDK for apps that need to verify agent proofs.
 *
 * Usage:
 *   const rp = new RelyingPartyClient("https://api.agentix.io")
 *   await rp.discover()   // fetch .well-known/agentix
 *   const challenge = await rp.createChallenge({ agentId: 1 })
 *   // Give challenge to agent, get back proof package
 *   const result = await rp.verifyProofPackage(proofPackage)
 */
export class RelyingPartyClient {
  private api: string
  private config: RelyingPartyConfig | null = null

  constructor(apiOrConfig: string | RelyingPartyConfig) {
    if (typeof apiOrConfig === "string") {
      this.api = apiOrConfig
    } else {
      this.config = apiOrConfig
      this.api = apiOrConfig.issuer
    }
  }

  /**
   * Fetch .well-known/agentix and cache the config.
   * Returns available scopes, circuits, endpoints.
   */
  async discover(): Promise<RelyingPartyConfig> {
    const res = await axios.get(`${this.api}/.well-known/agentix`)
    const wk = res.data
    this.config = {
      issuer: wk.issuer,
      verificationEndpoint: `${this.api}${wk.endpoints.verification}`,
      challengeEndpoint: `${this.api}/auth/challenge`,
      exchangeEndpoint: `${this.api}/auth/exchange`,
      wellKnownUrl: `${this.api}/.well-known/agentix`,
    }
    return this.config
  }

  /**
   * Create a challenge for an agent to prove against.
   * Call this when an agent wants to authenticate to your app.
   */
  async createChallenge(params: ChallengeRequest): Promise<ChallengeResponse> {
    const res = await axios.post(`${this.api}/auth/challenge`, {
      agentId: params.agentId,
      orgId: params.orgId,
      requestedScopes: params.requestedScopes,
    })
    return res.data
  }

  /**
   * Verify a proof package submitted by an agent.
   * This wraps the standard POST /verify call.
   */
  async verifyProofPackage(params: {
    proof: any
    publicSignals: string[]
    requestedScopes?: string[]
  }): Promise<VerificationResult> {
    const res = await axios.post(`${this.api}/verify`, {
      proof: params.proof,
      publicSignals: params.publicSignals,
      requestedScopes: params.requestedScopes,
    })
    return res.data
  }

  /**
   * Complete challenge-response flow.
   * After creating a challenge and the agent responds, call this.
   */
  async completeFlow(params: {
    challengeId: string
    proof: any
    publicSignals: string[]
    signature: string
    agentId: number
    requestedScopes?: string[]
  }): Promise<VerificationResult> {
    const res = await axios.post(`${this.api}/auth/exchange`, {
      challengeId: params.challengeId,
      proof: params.proof,
      publicSignals: params.publicSignals,
      signature: params.signature,
      agentId: params.agentId,
      requestedScopes: params.requestedScopes,
    })
    return res.data
  }

  /**
   * Decode and verify an Agentix Authorization header.
   * Pass the full header value (e.g., "Agentix abc123...").
   */
  async verifyAuthHeader(
    headerValue: string
  ): Promise<VerificationResult> {
    if (!headerValue.startsWith("Agentix ")) {
      return { valid: false, error: "Invalid header format" }
    }
    const token = headerValue.slice("Agentix ".length).trim()

    let decoded: any
    try {
      const buf = Buffer.from(token, "base64")
      decoded = JSON.parse(buf.toString("utf-8"))
    } catch {
      return { valid: false, error: "Invalid base64 encoding" }
    }

    return this.verifyProofPackage({
      proof: decoded.proof,
      publicSignals: decoded.publicSignals,
      requestedScopes: decoded.scopes,
    })
  }

  /**
   * Express middleware generator.
   *
   * Usage:
   *   const agentixGuard = rp.middleware({ requiredScopes: ["agentix:scope:permissions"] })
   *   app.use("/api/protected", agentixGuard, handler)
   */
  middleware(options?: { requiredScopes?: string[] }) {
    return async (req: any, res: any, next: any) => {
      const authHeader = req.headers.authorization
      if (!authHeader) {
        return res.status(401).json({ error: "Authorization header required" })
      }

      const result = await this.verifyAuthHeader(authHeader)

      if (!result.valid) {
        return res.status(401).json({ valid: false, error: result.error })
      }

      if (options?.requiredScopes?.length) {
        const missing = options.requiredScopes.filter(
          (s) => !result.scopes?.includes(s)
        )
        if (missing.length > 0) {
          return res.status(403).json({
            error: "Missing required scopes",
            missingScopes: missing,
          })
        }
      }

      req.agent = {
        agentId: result.agentId,
        scopes: result.scopes,
        publicSignals: result.publicSignals,
      }

      next()
    }
  }

  /**
   * Available scopes from the well-known config (cached after discover()).
   */
  getScopes(): string[] | null {
    return null
  }
}
