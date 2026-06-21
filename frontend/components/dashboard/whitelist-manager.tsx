'use client'

import { useEffect, useState } from 'react'
import {
    getDashboardWhitelist,
    addWhitelistedParty,
    removeWhitelistedParty,
    type WhitelistedParty,
} from '@/lib/dashboard-api'
import { UserCheck, Plus, Trash2 } from 'lucide-react'

export function WhitelistManager() {
    const [parties, setParties] = useState<WhitelistedParty[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [formData, setFormData] = useState({ address: '', label: '', maxPaymentWei: '' })
    const [error, setError] = useState<string | null>(null)

    const load = () => {
        getDashboardWhitelist()
            .then((res) => setParties(res.data))
            .catch(console.error)
            .finally(() => setLoading(false))
    }

    useEffect(() => { load() }, [])

    const handleAdd = async () => {
        setError(null)
        if (!/^0x[0-9a-fA-F]{40}$/.test(formData.address)) {
            setError('Invalid Ethereum address')
            return
        }

        try {
            await addWhitelistedParty(
                formData.address,
                formData.label || undefined,
                formData.maxPaymentWei || undefined
            )
            setShowForm(false)
            setFormData({ address: '', label: '', maxPaymentWei: '' })
            load()
        } catch (err: any) {
            setError(err.message || 'Failed to add party')
        }
    }

    const handleRemove = async (id: number) => {
        await removeWhitelistedParty(id)
        load()
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-sm text-zinc-500">Loading whitelist...</div>
            </div>
        )
    }

    return (
        <div>
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Whitelisted Parties</h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        Addresses that agents are allowed to send payments to.
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
                >
                    <Plus className="h-4 w-4" />
                    Add Party
                </button>
            </div>

            {showForm && (
                <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
                    <h3 className="font-medium">Add Whitelisted Party</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <div>
                            <label className="text-xs text-zinc-500">Address</label>
                            <input
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="0x..."
                                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-zinc-500">Label</label>
                            <input
                                value={formData.label}
                                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                                placeholder="e.g. Treasury, Vendor"
                                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-zinc-500">Max Payment (wei)</label>
                            <input
                                value={formData.maxPaymentWei}
                                onChange={(e) => setFormData({ ...formData, maxPaymentWei: e.target.value })}
                                placeholder="0 for unlimited"
                                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono"
                            />
                        </div>
                    </div>
                    {error && (
                        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                            {error}
                        </div>
                    )}
                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={handleAdd}
                            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
                        >
                            Add
                        </button>
                        <button
                            onClick={() => setShowForm(false)}
                            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/50">
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Address
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Label
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Max Payment
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Added By
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                        {parties.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">
                                    No whitelisted parties yet.
                                </td>
                            </tr>
                        ) : (
                            parties.map((party) => (
                                <tr key={party.id} className="hover:bg-zinc-900/30">
                                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                                        {party.address.slice(0, 6)}...{party.address.slice(-4)}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-400">{party.label || '—'}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">
                                        {party.max_payment_wei === '0' ? 'Unlimited' : party.max_payment_wei}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-500">{party.set_by_name || '—'}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => handleRemove(party.id)}
                                            className="rounded-lg border border-zinc-700 p-1.5 text-zinc-500 hover:border-red-500/50 hover:text-red-400"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
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
