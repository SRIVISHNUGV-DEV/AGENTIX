import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth-server'
import { AgentsList } from '@/components/dashboard/agents-list'

export default async function AgentsPage() {
    const token = await getAuthToken()
    if (!token) redirect('/login')

    return <AgentsList />
}
