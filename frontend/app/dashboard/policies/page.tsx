import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth-server'
import { PoliciesManager } from '@/components/dashboard/policies-manager'

export default async function PoliciesPage() {
    const token = await getAuthToken()
    if (!token) redirect('/login')

    return <PoliciesManager />
}
