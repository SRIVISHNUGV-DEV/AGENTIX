'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Cpu, Link2, Loader2, ShieldCheck, Wallet, Plus, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWallet } from '@/components/wallet/wallet-provider'
import {
  createExternalAgent,
  listAgentTypes,
  listExternalAgents,
  testAgentConnection,
  type AgentTypeInfo,
  type ExternalAgent,
} from '@/lib/external-agents-api'

type ProviderVisual = {
  logo: string
  eyebrow: string
  summary: string
  endpointLabel: string
}

const providerVisuals: Record<string, ProviderVisual> = {
  openclaude: {
    logo: '/provider-logos/anthropic.svg',
    eyebrow: 'Terminal-native execution',
    summary: 'Good for code, filesystem, and direct operator loop automation.',
    endpointLabel: 'OpenClaude endpoint',
  },
  langchain: {
    logo: '/provider-logos/openai.svg',
    eyebrow: 'Framework orchestration',
    summary: 'Good for tool chains, memory, retrieval, and multi-step reasoning.',
    endpointLabel: 'LangChain runtime URL',
  },
  custom: {
    logo: '/provider-logos/openai.svg',
    eyebrow: 'Custom runtime',
    summary: 'Use your own runtime when the provider does not fit the preset fleet shapes.',
    endpointLabel: 'Custom HTTPS endpoint',
  },
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    // Support endpoint URLs that might not have protocol (e.g., localhost:3001)
    return /^[a-zA-Z0-9\-\.]+(:[0-9]{1,5})?$/.test(url) ||
           /^https?:\/\/.+$/.test(url)
  }
}

