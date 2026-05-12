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
    sessionSubmitUrl: string
    revokeUrl: string
    walletCreateUrl: string
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
