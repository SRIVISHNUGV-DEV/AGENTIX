'use client'

import { useEffect, useState } from 'react'
import { getDashboardAgents, generateAgentApiKey, type DashboardAgent } from '@/lib/dashboard-api'
import { Shield, Key, Copy, Check } from 'lucide-react'

export function AgentsList() {
    const [agents, setAgents] = useState<DashboardAgent[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
    const [generatedKey, setGeneratedKey] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [generating, setGenerating] = useState(false)

    useEffect(() => {
        getDashboardAgents()
            .then((res) => setAgents(res.data))
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    const handleGenerateKey = async (agentId: number) => {
        setGenerating(true)
        try {
            const res = await generateAgentApiKey(agentId)
            setGeneratedKey(res.apiKey)
            setSelectedAgent(agentId)
        } catch (err) {
            console.error(err)
        } finally {
            setGenerating(false)
        }
    }

    const copyKey = () => {
        if (generatedKey) {
            navigator.clipboard.writeText(generatedKey)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-sm text-zinc-500">Loading agents...</div>
            </div>
        )
    }

    return (
        <div>
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Agents</h1>
                    <p className="mt-1 text-sm text-zinc-500">Manage agent identities and API keys.</p>
                </div>
            </div>

            {generatedKey && (
                <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-emerald-400">API Key Generated</div>
                            <div className="mt-1 font-mono text-xs text-zinc-300 break-all">{generatedKey}</div>
                            <div className="mt-1 text-xs text-zinc-500">
                                Store this key securely — it will not be shown again.
                            </div>
                        </div>
                        <button
                            onClick={copyKey}
                            className="ml-4 flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
                        >
                            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
            )}

            <div className="mt-6 space-y-3">
                {agents.length === 0 ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 py-16 text-center">
                        <Shield className="mx-auto h-8 w-8 text-zinc-600" />
                        <p className="mt-3 text-sm text-zinc-500">No agents registered yet.</p>
                    </div>
                ) : (
                    agents.map((agent) => (
                        <div
                            key={agent.id}
                            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-5 py-4"
                        >
                            <div className="flex items-center gap-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-sm font-medium">
                                    {(agent.agent_name || `A${agent.id}`).slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-medium">{agent.agent_name || `Agent ${agent.id}`}</div>
                                    <div className="text-xs text-zinc-500">
                                        ID: {agent.id} · {agent.session_count} sessions · {agent.api_key_count} API keys
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleGenerateKey(agent.id)}
                                    disabled={generating}
                                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
                                >
                                    <Key className="h-3.5 w-3.5" />
                                    Generate API Key
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
