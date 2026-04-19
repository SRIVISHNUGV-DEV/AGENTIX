import {
  Agent,
  ApiResponse,
  Credential,
  DashboardStats,
  Event,
  EventType,
  Organization,
  OrganizationWorkspace,
  Session,
  SessionStatus,
  Wallet,
} from "./types"

const API_BASE_URL =
  process.env.AGENT_CREDENTIALS_API_URL ??
  process.env.NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL ??
  "http://127.0.0.1:3000"

type BackendAgent = {
  id: number
  org_id: number
  agent_name: string | null
  created_at: number
}

type BackendCredential = {
  id: number
  agent_id: number
  org_id: number
  permissions: number
  expiry: number
  commitment: string
  created_at: number
}

type BackendWallet = {
  id: number
  agent_id: number | null
  owner_address: string
  wallet_address: string
  session_manager_address: string
  implementation_address: string | null
  entry_point_address: string | null
  factory_salt: string | null
  wallet_kind: string | null
  created_at: number
}

type BackendSession = {
  id: number
  agent_id: number
  session_id: string | null
  tx_hash: string | null
  created_at: number
  public_signals: string
}

type BackendEvent = {
  id: number
  contract_name: string
  event_name: string
  tx_hash: string
  block_number: number
  session_id: string | null
  wallet_address: string | null
  payload: string
  created_at: number
}

type AgentState = {
  agent: BackendAgent | null
  credential: BackendCredential | null
  wallets: BackendWallet[]
  sessions: BackendSession[]
  events: BackendEvent[]
  contracts?: any
}

type BackendOrganization = {
  id: number
  name: string
  owner_wallet_address?: string | null
  created_at: number
}

type BackendOrganizationContracts = {
  chain_id: number
  network_name: string
  verifier_address: string
  credential_registry_address: string
  session_manager_address: string
  agent_wallet_factory_address: string
  agent_wallet_implementation_address: string
  entry_point_address: string
  deployment_tx_hashes: string | null
}

