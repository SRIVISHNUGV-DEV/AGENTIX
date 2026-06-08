import { API_BASE_URL, getAuthHeaders } from './api-base'

/**
 * Session information returned from the backend
 */
export interface SessionInfo {
  id: string
  sessionKeyPublic: string
  sessionIdOnChain: string
  agentWalletAddress: string
  dailySpendLimit: string
  dailyTxLimit: number
  expiresAt: number
  revoked: boolean
  createdAt: number
}

/**
 * Session usage statistics
 */
export interface SessionUsage {
  spendUsed: string
  txCount: number
}

/**
 * Parameters for creating a new lightweight session
 */
export interface CreateSessionParams {
  sessionKeyPublic: string
  dailySpendLimitWei: string
  dailyTxLimit: number
  expiresAtSeconds: number
}

/**
 * API response wrapper
 */
export interface SessionApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Convert ETH string to wei (18 decimals)
 * @param eth - ETH amount as string (e.g., "0.1")
 * @returns Wei amount as string
 */
export function ethToWei(eth: string): string {
  const ethValue = parseFloat(eth)
  if (isNaN(ethValue)) {
    throw new Error('Invalid ETH value')
  }
  // Use BigInt for precision - multiply by 10^18
  const weiMultiplier = BigInt(10 ** 18)
  const weiValue = BigInt(Math.floor(ethValue * 10 ** 18))
  return weiValue.toString()
}

/**
 * Convert wei to ETH string
 * @param wei - Wei amount as string
 * @returns ETH amount as string with decimal places
 */
export function weiToEth(wei: string): string {
  try {
    const weiValue = BigInt(wei)
    const ethValue = Number(weiValue) / 10 ** 18
    return ethValue.toString()
  } catch {
    throw new Error('Invalid wei value')
  }
}

/**
 * Convert days to seconds
 * @param days - Number of days
 * @returns Seconds as number
 */
export function daysToSeconds(days: number): number {
  if (days < 0) {
    throw new Error('Days must be non-negative')
  }
  return days * 24 * 60 * 60
}

/**
 * Fetch helper with auth headers
 */
async function sessionFetch<T>(
  path: string,
  auth: {
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  },
  init?: RequestInit
): Promise<SessionApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...getAuthHeaders(auth),
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text()
      return { success: false, error: text || `Request failed: ${response.status}` }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return { success: false, error: message }
  }
}

/**
 * Create a new lightweight session for an external agent
 * @param agentId - The external agent ID
 * @param params - Session creation parameters
 * @param auth - Wallet signature authentication
 */
export async function createSession(
  agentId: number,
  params: CreateSessionParams,
  auth: {
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  }
): Promise<SessionApiResponse<SessionInfo>> {
  const body = {
    sessionKeyPublic: params.sessionKeyPublic,
    dailySpendLimitWei: params.dailySpendLimitWei,
    dailyTxLimit: params.dailyTxLimit,
    expiresAtSeconds: params.expiresAtSeconds,
  }

  return sessionFetch<SessionInfo>(`/external/${agentId}/sessions`, auth, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Get session details for an external agent
 * @param agentId - The external agent ID
 * @param sessionId - The session ID
 * @param auth - Wallet signature authentication
 */
export async function getSession(
  agentId: number,
  sessionId: string,
  auth: {
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  }
): Promise<SessionApiResponse<SessionInfo>> {
  return sessionFetch<SessionInfo>(`/external/${agentId}/sessions/${sessionId}`, auth)
}

/**
 * Unlock a session to retrieve the private key (secure operation)
 * @param agentId - The external agent ID
 * @param sessionId - The session ID
 * @param auth - Wallet signature authentication
 */
export async function unlockSession(
  agentId: number,
  sessionId: string,
  auth: {
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  }
): Promise<SessionApiResponse<{ sessionKeyPrivate: string }>> {
  return sessionFetch<{ sessionKeyPrivate: string }>(
    `/external/${agentId}/sessions/${sessionId}/unlock`,
    auth,
    { method: 'POST' }
  )
}

/**
 * Revoke a session
 * @param agentId - The external agent ID
 * @param sessionId - The session ID
 * @param auth - Wallet signature authentication
 */
export async function revokeSession(
  agentId: number,
  sessionId: string,
  auth: {
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  }
): Promise<SessionApiResponse<{ revoked: boolean }>> {
  return sessionFetch<{ revoked: boolean }>(
    `/external/${agentId}/sessions/${sessionId}/revoke`,
    auth,
    { method: 'POST' }
  )
}

/**
 * Get active session with usage information
 * This is a read-only operation - no wallet signature required
 * @param agentId - The external agent ID
 * @param orgId - Organization ID
 */
export async function getActiveSession(
  agentId: number,
  orgId: number
): Promise<SessionApiResponse<{ session: SessionInfo; usage: SessionUsage }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/external/${agentId}/sessions/active?orgId=${orgId}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text()
      return { success: false, error: text || `Request failed: ${response.status}` }
    }

    const data = await response.json()

    if (!data.active || !data.session) {
      return { success: false, error: 'No active session' }
    }

    return {
      success: true,
      data: {
        session: {
          id: data.session.sessionId ?? data.session.id,
          sessionKeyPublic: data.session.sessionKeyPublic,
          sessionIdOnChain: data.session.sessionIdOnChain,
          agentWalletAddress: data.session.agentWalletAddress,
          dailySpendLimit: data.session.dailySpendLimit,
          dailyTxLimit: data.session.dailyTxLimit,
          expiresAt: data.session.expiresAt,
          revoked: data.session.revoked ?? false,
          createdAt: data.session.createdAt,
        },
        usage: data.session.usage || { spendUsed: '0', txCount: 0 }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return { success: false, error: message }
  }
}