function getSelectedOrgIdFromCookie() {
  if (typeof document === 'undefined') return null
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith('ac_org_id='))
    ?.split('=')[1]
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        connected
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
      }`}
    >
      {connected ? <CheckCircle2 className="h-3 w-3" /> : <Loader2 className="h-3 w-3" />}
      {connected ? 'Connected' : 'Pending'}
    </span>
  )
}

export default function AIAgentsPage() {
  const { isConnected, isSepolia } = useWallet()
  const [orgId, setOrgId] = useState<number | null>(null)
  const [agentTypes, setAgentTypes] = useState<AgentTypeInfo[]>([])
  const [fleet, setFleet] = useState<ExternalAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [testingAgentId, setTestingAgentId] = useState<number | null>(null)
  const [selectedType, setSelectedType] = useState<AgentTypeInfo | null>(null)
  const [agentName, setAgentName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Record<number, 'pending' | 'connected' | 'error'>>({})
  const [creationStatus, setCreationStatus] = useState<string | null>(null)

  useEffect(() => {
    setOrgId(getSelectedOrgIdFromCookie())
  }, [])

  useEffect(() => {
    if (orgId) {
      void loadFleet(orgId)
    } else {
      void loadAgentTypes()
    }
  }, [orgId])

  async function loadAgentTypes() {
    setLoading(true)
    try {
      setAgentTypes(await listAgentTypes())
    } catch (e: any) {
      setError(e.message ?? 'Failed to load provider catalog')
    } finally {
      setLoading(false)
    }
  }

  async function loadFleet(activeOrgId: number) {
    setLoading(true)
    try {
      const [types, agents] = await Promise.all([
        listAgentTypes(),
        listExternalAgents(activeOrgId),
      ])
      setAgentTypes(types)
      setFleet(agents)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load agent fleet')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateAgent() {
    if (!orgId || !selectedType || !agentName.trim()) return

    // Validate endpoint if provided
    if (endpoint.trim() && !isValidUrl(endpoint.trim())) {
      setError('Please enter a valid endpoint URL (include http:// or https://)')
      return
    }

    setSubmitting(true)
    setError(null)
    setCreationStatus('Creating agent identity...')

    try {
      // Add auto-provision parameter to automatically create protocol agent
      const created = await createExternalAgent({
        orgId,
        agentType: selectedType.id,
        name: agentName.trim(),
        endpoint: endpoint.trim() || undefined,
        metadata: {
          connectionMode: 'provider-first',
          autoProvision: true
        },
      })

      setCreationStatus('Setting up credentials...')

      // Automatically test the connection if endpoint was provided
      if (endpoint.trim()) {
        setConnectionStatus(prev => ({...prev, [created.id]: 'pending'}))
        try {
          await new Promise(resolve => setTimeout(resolve, 500)) // Small delay
          const testResult = await testAgentConnection(created.id, orgId)
          if (testResult.success) {
            setConnectionStatus(prev => ({...prev, [created.id]: 'connected'}))
          } else {
            setConnectionStatus(prev => ({...prev, [created.id]: 'error'}))
            setError(`Connection test failed: ${testResult.error || 'Unknown error'}`)
          }
        } catch (testError) {
          setConnectionStatus(prev => ({...prev, [created.id]: 'error'}))
          setError(`Connection test failed: ${testError instanceof Error ? testError.message : 'Unknown error'}`)
        }
      }

      setSelectedType(null)
      setAgentName('')
      setEndpoint('')
      await loadFleet(orgId)

      setCreationStatus(null)

      if (created.linkedAgentId) {
        window.location.href = `/agents/${created.linkedAgentId}`
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to connect provider and create agent')
      setCreationStatus(null)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTestConnection(agent: ExternalAgent) {
    if (!orgId) return
    setTestingAgentId(agent.id)
    setConnectionStatus(prev => ({...prev, [agent.id]: 'pending'}))
    setError(null)
    try {
      const result = await testAgentConnection(agent.id, orgId)
      if (!result.success) {
        throw new Error(result.error || 'Connection test failed')
      }
      setConnectionStatus(prev => ({...prev, [agent.id]: 'connected'}))
      await loadFleet(orgId)
    } catch (e: any) {
      setConnectionStatus(prev => ({...prev, [agent.id]: 'error'}))
      setError(`Connection test failed for ${agent.name}: ${e.message ?? 'Unknown error'}`)
    } finally {
      setTestingAgentId(null)
    }
  }

  if (!isConnected || !isSepolia) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h1 className="text-2xl font-semibold">Connect your wallet</h1>
          <p className="mt-4 text-zinc-500 max-w-md mx-auto">
            Connect on Sepolia first. Provider-connect, credential issuance, wallet deployment, and session creation
            are all bound to the active organization workspace.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">Register Agent</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-200">Dashboard</Link>
            <Link href="/agents" className="text-zinc-400 hover:text-zinc-200">Agents</Link>
            <Link href="/credentials" className="text-zinc-400 hover:text-zinc-200">Credentials</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Hero */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <div className="max-w-2xl">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Protocol Fleet Connect</span>
            <h1 className="mt-2 text-3xl font-semibold">Connect any agent runtime to the protocol</h1>
            <p className="mt-4 text-zinc-400 leading-relaxed">
              Register an agent runtime to receive a protocol identity. Every connected runtime becomes a
              protocol-native agent with its own identity, wallet, credential, and session surface.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Active Organization', value: orgId ? `Org ${orgId}` : 'Not selected' },
              { label: 'Supported Runtimes', value: String(agentTypes.length || 0) },
              { label: 'Connected Fleet', value: String(fleet.length || 0) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="text-xs text-zinc-500 uppercase">{label}</div>
                <div className="mt-1 text-xl font-medium">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        ) : null}

        {/* Runtime Catalog */}
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Runtime Catalog</span>
              <h2 className="text-xl font-medium mt-1">Choose a runtime stack</h2>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agentTypes.map((type) => {
                const visual = providerVisuals[type.id] ?? providerVisuals.custom
                return (
                  <div key={type.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 hover:border-zinc-600 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
                        <Image src={visual.logo} alt={type.name} width={24} height={24} className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="font-medium">{type.name}</div>
                        <div className="text-xs text-zinc-500">{visual.eyebrow}</div>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-zinc-400">{visual.summary}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {type.capabilities.slice(0, 3).map((capability) => (
                        <span key={capability} className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400">
                          {capability}
                        </span>
                      ))}
                    </div>
                    <Button
                      disabled={!orgId}
                      className="mt-5 w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                      onClick={() => setSelectedType(type)}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Connect runtime
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Connected Fleet */}
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Connected Fleet</span>
              <h2 className="text-xl font-medium mt-1">Protocol-native agents</h2>
            </div>
          </div>

          {fleet.length === 0 ? (
            <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
              <Bot className="mx-auto h-10 w-10 text-zinc-600" />
              <h3 className="mt-4 text-lg font-medium text-zinc-300">No connected agents yet</h3>
              <p className="mt-2 text-sm text-zinc-500 max-w-md mx-auto">
                Connect a runtime above. Agentix will create the protocol identity.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {fleet.map((agent) => {
                const visual = providerVisuals[agent.agentType] ?? providerVisuals.custom
                return (
                  <div key={agent.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
                          <Image src={visual.logo} alt={agent.agentType} width={24} height={24} className="h-6 w-6" />
                        </div>
                        <div>
                          <h3 className="font-medium text-zinc-200">{agent.name}</h3>
                          <p className="text-xs text-zinc-500">{agent.agentType}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill connected={Boolean(agent.linkedAgentId)} />
                        {connectionStatus[agent.id] === 'pending' && (
                          <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                        )}
                        {connectionStatus[agent.id] === 'error' && (
                          <AlertCircle className="h-3 w-3 text-red-400" />
                        )}
                        {connectionStatus[agent.id] === 'connected' && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded bg-zinc-800/50 p-2 text-center">
                        <div className="text-sm font-medium">{agent.linkedAgentId ? `#${agent.linkedAgentId}` : '—'}</div>
                        <div className="text-xs text-zinc-500">ID</div>
                      </div>
                      <div className="rounded bg-zinc-800/50 p-2 text-center">
                        <div className="text-sm font-medium">——</div>
                        <div className="text-xs text-zinc-500">Wallet</div>
                      </div>
                      <div className="rounded bg-zinc-800/50 p-2 text-center">
                        <div className="text-sm font-medium">Pending</div>
                        <div className="text-xs text-zinc-500">Proof</div>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-zinc-700 bg-transparent hover:bg-zinc-800"
                        disabled={testingAgentId === agent.id || !orgId}
                        onClick={() => handleTestConnection(agent)}
                      >
                        {testingAgentId === agent.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Test'
                        )}
                      </Button>
                      {agent.linkedAgentId ? (
                        <Button asChild size="sm" className="flex-1 bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
                          <Link href={`/agents/${agent.linkedAgentId}`}>Open Agent</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Connect Dialog */}
        <Dialog open={Boolean(selectedType)} onOpenChange={(open) => !open && setSelectedType(null)}>
          <DialogContent className="max-w-lg border-zinc-700 bg-zinc-900 text-zinc-100">
            <DialogHeader>
              <DialogTitle className="text-xl">Connect runtime</DialogTitle>
              <DialogDescription className="text-zinc-400">
                Create a protocol agent identity for this runtime.
              </DialogDescription>
            </DialogHeader>

            {selectedType ? (
              <div className="space-y-5 py-4">
                <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/50 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800">
                    <Image
                      src={(providerVisuals[selectedType.id] ?? providerVisuals.custom).logo}
                      alt={selectedType.name}
                      width={28}
                      height={28}
                      className="h-7 w-7"
                    />
                  </div>
                  <div>
                    <div className="font-medium">{selectedType.name}</div>
                    <div className="text-sm text-zinc-500">
                      {(providerVisuals[selectedType.id] ?? providerVisuals.custom).summary}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-zinc-300">Agent name</Label>
                  <Input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g., Treasury Manager"
                    className="border-zinc-700 bg-zinc-800"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-zinc-300">Endpoint</Label>
                  <Input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://runtime.example.com"
                    className="border-zinc-700 bg-zinc-800"
                  />
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
                  <div className="text-xs text-zinc-500 uppercase mb-3">Flow</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Cpu className="h-4 w-4 text-zinc-500" />
                      Connect provider
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Bot className="h-4 w-4 text-zinc-500" />
                      Create identity
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <ShieldCheck className="h-4 w-4 text-zinc-500" />
                      Issue credential
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Wallet className="h-4 w-4 text-zinc-500" />
                      Deploy wallet
                    </div>
                  </div>
                </div>

                {/* Creation Status Display */}
                {creationStatus && (
                  <div className="mb-4 p-3 rounded-lg border border-zinc-700 bg-zinc-800/30 text-sm text-zinc-300">
                    <div className="flex items-center gap-2">
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      )}
                      {creationStatus}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setSelectedType(null)} className="border-zinc-700 bg-transparent">
                    Cancel
                  </Button>
                  <Button
                    disabled={submitting || !orgId || !agentName.trim()}
                    onClick={handleCreateAgent}
                    className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  >
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                    Connect and create
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  )
}
