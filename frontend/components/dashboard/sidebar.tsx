'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
    LayoutDashboard,
    Users,
    Activity,
    CreditCard,
    Shield,
    UserCheck,
    Settings,
    LogOut,
} from 'lucide-react'

const navItems = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/dashboard/agents', label: 'Agents', icon: Users },
    { href: '/dashboard/actions', label: 'Actions', icon: Activity },
    { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
    { href: '/dashboard/policies', label: 'Policies', icon: Shield },
    { href: '/dashboard/whitelist', label: 'Whitelist', icon: UserCheck },
]

export function DashboardSidebar({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()

    return (
        <div className="flex min-h-screen">
            <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-800 bg-zinc-950">
                <div className="flex h-14 items-center gap-3 border-b border-zinc-800 px-5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-bold text-black">
                        AX
                    </div>
                    <div>
                        <span className="block text-sm font-semibold">Agentix</span>
                        <span className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                            Dashboard
                        </span>
                    </div>
                </div>

                <nav className="flex-1 space-y-1 p-3">
                    {navItems.map(({ href, label, icon: Icon }) => {
                        const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={cn(
                                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                                    active
                                        ? 'bg-zinc-800 text-white'
                                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                {label}
                            </Link>
                        )
                    })}
                </nav>

                <div className="border-t border-zinc-800 p-3">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition"
                    >
                        <Settings className="h-4 w-4" />
                        Settings
                    </Link>
                    <button
                        onClick={() => {
                            fetch('/api/auth/logout', { method: 'POST' })
                            window.location.href = '/login'
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </button>
                </div>
            </aside>

            <main className="ml-64 flex-1 p-8">{children}</main>
        </div>
    )
}
