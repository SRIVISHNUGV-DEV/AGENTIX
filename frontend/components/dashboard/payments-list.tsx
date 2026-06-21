'use client'

import { useEffect, useState } from 'react'
import { getDashboardPayments, type DashboardPayment } from '@/lib/dashboard-api'

export function PaymentsList() {
    const [payments, setPayments] = useState<DashboardPayment[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getDashboardPayments(100)
            .then((res) => setPayments(res.data))
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-sm text-zinc-500">Loading payments...</div>
            </div>
        )
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold">Payments</h1>
            <p className="mt-1 text-sm text-zinc-500">
                Payments made by agents to whitelisted parties.
            </p>

            <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/50">
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Agent
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Action
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Value (wei)
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                TX Hash
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Time
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                        {payments.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">
                                    No payments recorded yet.
                                </td>
                            </tr>
                        ) : (
                            payments.map((payment) => (
                                <tr key={payment.id} className="hover:bg-zinc-900/30">
                                    <td className="px-4 py-3 font-medium">{payment.agent_name}</td>
                                    <td className="px-4 py-3">
                                        <span className="inline-flex items-center rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
                                            {payment.action}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">
                                        {payment.value}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                                        {payment.tx_hash ? (
                                            <a
                                                href={`https://sepolia.basescan.org/tx/${payment.tx_hash}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="hover:text-zinc-300 hover:underline"
                                            >
                                                {payment.tx_hash.slice(0, 10)}...
                                            </a>
                                        ) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right text-xs text-zinc-500">
                                        {new Date(payment.created_at * 1000).toLocaleString()}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
