import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { OverviewCards } from '@/components/dashboard/overview-cards'
import { AgentsTable } from '@/components/dashboard/agents-table'
import { SessionsTable } from '@/components/dashboard/sessions-table'
import { EventsFeed } from '@/components/dashboard/events-feed'
import { OrgActions } from '@/components/platform/org-actions'
import { WorkspaceControls } from '@/components/platform/workspace-controls'
import {
  getAgents,
  getDashboardStats,
  getEvents,
  getOrganizationWorkspace,
  getSessions,
  listOrganizations,
} from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'
import { getAddressExplorerUrl, getTxExplorerUrl } from '@/lib/explorer'
import { ArrowUpRight, Boxes, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'

export const metadata = {
  title: 'Workspace - Agentix',
  description: 'Operate an organization workspace for agent credentials, sessions, wallets, and treasury actions.',
}

const highlights = [
  {
    title: 'Policy control',
    body: 'Deploy a dedicated contract stack and keep all credential and session state scoped to one organization.',
    icon: ShieldCheck,
  },
  {
    title: 'Operational clarity',
    body: 'Watch wallet deployments, session creation, and contract events without leaving the workspace.',
    icon: Sparkles,
  },
  {
    title: 'Agent readiness',
    body: 'Issue credentials, fund wallets, and create sessions only when an agent is ready to operate.',
    icon: WalletCards,
  },
]

export default async function DashboardPage() {
  const [orgListRes, selectedOrgId] = await Promise.all([listOrganizations(), getSelectedOrgId()])

  const organizations = orgListRes.data
  const currentOrgId =
    selectedOrgId?.toString() ?? organizations[organizations.length - 1]?.id ?? null

  if (!currentOrgId) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <GridBackdrop />
        <Header />
        <main className="shell relative z-10 py-16">
          <div className="max-w-4xl rounded-[2rem] border border-white/10 bg-card p-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="section-kicker">Start here</div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Create your first workspace</h1>
            <p className="mt-4 max-w-2xl text-foreground/62">
              Connect the owner wallet, create an organization, then add agents before deploying contracts.
            </p>
            <div className="mt-8">
              <WorkspaceControls organizations={[]} currentOrgId={null} />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  const [workspaceRes, statsRes, agentsRes, sessionsRes, eventsRes] = await Promise.all([
    getOrganizationWorkspace(currentOrgId),
    getDashboardStats(currentOrgId),
    getAgents(currentOrgId),
    getSessions(currentOrgId),
    getEvents(currentOrgId),
  ])

  const workspace = workspaceRes.data
  const contracts = workspace.contracts

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <GridBackdrop />
      <Header />
      <main className="shell relative z-10 py-10 sm:py-14">
        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border border-white/10 bg-card p-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="section-kicker">Organization workspace</div>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                  {workspace.organization.name}
                </h1>
                <p className="mt-4 max-w-2xl text-foreground/62">
                  Issue credentials, manage wallets, create sessions, fund agents, and inspect live contract state
                  from a single operator view.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-background px-4 py-2 text-sm text-foreground/65">
                <Boxes className="h-4 w-4" />
                Org #{workspace.organization.id}
              </div>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {highlights.map(({ title, body, icon: Icon }) => (
                <div key={title} className="rounded-3xl border border-white/10 bg-background p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white text-background">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">{title}</h2>
                  <p className="mt-2 text-sm leading-7 text-foreground/58">{body}</p>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <WorkspaceControls organizations={organizations} currentOrgId={currentOrgId} />
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-card p-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.2em] text-foreground/45">Contracts</div>
                <h2 className="mt-3 text-2xl font-semibold">Live on-chain stack</h2>
              </div>
              <div className="rounded-full border border-white/10 bg-background px-3 py-1 text-xs uppercase tracking-[0.16em] text-foreground/55">
                Sepolia
              </div>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              {contracts ? (
                <>
                  {[
                    ['CredentialRegistry', contracts.credentialRegistryAddress],
                    ['SessionManager', contracts.sessionManagerAddress],
                    ['AgentWalletFactory', contracts.agentWalletFactoryAddress],
                  ].map(([label, address]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-background p-4">
                      <div className="text-foreground/45">{label}</div>
                      <a
                        href={getAddressExplorerUrl(address as string)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 flex items-start justify-between gap-3 break-all font-mono text-xs text-foreground/78 underline decoration-white/20 underline-offset-4 hover:text-foreground"
                      >
                        <span>{address}</span>
                        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" />
                      </a>
                    </div>
                  ))}
                  {contracts.deploymentTxHashes ? (
                    <div className="rounded-2xl border border-white/10 bg-background p-4">
                      <div className="mb-3 text-foreground/45">Deployment transactions</div>
                      <div className="space-y-2 text-xs">
                        {Object.entries(contracts.deploymentTxHashes)
                          .filter(([, txHash]) => Boolean(txHash))
                          .map(([label, txHash]) => (
                            <a
                              key={label}
                              href={getTxExplorerUrl(txHash!)}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start justify-between gap-3 font-mono text-foreground/75 underline decoration-white/20 underline-offset-4 hover:text-foreground"
                            >
                              <span className="break-all">{label}: {txHash}</span>
                              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" />
                            </a>
                          ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-background p-5 text-foreground/55">
                  No contracts deployed yet for this organization.
                </div>
              )}
            </div>

            <div className="mt-8">
              <OrgActions orgId={currentOrgId} />
            </div>
          </div>
        </section>

        <section className="mt-8">
          <OverviewCards stats={statsRes.data} />
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border border-white/10 bg-card p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Agents</h2>
                <p className="mt-1 text-sm text-foreground/55">
                  Open an agent to issue credentials, deploy a wallet, fund it, create a session, or revoke access.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-background px-3 py-1 text-xs text-foreground/55">
                {agentsRes.data.length} total
              </div>
            </div>
            <AgentsTable agents={agentsRes.data} />
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-card p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Recent events</h2>
                <p className="mt-1 text-sm text-foreground/55">
                  Indexed contract activity for this organization.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-background px-3 py-1 text-xs text-foreground/55">
                Live feed
              </div>
            </div>
            <EventsFeed events={eventsRes.data} />
          </div>
        </section>

        <section className="mt-8 rounded-[2rem] border border-white/10 bg-card p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Sessions</h2>
              <p className="mt-1 text-sm text-foreground/55">
                Latest session creations and their expiry windows.
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-background px-3 py-1 text-xs text-foreground/55">
              {sessionsRes.data.length} records
            </div>
          </div>
          <SessionsTable sessions={sessionsRes.data} />
        </section>
      </main>
      <Footer />
    </div>
  )
}
