'use client'

import { useEffect, useState } from 'react'
import {
    getDashboardPolicies,
    createDashboardPolicy,
    deleteDashboardPolicy,
    getDashboardAgents,
    type DashboardPolicy,
    type DashboardAgent,
} from '@/lib/dashboard-api'
import { Shield, Plus, Trash2 } from 'lucide-react'

const POLICY_TYPES = [
    { value: 'spending_cap', label: 'Spending Cap', description: 'Maximum wei an agent can spend' },
    { value: 'allowed_action', label: 'Allowed Action', description: 'Restrict agent to specific actions' },
    { value: 'time_window', label: 'Time Window', description: 'Restrict agent to specific hours' },
    { value: 'allowed_recipient', label: 'Allowed Recipient', description: 'Restrict who agent can pay' },
]

export function PoliciesManager() {
    const [policies, setPolicies] = useState<DashboardPolicy[]>([])
    const [agents, setAgents] = useState<DashboardAgent[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [formData, setFormData] = useState({
        agentId: '',
        policyType: 'spending_cap',
        policyValue: '',
    })

    const load = () => {
        Promise.all([getDashboardPolicies(), getDashboardAgents()])
            .then(([pRes, aRes]) => {
                setPolicies(pRes.data)
                setAgents(aRes.data)
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }

    useEffect(() => { load() }, [])

    const handleCreate = async () => {
        let parsedValue: any
        try {
            parsedValue = JSON.parse(formData.policyValue || '{}')
        } catch {
            parsedValue = { value: formData.policyValue }
        }

        await createDashboardPolicy(
            formData.agentId ? parseInt(formData.agentId, 10) : null,
            formData.policyType,
            parsedValue
        )
        setShowForm(false)
        setFormData({ agentId: '', policyType: 'spending_cap', policyValue: '' })
        load()
    }

    const handleDelete = async (id: number) => {
        await deleteDashboardPolicy(id)
        load()
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-sm text-zinc-500">Loading policies...</div>
            </div>
        )
    }

    return (
        <div>
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Policies</h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        Control what agents can do, how much they can spend, and who they can interact with.
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
                >
                    <Plus className="h-4 w-4" />
                    Add Policy
                </button>
            </div>

            {showForm && (
                <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
                    <h3 className="font-medium">New Policy</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <div>
                            <label className="text-xs text-zinc-500">Agent (optional — leave blank for all)</label>
                            <select
                                value={formData.agentId}
                                onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                            >
                                <option value="">All agents</option>
                                {agents.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.agent_name || `Agent ${a.id}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-zinc-500">Policy Type</label>
                            <select
                                value={formData.policyType}
                                onChange={(e) => setFormData({ ...formData, policyType: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                            >
                                {POLICY_TYPES.map((pt) => (
                                    <option key={pt.value} value={pt.value}>
                                        {pt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-zinc-500">Value (JSON)</label>
                            <input
                                value={formData.policyValue}
                                onChange={(e) => setFormData({ ...formData, policyValue: e.target.value })}
                                placeholder='{"maxWei": "1000000000000000000"}'
                                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono"
                            />
                        </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={handleCreate}
                            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
                        >
                            Create
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

            <div className="mt-6 space-y-3">
                {policies.length === 0 ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 py-16 text-center">
                        <Shield className="mx-auto h-8 w-8 text-zinc-600" />
                        <p className="mt-3 text-sm text-zinc-500">No policies configured yet.</p>
                    </div>
                ) : (
                    policies.map((policy) => (
                        <div
                            key={policy.id}
                            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-5 py-4"
                        >
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
                                        {policy.policy_type}
                                    </span>
                                    <span className="text-sm text-zinc-400">
                                        {policy.agent_name || 'All agents'}
                                    </span>
                                    {!policy.is_active && (
                                        <span className="text-xs text-zinc-600">(disabled)</span>
                                    )}
                                </div>
                                <div className="mt-1 font-mono text-xs text-zinc-500">
                                    {JSON.stringify(policy.policy_value)}
                                </div>
                            </div>
                            <button
                                onClick={() => handleDelete(policy.id)}
                                className="rounded-lg border border-zinc-700 p-2 text-zinc-500 hover:border-red-500/50 hover:text-red-400"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
