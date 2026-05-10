import { Agent, Credential, Session, Wallet, Event, Organization, DashboardStats } from './types'

// Mock organization
export const mockOrganization: Organization = {
  id: 'org_1',
  name: 'Acme AI Systems',
  slug: 'acme-ai',
  createdAt: '2024-01-15T10:00:00Z',
}

// Mock credentials
const mockCredentials: Credential[] = [
  {
    id: 'cred_1',
    agentId: 'agent_1',
    credentialType: 'AUTHORIZATION',
    issuedAt: '2024-02-01T08:00:00Z',
    expiresAt: '2025-02-01T08:00:00Z',
    status: 'active',
    proofHash: '0x7f3a5c8d2e9b1a4f6c8e2d9a1b3c5f7a',
    issuer: '0x742d35Cc6634C0532925a3b844Bc1e7595f2d90d',
  },
  {
    id: 'cred_2',
    agentId: 'agent_1',
    credentialType: 'AUTHORIZATION',
    issuedAt: '2024-01-20T14:30:00Z',
    expiresAt: '2024-12-20T14:30:00Z',
    status: 'active',
    proofHash: '0x9e4b7c2f8a5d1c3e6b9f2a4d7c5e8f1a',
    issuer: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  },
  {
    id: 'cred_3',
    agentId: 'agent_2',
    credentialType: 'AUTHORIZATION',
    issuedAt: '2024-02-10T11:15:00Z',
    expiresAt: '2024-08-10T11:15:00Z',
    status: 'expired',
    proofHash: '0x5a2d8f1c4b9e3f6a7d2c8e5b1a4f9c3d',
    issuer: '0x742d35Cc6634C0532925a3b844Bc1e7595f2d90d',
  },
]

// Mock wallets
const mockWallets: Wallet[] = [
  {
    id: 'wallet_1',
    agentId: 'agent_1',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    chain: 'ethereum',
    balance: '125.50',
    createdAt: '2024-01-10T09:00:00Z',
    lastUsed: '2024-03-14T15:30:00Z',
  },
  {
    id: 'wallet_2',
    agentId: 'agent_1',
    address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    chain: 'ethereum',
    balance: '50000.00',
    createdAt: '2024-02-05T10:00:00Z',
    lastUsed: '2024-03-13T08:45:00Z',
  },
  {
    id: 'wallet_3',
    agentId: 'agent_2',
    address: '0xfedcbafedcbafedcbafedcbafedcbafedcbafed',
    chain: 'ethereum',
    balance: '275.25',
    createdAt: '2024-01-20T14:00:00Z',
    lastUsed: '2024-03-15T12:00:00Z',
  },
]

// Mock sessions
const mockSessions: Session[] = [
  {
    id: 'session_1',
    agentId: 'agent_1',
    sessionKey: 'sk_1a2b3c4d5e6f7g8h9i0j',
    txHash: '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
    status: 'active',
    createdAt: '2024-03-10T10:00:00Z',
    expiresAt: '2024-03-17T10:00:00Z',
    credential: mockCredentials[0],
  },
  {
    id: 'session_2',
    agentId: 'agent_1',
    sessionKey: 'sk_9h8i7j6k5l4m3n2o1p0q',
    txHash: '0x1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0',
    status: 'active',
    createdAt: '2024-03-12T15:30:00Z',
    expiresAt: '2024-03-19T15:30:00Z',
    credential: mockCredentials[1],
  },
  {
    id: 'session_3',
    agentId: 'agent_2',
    sessionKey: 'sk_0p1o2n3m4l5k6j7i8h9g',
    txHash: '0x5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4',
    status: 'expired',
    createdAt: '2024-02-20T08:00:00Z',
    expiresAt: '2024-03-06T08:00:00Z',
    credential: mockCredentials[2],
  },
  {
    id: 'session_4',
    agentId: 'agent_3',
    sessionKey: 'sk_2q1p0o9n8m7l6k5j4i3h',
    txHash: '0x9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8',
    status: 'active',
    createdAt: '2024-03-14T12:00:00Z',
    expiresAt: '2024-03-21T12:00:00Z',
    credential: mockCredentials[0],
  },
]

// Mock events
export const mockEvents: Event[] = [
  {
    id: 'event_1',
    agentId: 'agent_1',
    type: 'credential_issued',
    timestamp: '2024-03-15T14:30:00Z',
    contractName: 'CredentialRegistry',
    blockNumber: 19487532,
    txHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    description: 'AUTHORIZATION credential issued',
  },
  {
    id: 'event_2',
    agentId: 'agent_1',
    type: 'session_created',
    timestamp: '2024-03-15T13:00:00Z',
    contractName: 'SessionManager',
    blockNumber: 19487520,
    txHash: '0xb1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0',
    description: 'New session created for credential access',
  },
  {
    id: 'event_3',
    agentId: 'agent_2',
    type: 'wallet_added',
    timestamp: '2024-03-15T11:45:00Z',
    contractName: 'WalletRegistry',
    blockNumber: 19487508,
    txHash: '0x0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d',
    description: 'New wallet registered on Polygon',
  },
  {
    id: 'event_4',
    agentId: 'agent_1',
    type: 'transaction_signed',
    timestamp: '2024-03-15T10:15:00Z',
    contractName: 'TransactionSigner',
    blockNumber: 19487495,
    txHash: '0xd8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7',
    description: 'Transaction signed with agent credentials',
  },
  {
    id: 'event_5',
    agentId: 'agent_3',
    type: 'credential_revoked',
    timestamp: '2024-03-14T16:20:00Z',
    contractName: 'CredentialRegistry',
    blockNumber: 19487412,
    txHash: '0x7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6',
    description: 'DELEGATION credential revoked',
  },
]

// Mock agents
export const mockAgents: Agent[] = [
  {
    id: 'agent_1',
    orgId: 'org_1',
    name: 'Trading Bot Alpha',
    description: 'Automated token swapping and liquidity management agent',
    publicKey: '0x742d35Cc6634C0532925a3b844Bc1e7595f2d90d',
    credentials: [mockCredentials[0], mockCredentials[1]],
    wallets: [mockWallets[0], mockWallets[1]],
    sessions: [mockSessions[0], mockSessions[1]],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-03-15T14:30:00Z',
    lastActive: '2024-03-15T14:30:00Z',
    status: 'active',
  },
  {
    id: 'agent_2',
    orgId: 'org_1',
    name: 'Governance Voter',
    description: 'DAO governance participation and voting automation',
    publicKey: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    credentials: [mockCredentials[2]],
    wallets: [mockWallets[2]],
    sessions: [mockSessions[2]],
    createdAt: '2024-01-20T14:00:00Z',
    updatedAt: '2024-03-14T16:20:00Z',
    lastActive: '2024-03-14T16:20:00Z',
    status: 'active',
  },
  {
    id: 'agent_3',
    orgId: 'org_1',
    name: 'Arbitrage Monitor',
    description: 'Cross-exchange price monitoring and arbitrage execution',
    publicKey: '0x5f7d4b3e2a1c9f8d6e5c4b3a2f1e0d9c8b7a6f5e',
    credentials: [],
    wallets: [],
    sessions: [mockSessions[3]],
    createdAt: '2024-02-05T11:30:00Z',
    updatedAt: '2024-03-15T10:15:00Z',
    lastActive: '2024-03-15T10:15:00Z',
    status: 'inactive',
  },
]

// Mock dashboard stats
export const mockDashboardStats: DashboardStats = {
  totalAgents: 3,
  activeAgents: 2,
  totalSessions: 4,
  totalWallets: 3,
  recentEvents: 5,
}
