import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth'
import { DashboardOverview } from '@/components/dashboard/overview'

export default async function DashboardPage() {
    const token = await getAuthToken()
    if (!token) redirect('/login')

    return <DashboardOverview />
}
