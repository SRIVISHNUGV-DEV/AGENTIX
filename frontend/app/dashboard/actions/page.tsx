import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth-server'
import { ActionsLog } from '@/components/dashboard/actions-log'

export default async function ActionsPage() {
    const token = await getAuthToken()
    if (!token) redirect('/login')

    return <ActionsLog />
}
