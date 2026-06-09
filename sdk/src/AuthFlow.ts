import axios from "axios"
import { buildPoseidon } from "circomlibjs"

export interface ChallengeResponse {
  challengeId: string
  challenge: string
  agentId: number
  expiresAt: number
  ttlSeconds: number
}

export interface ExchangeRequest {
  challengeId: string
  proof: any
  publicSignals: string[]
  signature: string
  agentId: number
  requestedScopes?: string[]
}

export interface ExchangeResponse {
  valid: boolean
  agentId: number
  orgId: number | null
  publicSignals: {
    nullifier: string
    activeRoot: string
    revokedRoot: string
    permissions: string
    sessionExpiry: string
  }
  scopes: string[]
  missingScopes?: string[]
  error?: string
}

export class AuthFlowClient {
  private api: string

  constructor(api: string) {
    this.api = api
  }

  /**
   * Request a challenge from the relying party for a specific agent.
   */
  async requestChallenge(agentId: number, options?: {
    orgId?: number
    requestedScopes?: string[]
  }): Promise<ChallengeResponse> {
    const res = await axios.post(`${this.api}/auth/challenge`, {
      agentId,
      orgId: options?.orgId,
      requestedScopes: options?.requestedScopes,
    })
    return res.data
  }

  /**
   * Sign a challenge using Poseidon(secret, challenge).
   * This creates a binding between the agent's secret and the challenge,
   * preventing replay of the same proof across different challenges.
   */
  async signChallenge(
    secret: bigint,
    challenge: string
  ): Promise<string> {
    const poseidon = await buildPoseidon()
    const hash = poseidon([secret, BigInt("0x" + challenge)])
    return BigInt(poseidon.F.toString(hash)).toString()
  }

  /**
   * Exchange a proof for verified authorization.
   * The signature is Poseidon(secret, challenge) proving the agent
   * that generated the proof is the same one responding to the challenge.
   */
  async exchange(params: ExchangeRequest): Promise<ExchangeResponse> {
    const res = await axios.post(`${this.api}/auth/exchange`, params)
    return res.data
  }

  /**
   * Full flow: challenge -> sign -> prove -> exchange
   *
   * @param agentId - The agent to authenticate
   * @param secret - The agent's secret
   * @param generateProof - Callback that generates a Groth16 proof
   * @param options - Optional orgId and scopes
   */
  async authenticate(
    agentId: number,
    secret: bigint,
    generateProof: () => Promise<{ proof: any; publicSignals: string[] }>,
    options?: {
      orgId?: number
      requestedScopes?: string[]
    }
  ): Promise<ExchangeResponse> {
    const challenge = await this.requestChallenge(agentId, {
      orgId: options?.orgId,
      requestedScopes: options?.requestedScopes,
    })

    const signature = await this.signChallenge(secret, challenge.challenge)

    const zk = await generateProof()

    return this.exchange({
      challengeId: challenge.challengeId,
      proof: zk.proof,
      publicSignals: zk.publicSignals,
      signature,
      agentId,
      requestedScopes: options?.requestedScopes,
    })
  }

  /**
   * Generate an Authorization header value for API calls.
   */
  async generateAuthHeader(
    agentId: number,
    secret: bigint,
    generateProof: () => Promise<{ proof: any; publicSignals: string[] }>,
    options?: {
      scopes?: string[]
    }
  ): Promise<string> {
    const challenge = await this.requestChallenge(agentId, {
      requestedScopes: options?.scopes,
    })

    const signature = await this.signChallenge(secret, challenge.challenge)

    const zk = await generateProof()

    const payload = {
      proof: zk.proof,
      publicSignals: zk.publicSignals,
      signature,
      agentId,
      scopes: options?.scopes,
      challengeId: challenge.challengeId,
    }

    const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64")
    return `Agentix ${encoded}`
  }
}
