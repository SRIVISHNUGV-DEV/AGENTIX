'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { DepthOrbit } from '@/components/effects/depth-orbit'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWallet } from '@/components/wallet/wallet-provider'
import {
  createExternalAgent,
  listAgentTypes,
  listExternalAgents,
  testAgentConnection,
  type AgentTypeInfo,
  type ExternalAgent,
} from '@/lib/external-agents-api'
import {
  Bot,
  CheckCircle2,
  Cpu,
  Link2,
  Loader2,
  Network,
  Orbit,
  ShieldCheck,
  Wallet,
} from 'lucide-react'

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
  claude_code: {
    logo: '/provider-logos/anthropic.svg',
    eyebrow: 'Code-first agents',
    summary: 'Good for repository-native execution and structured engineering tasks.',
    endpointLabel: 'Claude Code bridge URL',
  },
  crewai: {
    logo: '/provider-logos/google.svg',
    eyebrow: 'Role-based crews',
    summary: 'Good for multi-agent delegation with explicit responsibilities.',
    endpointLabel: 'CrewAI runtime URL',
  },
  llama_index: {
    logo: '/provider-logos/cohere.svg',
    eyebrow: 'Knowledge-heavy routing',
    summary: 'Good for retrieval, indexing, and document-grounded operator agents.',
    endpointLabel: 'LlamaIndex endpoint',
  },
  autogen: {
    logo: '/provider-logos/xai.svg',
    eyebrow: 'Conversation swarms',
    summary: 'Good for agent conversations and autonomous delegation loops.',
    endpointLabel: 'AutoGen coordinator URL',
  },
  smolagents: {
    logo: '/provider-logos/deepseek.svg',
    eyebrow: 'Lean tool execution',
    summary: 'Good for lightweight, cost-aware operators with direct tool use.',
    endpointLabel: 'SmolAgents runtime URL',
  },
  custom: {
    logo: '/provider-logos/openai.svg',
    eyebrow: 'Custom runtime',
    summary: 'Use your own runtime when the provider does not fit the preset fleet shapes.',
    endpointLabel: 'Custom HTTPS endpoint',
  },
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
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
        connected
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
          : 'border-white/10 bg-white/[0.04] text-foreground/55'
      }`}
    >
      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Orbit className="h-3.5 w-3.5" />}
      {connected ? 'Connected' : 'Pending credential + wallet'}
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
  const [modelName, setModelName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

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

    setSubmitting(true)
    setError(null)
    try {
      const created = await createExternalAgent({
        orgId,
        agentType: selectedType.id,
        name: agentName.trim(),
        endpoint: endpoint.trim() || undefined,
        metadata: {
          modelName: modelName.trim() || null,
          systemPrompt: systemPrompt.trim() || null,
          connectionMode: 'provider-first',
        },
      })

      setSelectedType(null)
      setAgentName('')
      setEndpoint('')
      setModelName('')
      setSystemPrompt('')
      await loadFleet(orgId)

      if (created.linkedAgentId) {
        window.location.href = `/agents/${created.linkedAgentId}`
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to connect provider and create agent')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTestConnection(agent: ExternalAgent) {
    if (!orgId) return
    setTestingAgentId(agent.id)
    setError(null)
    try {
      const result = await testAgentConnection(agent.id, orgId)
      if (!result.success) {
        throw new Error(result.error || 'Connection test failed')
      }
      await loadFleet(orgId)
    } catch (e: any) {
      setError(e.message ?? 'Connection test failed')
    } finally {
      setTestingAgentId(null)
    }
  }

  const cards = useMemo(
    () =>
      agentTypes.map((type) => ({
        type,
        visual: providerVisuals[type.id] ?? {
          logo: '/provider-logos/openai.svg',
          eyebrow: 'Agent runtime',
          summary: 'Connect this runtime to bind it into your organization trust fabric.',
          endpointLabel: 'Runtime endpoint',
        },
      })),
    [agentTypes]
  )

  if (!isConnected || !isSepolia) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <GridBackdrop />
        <Header />
        <main className="relative z-10 shell py-16 sm:py-24">
          <div className="hero-panel mx-auto max-w-2xl p-8 text-center">
            <h1 className="text-3xl font-semibold">Connect your wallet</h1>
            <p className="mt-4 text-foreground/60">
              Connect on Sepolia first. Provider-connect, credential issuance, wallet deployment, and session creation
              are all bound to the active organization workspace.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 shell py-16 sm:py-20">
        <section className="hero-panel depth-shell p-7 sm:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.05fr_0.95fr] xl:items-center">
            <div>
              <span className="section-kicker">Protocol Fleet Connect</span>
              <h1 className="section-title max-w-5xl text-4xl sm:text-6xl">
                Connect any agent runtime, mint a protocol identity, then let it operate with bounded access.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-foreground/64">
                An organization registers once. Agentix maintains the org-scoped credential tree and revocation tree.
                Every connected runtime becomes a real protocol agent with its own identity, wallet, credential, and
                session surface. Proofs expose authorization roots and limits, not the organization label in the proving
                payload.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ['Active organization', orgId ? `Org ${orgId}` : 'Not selected'],
                  ['Supported runtimes', String(agentTypes.length || 0)],
                  ['Connected fleet', String(fleet.length || 0)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[1.4rem] border border-white/10 bg-background/55 p-4 backdrop-blur-xl">
                    <div className="micro-label">{label}</div>
                    <div className="mt-2 text-xl font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              {!orgId ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-card/80 px-4 py-3 text-sm text-foreground/70 backdrop-blur-xl">
                  Select or create an organization first, then return here to connect providers and spawn your fleet.
                  <Link href="/dashboard" className="ml-2 underline decoration-white/20 underline-offset-4">
                    Open workspace
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="lux-panel overflow-hidden p-6">
              <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                <div>
                  <div className="micro-label">Money and access model</div>
                  <h2 className="mt-3 text-2xl font-semibold">Provider decides. Wallet holds value. Session grants scope.</h2>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-foreground/60">
                    <p>1. Connect a provider runtime and create a protocol agent identity for the active org.</p>
                    <p>2. Issue a credential into the org tree. Revocation later removes future authority cleanly.</p>
                    <p>3. Deploy an individual smart wallet for that agent. Treasury lives there, not in the provider.</p>
                    <p>4. Open bounded sessions with explicit spend ceilings and expiry windows before execution.</p>
                  </div>
                </div>
                <div className="relative">
                  <div className="satin-grid absolute inset-0" />
                  <DepthOrbit compact />
                </div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <section className="mt-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <div className="micro-label">Runtime catalog</div>
              <h2 className="mt-2 text-2xl font-semibold">Choose the runtime stack your organization wants to trust.</h2>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-foreground/40" />
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {cards.map(({ type, visual }) => (
                <SpotlightCard key={type.id} className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-white/10 bg-background/80 backdrop-blur-xl">
                        <Image src={visual.logo} alt={type.name} width={34} height={34} className="h-8 w-8" />
                      </div>
                      <div>
                        <div className="text-lg font-semibold">{type.name}</div>
                        <div className="text-xs uppercase tracking-[0.18em] text-foreground/45">{visual.eyebrow}</div>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-foreground/62">{visual.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {type.capabilities.slice(0, 3).map((capability) => (
                      <span key={capability} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-foreground/60">
                        {capability}
                      </span>
                    ))}
                  </div>
                  <Button
                    disabled={!orgId}
                    className="mt-6 w-full rounded-full bg-white text-background hover:bg-white/90"
                    onClick={() => setSelectedType(type)}
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Connect runtime
                  </Button>
                </SpotlightCard>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <div className="micro-label">Connected fleet</div>
              <h2 className="mt-2 text-2xl font-semibold">Every connected runtime becomes a protocol-native agent.</h2>
            </div>
          </div>

          {fleet.length === 0 ? (
            <SpotlightCard className="p-12 text-center">
              <Bot className="mx-auto h-12 w-12 text-foreground/30" />
              <h2 className="mt-4 text-xl font-semibold">No connected agents yet</h2>
              <p className="mt-2 text-foreground/60">
                Connect a runtime above. Agentix will create the protocol identity that later receives credential,
                wallet, treasury funding, and sessions.
              </p>
            </SpotlightCard>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {fleet.map((agent) => {
                const visual = providerVisuals[agent.agentType] ?? providerVisuals.custom
                return (
                  <SpotlightCard key={agent.id} className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[1.15rem] border border-white/10 bg-background/80 backdrop-blur-xl">
                          <Image src={visual.logo} alt={agent.agentType} width={28} height={28} className="h-7 w-7" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{agent.name}</h3>
                          <p className="text-xs text-foreground/50">{agent.agentType}</p>
                        </div>
                      </div>
                      <StatusPill connected={Boolean(agent.linkedAgentId)} />
                    </div>

                    {agent.endpoint ? (
                      <p className="mt-4 truncate text-sm text-foreground/58">{agent.endpoint}</p>
                    ) : null}

                    <div className="mt-5 grid grid-cols-3 gap-3">
                      <div className="metric-tile p-3 text-center">
                        <div className="micro-label">Identity</div>
                        <div className="mt-1 text-sm font-semibold">{agent.linkedAgentId ? `#${agent.linkedAgentId}` : 'Pending'}</div>
                      </div>
                      <div className="metric-tile p-3 text-center">
                        <div className="micro-label">Wallet</div>
                        <div className="mt-1 text-sm font-semibold">Per agent</div>
                      </div>
                      <div className="metric-tile p-3 text-center">
                        <div className="micro-label">Proof</div>
                        <div className="mt-1 text-sm font-semibold">Org-rooted</div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-start gap-3 text-sm text-foreground/62">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          This runtime can propose actions, but execution still requires the protocol wallet, credential,
                          and session path.
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-full"
                        disabled={testingAgentId === agent.id || !orgId}
                        onClick={() => handleTestConnection(agent)}
                      >
                        {testingAgentId === agent.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Network className="mr-2 h-4 w-4" />
                            Test
                          </>
                        )}
                      </Button>
                      {agent.linkedAgentId ? (
                        <Button asChild className="flex-1 rounded-full">
                          <Link href={`/agents/${agent.linkedAgentId}`}>Open protocol agent</Link>
                        </Button>
                      ) : null}
                    </div>
                  </SpotlightCard>
                )
              })}
            </div>
          )}
        </section>

        <Dialog open={Boolean(selectedType)} onOpenChange={(open) => !open && setSelectedType(null)}>
          <DialogContent className="max-w-2xl border-white/10 bg-[#090909] text-foreground">
            <DialogHeader>
              <DialogTitle className="text-2xl">Connect runtime and create protocol agent</DialogTitle>
              <DialogDescription>
                This creates the provider connection and the protocol-native agent identity together. After that, you
                issue credentials, deploy the wallet, fund it, and open sessions from the main agent page.
              </DialogDescription>
            </DialogHeader>

            {selectedType ? (
              <div className="space-y-5 py-4">
                <div className="flex items-center gap-4 rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-white/10 bg-background/80">
                    <Image
                      src={(providerVisuals[selectedType.id] ?? providerVisuals.custom).logo}
                      alt={selectedType.name}
                      width={36}
                      height={36}
                      className="h-9 w-9"
                    />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{selectedType.name}</div>
                    <div className="text-sm text-foreground/58">
                      {(providerVisuals[selectedType.id] ?? providerVisuals.custom).summary}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Protocol agent name</Label>
                    <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Treasury swarm lead" />
                  </div>
                  <div className="space-y-2">
                    <Label>Model or profile</Label>
                    <Input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="gpt-4.1 / crew planner / custom profile" />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{(providerVisuals[selectedType.id] ?? providerVisuals.custom).endpointLabel}</Label>
                    <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://runtime.example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Organization binding</Label>
                    <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground/72">
                      {orgId ? `Connected to Org ${orgId}` : 'No active org selected'}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Operational policy</Label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="This agent proposes actions under credential-gated authority. It never assumes direct treasury access and only acts within session limits."
                    className="min-h-36 w-full rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground outline-none backdrop-blur-xl"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-4">
                    <div className="micro-label">Connect</div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <Cpu className="h-4 w-4" />
                      Provider runtime
                    </div>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-4">
                    <div className="micro-label">Identity</div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <Bot className="h-4 w-4" />
                      Protocol agent
                    </div>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-4">
                    <div className="micro-label">Access</div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4" />
                      Credential + session
                    </div>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-4">
                    <div className="micro-label">Treasury</div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <Wallet className="h-4 w-4" />
                      Wallet per agent
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setSelectedType(null)}>
                    Cancel
                  </Button>
                  <Button disabled={submitting || !orgId || !agentName.trim()} onClick={handleCreateAgent}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                    Connect and mint protocol agent
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </main>
      <Footer />
    </div>
  )
}
