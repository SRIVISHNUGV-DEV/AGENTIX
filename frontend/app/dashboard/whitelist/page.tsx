import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth-server'
import { WhitelistManager } from '@/components/dashboard/whitelist-manager'

export default async function WhitelistPage() {
    const token = await getAuthToken()
    if (!token) redirect('/login')

    return <WhitelistManager />
}
