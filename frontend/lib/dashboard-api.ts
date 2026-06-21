import { BACKEND_API_BASE } from './api-base'
import { AUTH_COOKIE_NAME } from './auth'

function getClientAuthToken(): string | null {
    if (typeof document === 'undefined') return null
    const match = document.cookie.match(new RegExp(`(?:^|; )${AUTH_COOKIE_NAME}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : null
}

async function dashboardFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const token = getClientAuthToken()
    if (!token) throw new Error('unauthenticated')

    const response = await fetch(`${BACKEND_API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...options?.headers,
        },
        cache: 'no-store',
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Request failed: ${response.status}`)
    }

    return response.json()
}

export interface DashboardStats {
    totalAgents: number
    totalSessions: number
    totalWallets: number
    recentEvents: number
}

export interface DashboardAction {
    id: number
    org_id: number
    user_id: number | null
    action: string
    resource_type: string
    resource_id: string | null
    details: string | null
    ip_address: string | null
    user_agent: string | null
    created_at: number
    agent_name: string | null
}

export interface DashboardPayment {
    id: number
    agent_id: number
    org_id: number
    action: string
    value: string
    tx_hash: string | null
    created_at: number
    agent_name: string
}

export interface DashboardPolicy {
    id: number
    org_id: number
    agent_id: number | null
    policy_type: string
    policy_value: any
    is_active: number
    created_at: number
    agent_name: string | null
}

export interface WhitelistedParty {
    id: number
    org_id: number
    address: string
    label: string | null
    max_payment_wei: string
    set_by: number | null
    set_by_name: string | null
    created_at: number
}

export interface DashboardAgent {
    id: number
    org_id: number
    agent_name: string | null
    managed_secret: string | null
    created_at: number
    session_count: number
    api_key_count: number
}

export async function getDashboardStats() {
    return dashboardFetch<{ success: boolean; data: DashboardStats }>('/dashboard/stats')
}

export async function getDashboardActions(limit = 50, offset = 0, agentId?: number) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (agentId) params.set('agentId', String(agentId))
    return dashboardFetch<{ success: boolean; data: DashboardAction[]; total: number }>(
        `/dashboard/actions?${params}`
    )
}

export async function getDashboardPayments(limit = 50) {
    return dashboardFetch<{ success: boolean; data: DashboardPayment[] }>(
        `/dashboard/payments?limit=${limit}`
    )
}

export async function getDashboardPolicies() {
    return dashboardFetch<{ success: boolean; data: DashboardPolicy[] }>('/dashboard/policies')
}

export async function createDashboardPolicy(agentId: number | null, policyType: string, policyValue: any) {
    return dashboardFetch<{ success: boolean; policyId: number }>('/dashboard/policies', {
        method: 'POST',
        body: JSON.stringify({ agentId, policyType, policyValue }),
    })
}

export async function deleteDashboardPolicy(policyId: number) {
    return dashboardFetch<{ success: boolean }>(`/dashboard/policies/${policyId}`, {
        method: 'DELETE',
    })
}

export async function getDashboardWhitelist() {
    return dashboardFetch<{ success: boolean; data: WhitelistedParty[] }>('/dashboard/whitelist')
}

export async function addWhitelistedParty(address: string, label?: string, maxPaymentWei?: string) {
    return dashboardFetch<{ success: boolean; partyId: number }>('/dashboard/whitelist', {
        method: 'POST',
        body: JSON.stringify({ address, label, maxPaymentWei }),
    })
}

export async function removeWhitelistedParty(partyId: number) {
    return dashboardFetch<{ success: boolean }>(`/dashboard/whitelist/${partyId}`, {
        method: 'DELETE',
    })
}

export async function getDashboardAgents() {
    return dashboardFetch<{ success: boolean; data: DashboardAgent[] }>('/dashboard/agents')
}

export async function generateAgentApiKey(
    agentId: number,
    permissions?: string,
    spendingLimitWei?: string
) {
    return dashboardFetch<{ success: boolean; apiKey: string; prefix: string; message: string }>(
        '/auth/agent/api-key/generate',
        {
            method: 'POST',
            body: JSON.stringify({ agentId, permissions, spendingLimitWei }),
        }
    )
}