type BackendOrganizationState = {
  organization: BackendOrganization
  contracts: BackendOrganizationContracts | null
  agents: BackendAgent[]
  wallets: BackendWallet[]
  sessions: BackendSession[]
  events: BackendEvent[]
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function unixToIso(value?: number | null) {
  if (!value) {
    return new Date(0).toISOString()
  }

  return new Date(value * 1000).toISOString()
}

function parsePublicSignals(serialized: string | null | undefined) {
  if (!serialized) {
    return null
  }

  try {
    return JSON.parse(serialized) as {
      sessionId?: string
      sessionKey?: string
      maxValue?: number
      expiry?: number
      publicSignals?: string[]
    }
  } catch {
    return null
  }
}

function mapCredential(credential: BackendCredential | null): Credential[] {
  if (!credential) {
    return []
  }

  const now = Math.floor(Date.now() / 1000)
  const status = credential.expiry > now ? "active" : "expired"

  return [
    {
      id: credential.id.toString(),
      agentId: credential.agent_id.toString(),
      credentialType: "AUTHORIZATION",
      permissions: credential.permissions,
      issuedAt: unixToIso(credential.created_at),
      expiresAt: unixToIso(credential.expiry),
      status,
      proofHash: credential.commitment,
      issuer: `org-${credential.org_id}`,
    },
  ]
}

function mapWallet(wallet: BackendWallet): Wallet {
  return {
    id: wallet.id.toString(),
    agentId: (wallet.agent_id ?? "").toString(),
    address: wallet.wallet_address,
    ownerAddress: wallet.owner_address,
    sessionManagerAddress: wallet.session_manager_address,
    implementationAddress: wallet.implementation_address,
    entryPointAddress: wallet.entry_point_address,
    factorySalt: wallet.factory_salt,
    walletKind: wallet.wallet_kind ?? "erc4337",
    chain: "ethereum",
    balance: "Sepolia",
    createdAt: unixToIso(wallet.created_at),
    lastUsed: null,
  }
}

function inferSessionStatus(expiry: number | undefined): SessionStatus {
  if (!expiry) {
    return "active"
  }

  return expiry > Math.floor(Date.now() / 1000) ? "active" : "expired"
}

function mapSessions(
  sessions: BackendSession[],
  credential: Credential | null
): Session[] {
  return sessions.map((session) => {
    const parsed = parsePublicSignals(session.public_signals)
    const expiry = parsed?.expiry

    return {
      id: session.session_id ?? session.id.toString(),
      agentId: session.agent_id.toString(),
      sessionKey: parsed?.sessionKey ?? "unknown",
      txHash: session.tx_hash ?? "pending",
      status: inferSessionStatus(expiry),
      createdAt: unixToIso(session.created_at),
      expiresAt: unixToIso(expiry),
      credential,
    }
  })
}

function mapEventType(event: BackendEvent): EventType {
  if (event.contract_name === "SessionManager" && event.event_name === "SessionCreated") {
    return "session_created"
  }

  if (event.contract_name === "SessionManager" && event.event_name === "SessionRevoked") {
    return "session_expired"
  }

  if (event.contract_name === "AgentWalletFactory" && event.event_name === "WalletCreated") {
    return "wallet_added"
  }

  return "unknown"
}

function mapEventDescription(event: BackendEvent) {
  switch (`${event.contract_name}:${event.event_name}`) {
    case "SessionManager:SessionCreated":
      return "Session created on-chain"
    case "SessionManager:SessionRevoked":
      return "Session revoked"
    case "AgentWalletFactory:WalletCreated":
      return "Agent wallet deployed"
    case "AgentWallet:WalletInitialized":
      return "Agent wallet initialized"
    default:
      return `${event.contract_name} ${event.event_name}`
  }
}

function mapEvents(events: BackendEvent[], agentId: string): Event[] {
  return events.map((event) => ({
    id: event.id.toString(),
    agentId,
    type: mapEventType(event),
    timestamp: unixToIso(event.created_at),
    contractName: event.contract_name,
    blockNumber: event.block_number,
    txHash: event.tx_hash,
    description: mapEventDescription(event),
  }))
}

function buildAgent(state: AgentState): Agent | null {
  if (!state.agent) {
    return null
  }

  const credentials = mapCredential(state.credential)
  const wallets = state.wallets.map(mapWallet)
  const sessions = mapSessions(state.sessions, credentials[0] ?? null)
  const latestActivity = [
    state.agent.created_at,
    state.credential?.created_at ?? 0,
    ...state.wallets.map((wallet) => wallet.created_at),
    ...state.sessions.map((session) => session.created_at),
    ...state.events.map((event) => event.created_at),
  ].reduce((max, value) => Math.max(max, value), 0)

  return {
    id: state.agent.id.toString(),
    orgId: state.agent.org_id.toString(),
    name: state.agent.agent_name ?? `Agent ${state.agent.id}`,
    description: "Zero-knowledge enabled autonomous agent with on-chain session controls.",
    publicKey:
      state.wallets[0]?.owner_address ??
      state.sessions[0]?.session_id ??
      `agent-${state.agent.id}`,
    credentials,
    wallets,
    sessions,
    createdAt: unixToIso(state.agent.created_at),
    updatedAt: unixToIso(latestActivity || state.agent.created_at),
    lastActive: unixToIso(latestActivity || state.agent.created_at),
    status: credentials.some((credential) => credential.status === "active") ? "active" : "inactive",
  }
}

export async function getOrganization(): Promise<ApiResponse<Organization>> {
  const organizations = await apiFetch<Array<{ id: number; name: string; created_at: number }>>("/orgs")
  const org = organizations[organizations.length - 1] ?? {
    id: 0,
    name: "Agentix",
    created_at: Math.floor(Date.now() / 1000),
  }

  return {
    success: true,
    data: {
      id: org.id.toString(),
      name: org.name,
      slug: org.name.toLowerCase().replace(/\s+/g, "-"),
      createdAt: unixToIso(org.created_at),
    },
  }
}

export async function listOrganizations(): Promise<ApiResponse<Organization[]>> {
  const organizations = await apiFetch<BackendOrganization[]>("/orgs")

  return {
    success: true,
    data: organizations.map((org) => ({
      id: org.id.toString(),
      name: org.name,
      slug: org.name.toLowerCase().replace(/\s+/g, "-"),
      createdAt: unixToIso(org.created_at),
    })),
  }
}

async function getOrganizationState(orgId: string) {
  return apiFetch<BackendOrganizationState>(`/orgs/${orgId}/state`)
}

export async function getOrganizationWorkspace(orgId?: string | null): Promise<ApiResponse<OrganizationWorkspace>> {
  const organizations = await apiFetch<BackendOrganization[]>("/orgs")
  const org =
    (orgId ? organizations.find((entry) => entry.id.toString() === orgId) : null) ??
    organizations[organizations.length - 1]

  if (!org) {
    const fallback = await getOrganization()
    return {
      success: true,
      data: {
        organization: fallback.data,
        contracts: null,
      },
    }
  }

  const state = await getOrganizationState(org.id.toString())
  return {
    success: true,
    data: {
      organization: {
        id: org.id.toString(),
        name: org.name,
        slug: org.name.toLowerCase().replace(/\s+/g, "-"),
        createdAt: unixToIso(org.created_at),
      },
      contracts: state.contracts
        ? {
            chainId: state.contracts.chain_id,
            networkName: state.contracts.network_name,
            verifierAddress: state.contracts.verifier_address,
            credentialRegistryAddress: state.contracts.credential_registry_address,
            sessionManagerAddress: state.contracts.session_manager_address,
            agentWalletFactoryAddress: state.contracts.agent_wallet_factory_address,
            agentWalletImplementationAddress: state.contracts.agent_wallet_implementation_address,
            entryPointAddress: state.contracts.entry_point_address,
            deploymentTxHashes: state.contracts.deployment_tx_hashes
              ? JSON.parse(state.contracts.deployment_tx_hashes)
              : null,
          }
        : null,
    },
  }
}

export async function getAgents(orgId?: string | null): Promise<ApiResponse<Agent[]>> {
  const agents = orgId
    ? (await getOrganizationState(orgId)).agents
    : await apiFetch<BackendAgent[]>("/agents")
  const states = await Promise.all(
    agents.map((agent) => apiFetch<AgentState>(`/v1/agents/${agent.id}/state`))
  )

  return {
    success: true,
    data: states
      .map((state) => buildAgent(state))
      .filter((agent): agent is Agent => Boolean(agent)),
  }
}

export async function getAgent(id: string): Promise<ApiResponse<Agent | null>> {
  try {
    const state = await apiFetch<AgentState>(`/v1/agents/${id}/state`)
    return {
      success: true,
      data: buildAgent(state),
    }
  } catch (error:any) {
    return {
      success: false,
      data: null,
      error: error.message,
    }
  }
}

export async function getCredentials(): Promise<ApiResponse<Credential[]>> {
  const agents = await getAgents()
  return {
    success: true,
    data: agents.data.flatMap((agent) => agent.credentials),
  }
}

export async function getCredentialsByAgent(agentId: string): Promise<ApiResponse<Credential[]>> {
  const agent = await getAgent(agentId)
  return {
    success: agent.success,
    data: agent.data?.credentials ?? [],
    error: agent.error,
  }
}

export async function getWallets(): Promise<ApiResponse<Wallet[]>> {
  const wallets = await apiFetch<BackendWallet[]>("/wallets")
  return {
    success: true,
    data: wallets.map(mapWallet),
  }
}

export async function getWalletsByAgent(agentId: string): Promise<ApiResponse<Wallet[]>> {
  const agent = await getAgent(agentId)
  return {
    success: agent.success,
    data: agent.data?.wallets ?? [],
    error: agent.error,
  }
}

export async function getSessions(orgId?: string | null): Promise<ApiResponse<Session[]>> {
  const sessions = orgId
    ? (await getOrganizationState(orgId)).sessions
    : await apiFetch<BackendSession[]>("/sessions")
  const credentials = orgId
    ? (await getOrganizationState(orgId)).agents.length
      ? (await Promise.all(
          (await getOrganizationState(orgId)).agents.map((agent) =>
            apiFetch<AgentState>(`/v1/agents/${agent.id}/state`)
          )
        )).flatMap((state) => (state.credential ? [state.credential] : []))
      : []
    : await apiFetch<BackendCredential[]>("/credentials")
  const credentialByAgent = new Map(
    credentials.map((credential) => [credential.agent_id.toString(), mapCredential(credential)[0]])
  )

  return {
    success: true,
    data: mapSessions(
      sessions,
      null
    ).map((session) => ({
      ...session,
      credential: credentialByAgent.get(session.agentId) ?? null,
    })),
  }
}

export async function getSessionsByAgent(agentId: string): Promise<ApiResponse<Session[]>> {
  const agent = await getAgent(agentId)
  return {
    success: agent.success,
    data: agent.data?.sessions ?? [],
    error: agent.error,
  }
}

export async function getEvents(orgId?: string | null): Promise<ApiResponse<Event[]>> {
  const events = orgId
    ? (await getOrganizationState(orgId)).events
    : await apiFetch<BackendEvent[]>("/events?limit=100")
  return {
    success: true,
    data: mapEvents(events, ""),
  }
}

export async function getEventsByAgent(agentId: string): Promise<ApiResponse<Event[]>> {
  const agent = await getAgent(agentId)
  const state = await apiFetch<AgentState>(`/v1/agents/${agentId}/state`)

  return {
    success: agent.success,
    data: mapEvents(state.events ?? [], agentId),
    error: agent.error,
  }
}

export async function getDashboardStats(orgId?: string | null): Promise<ApiResponse<DashboardStats>> {
  const [agentsRes, sessionsRes, walletsRes, eventsRes] = await Promise.all([
    getAgents(orgId),
    getSessions(orgId),
    orgId
      ? Promise.resolve({
          success: true,
          data: (await getAgents(orgId)).data.flatMap((agent) => agent.wallets),
        })
      : getWallets(),
    getEvents(orgId),
  ])

  return {
    success: true,
    data: {
      totalAgents: agentsRes.data.length,
      activeAgents: agentsRes.data.filter((agent) => agent.status === "active").length,
      totalSessions: sessionsRes.data.length,
      totalWallets: walletsRes.data.length,
      recentEvents: eventsRes.data.length,
    },
  }
}
