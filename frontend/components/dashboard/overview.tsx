'use client'

import { useEffect, useState } from 'react'
import { Shield, Users, Activity, Wallet } from 'lucide-react'
import { getDashboardStats, getDashboardActions, type DashboardStats, type DashboardAction } from '@/lib/dashboard-api'

export function DashboardOverview() {
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [actions, setActions] = useState<DashboardAction[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        Promise.all([getDashboardStats(), getDashboardActions(10)])
            .then(([statsRes, actionsRes]) => {
                setStats(statsRes.data)
                setActions(actionsRes.data)
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-sm text-zinc-500">Loading dashboard...</div>
            </div>
        )
    }

    const cards = [
        { label: 'Total Agents', value: stats?.totalAgents ?? 0, icon: Users, color: 'text-blue-400' },
        { label: 'Total Sessions', value: stats?.totalSessions ?? 0, icon: Shield, color: 'text-emerald-400' },
        { label: 'Wallets', value: stats?.totalWallets ?? 0, icon: Wallet, color: 'text-purple-400' },
        { label: 'Actions (24h)', value: stats?.recentEvents ?? 0, icon: Activity, color: 'text-amber-400' },
    ]

    return (
        <div>
            <h1 className="text-2xl font-semibold">Overview</h1>
            <p className="mt-1 text-sm text-zinc-500">Your organization at a glance.</p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
                            <Icon className={`h-4 w-4 ${color}`} />
                        </div>
                        <div className="mt-3 text-3xl font-semibold">{value}</div>
                    </div>
                ))}
            </div>

            <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/50">
                <div className="border-b border-zinc-800 px-6 py-4">
                    <h2 className="font-medium">Recent Actions</h2>
                </div>
                {actions.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-zinc-500">
                        No actions recorded yet.
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-800">
                        {actions.map((action) => (
                            <div key={action.id} className="flex items-center justify-between px-6 py-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-xs">
                                        {action.action.slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium">{action.action}</div>
                                        <div className="text-xs text-zinc-500">
                                            {action.resource_type}
                                            {action.resource_id ? ` #${action.resource_id}` : ''}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right text-xs text-zinc-500">
                                    {action.agent_name && (
                                        <div className="text-zinc-400">{action.agent_name}</div>
                                    )}
                                    <div>{new Date(action.created_at * 1000).toLocaleString()}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
