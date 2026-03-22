export interface Organization {
  id: string
  name: string
  slug: string
  createdAt: string
}

export interface OrganizationContracts {
  chainId: number
  networkName: string
  verifierAddress: string
  credentialRegistryAddress: string
  sessionManagerAddress: string
  agentWalletFactoryAddress: string
  agentWalletImplementationAddress: string
  deploymentTxHashes: Record<string, string | null> | null
}

export interface OrganizationWorkspace {
  organization: Organization
  contracts: OrganizationContracts | null
}

export type CredentialStatus = "active" | "expired" | "revoked"

export interface Credential {
  id: string
  agentId: string
  credentialType: "AUTHORIZATION"
  permissions?: number
  issuedAt: string
  expiresAt: string
  status: CredentialStatus
  proofHash: string
  issuer: string
}

export interface Wallet {
  id: string
  agentId: string
  address: string
  chain: "ethereum"
  balance: string
  createdAt: string
  lastUsed: string | null
}

export type SessionStatus = "active" | "expired" | "revoked"

export interface Session {
  id: string
  agentId: string
  sessionKey: string
  txHash: string
  status: SessionStatus
  createdAt: string
  expiresAt: string
  credential: Credential | null
}

export type EventType =
  | "credential_issued"
  | "credential_revoked"
  | "session_created"
  | "session_expired"
  | "wallet_added"
  | "transaction_signed"
  | "unknown"

export interface Event {
  id: string
  agentId: string
  type: EventType
  timestamp: string
  contractName: string
  blockNumber: number
  txHash: string
  description: string
}

export interface Agent {
  id: string
  orgId: string
  name: string
  description: string
  publicKey: string
  credentials: Credential[]
  wallets: Wallet[]
  sessions: Session[]
  createdAt: string
  updatedAt: string
  lastActive: string
  status: "active" | "inactive"
}

export interface DashboardStats {
  totalAgents: number
  activeAgents: number
  totalSessions: number
  totalWallets: number
  recentEvents: number
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
}
