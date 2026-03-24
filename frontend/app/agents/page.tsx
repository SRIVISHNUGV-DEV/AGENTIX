import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { getAgents, listOrganizations } from '@/lib/mock-api'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ChevronRight, Fingerprint, ShieldCheck, WalletCards, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatDate, truncateAddress } from '@/lib/utils'
import { StatusBadge } from '@/components/common/status-badge'
import { getSelectedOrgId } from '@/lib/org-session'
import { WorkspaceControls } from '@/components/platform/workspace-controls'
import { StackMetrics } from '@/components/common/stack-metrics'

const agentHighlights: Array<{ title: string; body: string; icon: LucideIcon }> = [
  {
    title: 'Ingest agents cleanly',
    body: 'Add agents to the active workspace without exposing internal tooling complexity to operators.',
    icon: Fingerprint,
  },
  {
    title: 'Move them to ready state',
    body: 'Credentials, wallet deployment, funding, and sessions stay visible as one operational progression.',
    icon: ShieldCheck,
  },
  {
    title: 'Operate with confidence',
    body: 'Every agent card becomes a concise state summary instead of forcing users to dig through tables first.',
    icon: WalletCards,
  },
]

export const metadata = {
  title: 'Agents - Agentix',
  description: 'Browse issued agents, credentials, wallets, and session counts.',
}

export default async function AgentsPage() {
  const [orgListRes, selectedOrgId] = await Promise.all([listOrganizations(), getSelectedOrgId()])
  const currentOrgId =
    selectedOrgId?.toString() ??
    orgListRes.data[orgListRes.data.length - 1]?.id ??
    null
  const agentsRes = await getAgents(currentOrgId)
  const agents = agentsRes.data

  const readyAgents = agents.filter((agent) => agent.credentials.length > 0 && agent.wallets.length > 0)
  const fundedAgents = agents.filter((agent) => agent.wallets.length > 0)

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 shell py-16 sm:py-20">
        <section className="hero-panel p-8 sm:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="max-w-3xl">
              <span className="section-kicker">Agent inventory</span>
              <h1 className="font-display text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
                Connected agents and deployable execution surfaces
              </h1>
              <p className="mt-4 text-lg leading-8 text-foreground/62">
                Review which agents are provisioned, which ones are session-ready, and which ones still need wallet,
                credential, or treasury setup.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-background/70 p-6 backdrop-blur-xl">
              <div className="micro-label">Inventory posture</div>
              <div className="mt-4 space-y-4">
                <div className="metric-tile">
                  <div className="micro-label">Agent readiness</div>
                  <div className="mt-2 text-2xl font-semibold">{readyAgents.length} fully prepared</div>
                  <div className="mt-2 text-sm text-foreground/58">Credential issued, wallet deployed, and ready for session flow.</div>
                </div>
                <div className="metric-tile">
                  <div className="micro-label">Wallet coverage</div>
                  <div className="mt-2 text-2xl font-semibold">{fundedAgents.length} agents with wallets</div>
                  <div className="mt-2 text-sm text-foreground/58">Operators can move from provisioning to action without leaving the page.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <WorkspaceControls organizations={orgListRes.data} currentOrgId={currentOrgId} />
          </div>

          <div className="mt-8">
            <StackMetrics
              items={[
                { label: 'Total agents', value: agents.length, detail: 'Loaded into the current workspace' },
                { label: 'Ready agents', value: readyAgents.length, detail: 'Credential + wallet established' },
                { label: 'Wallet coverage', value: fundedAgents.length, detail: 'Agents that can receive funding' },
                { label: 'Workspace mode', value: currentOrgId ? `Org ${currentOrgId}` : 'Global', detail: 'Scoped through the selected organization' },
              ]}
            />
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {agentHighlights.map(({ title, body, icon: Icon }) => {
              return (
                <SpotlightCard key={title} className="p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white text-background">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-xl font-semibold">{title}</h2>
                  <p className="mt-2 text-sm leading-7 text-foreground/62">{body}</p>
                </SpotlightCard>
              )
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <SpotlightCard key={agent.id} className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="micro-label">Agent #{agent.id}</p>
                  <h2 className="mt-2 text-2xl font-semibold">{agent.name}</h2>
                </div>
                <StatusBadge status={agent.status} />
              </div>

              <p className="mt-3 min-h-14 text-sm leading-7 text-foreground/65">{agent.description}</p>

              <div className="mt-5 grid grid-cols-3 gap-3 text-center text-sm">
                <div className="metric-tile p-3">
                  <div className="text-xl font-semibold text-foreground">{agent.credentials.length}</div>
                  <div className="micro-label mt-1">Credentials</div>
                </div>
                <div className="metric-tile p-3">
                  <div className="text-xl font-semibold text-foreground">{agent.wallets.length}</div>
                  <div className="micro-label mt-1">Wallets</div>
                </div>
                <div className="metric-tile p-3">
                  <div className="text-xl font-semibold text-foreground">{agent.sessions.length}</div>
                  <div className="micro-label mt-1">Sessions</div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-background p-4 text-xs text-foreground/58">
                <div className="flex items-start gap-3">
                  <Waves className="mt-0.5 h-4 w-4 shrink-0 text-foreground/45" />
                  <div className="space-y-2">
                    <div>
                      Public key:{' '}
                      <code className="font-mono text-foreground/78">{truncateAddress(agent.publicKey)}</code>
                    </div>
                    <div>Created: {formatDate(agent.createdAt)}</div>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <Link href={`/agents/${agent.id}`}>
                  <Button className="w-full rounded-full bg-white text-background hover:bg-white/90">
                    Open agent
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </SpotlightCard>
          ))}
        </section>
      </main>
      <Footer />
    </div>
  )
}
