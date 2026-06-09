export interface CredentialInput {
  agentId: number
  orgId: number
  permissions: number
  expiry: number
}

export interface AgentRegistrationInput {
  orgId?: number
  orgName?: string
  agentName?: string
  permissions: number
  expiry: number
}

export interface MerkleProof {
  activePathElements: string[]
  activePathIndices: number[]
  activeRoot: string
  revokedSiblings: string[]
  revokedOldKey: string
  revokedOldValue: string
  revokedIsOld0: number
  revokedRoot: string
}

export interface ZKProof {
  proof: any
  publicSignals: string[]
}

export interface SessionRequest {
  agentId: number
  sessionId: string
  sessionKey: string
  maxValue: number
  expiry: number
  proof: any
  publicSignals: string[]
}

export interface SessionResponse {
  success: boolean
  txHash?: string
}

export interface AgentRegistrationResponse {
  success: boolean
  orgId: number
  agentId: number
  next: {
    credentialRegisterUrl?: string
    proofBundleUrl: string
    remoteProofUrl?: string
    sessionSubmitUrl: string
    revokeUrl: string
    walletCreateUrl: string
    circuitConfigUrl?: string
    verificationKeyUrl?: string
  }
}

export interface WalletResponse {
  success: boolean
  txHash: string
  walletAddress: string
  ownerAddress: string
  sessionManagerAddress: string
  implementationAddress?: string
  entryPointAddress?: string
  factorySalt?: string
  walletKind?: string
}

export interface CircuitConfig {
  available: boolean
  hasWasm: boolean
  hasZkey: boolean
  verificationKeyUrl: string
  verificationKey: object | null
  backendProvingAvailable: boolean
}

export interface RemoteProofResponse {
  success: boolean
  proof: {
    nullifier: string
    root: string
    revokedRoot: string
    proof: { a: string[]; b: string[][]; c: string[] }
    publicSignals: [string, string, string, string, string]
  }
  permissionBitmask: number
  expiresAt: number
}

export type ScopeCategory = "identity" | "authorization" | "attestation"

export interface ScopeDefinition {
  name: string
  description: string
  reveals: string[]
  category: ScopeCategory
}

export interface WellKnownConfig {
  issuer: string
  version: string
  description: string
  docs_url: string
  credential_registry: string | null
  session_manager: string | null
  circuits: Array<{
    id: string
    n_public: number
    public_signals: Array<{ index: number; name: string; description: string }>
    verification_key_url: string
  }>
  scopes: ScopeDefinition[]
  endpoints: Record<string, string>
  authentication: {
    type: string
    curve: string
    proving_scheme: string
  }
  meta: {
    generated_at: number
    network: string
    chain_id: number
  }
}

export interface VerifyResponse {
  valid: boolean
  error?: string
  proof?: {
    nullifier: string
    permissions: string
    sessionExpiry: number
    activeRoot: string
    revokedRoot: string
  }
  publicSignals?: Record<string, string>
  requestedScopes?: string[]
  missingScopes?: string[]
}
