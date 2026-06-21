'use client'

import { useEffect, useState } from 'react'
import { getDashboardActions, type DashboardAction } from '@/lib/dashboard-api'

export function ActionsLog() {
    const [actions, setActions] = useState<DashboardAction[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(0)
    const [loading, setLoading] = useState(true)
    const limit = 25

    useEffect(() => {
        setLoading(true)
        getDashboardActions(limit, page * limit)
            .then((res) => {
                setActions(res.data)
                setTotal(res.total)
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [page])

    const totalPages = Math.ceil(total / limit)

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-sm text-zinc-500">Loading actions...</div>
            </div>
        )
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold">Action Log</h1>
            <p className="mt-1 text-sm text-zinc-500">
                All agent and user actions in your organization. {total} total records.
            </p>

            <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/50">
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Action
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Resource
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Agent
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Details
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Time
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                        {actions.map((action) => (
                            <tr key={action.id} className="hover:bg-zinc-900/30">
                                <td className="px-4 py-3">
                                    <span className="inline-flex items-center rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
                                        {action.action}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-zinc-400">
                                    {action.resource_type}
                                    {action.resource_id ? (
                                        <span className="text-zinc-600"> #{action.resource_id}</span>
                                    ) : null}
                                </td>
                                <td className="px-4 py-3 text-zinc-400">
                                    {action.agent_name || '—'}
                                </td>
                                <td className="max-w-xs truncate px-4 py-3 text-xs text-zinc-500">
                                    {action.details || '—'}
                                </td>
                                <td className="px-4 py-3 text-right text-xs text-zinc-500">
                                    {new Date(action.created_at * 1000).toLocaleString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                    <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-30"
                    >
                        Previous
                    </button>
                    <span className="text-xs text-zinc-500">
                        Page {page + 1} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-30"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    )
}
