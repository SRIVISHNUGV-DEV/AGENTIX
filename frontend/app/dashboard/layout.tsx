import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth-server'
import { DashboardSidebar } from '@/components/dashboard/sidebar'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const token = await getAuthToken()
    if (!token) {
        redirect('/login')
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100">
            <DashboardSidebar>{children}</DashboardSidebar>
        </div>
    )
}
