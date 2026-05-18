import Link from 'next/link'
import { Activity, ArrowRight, Building2, KeyRound, Network, Shield, Wallet } from 'lucide-react'
import { WorkspaceControls } from '@/components/platform/workspace-controls'
import { OrgActions } from '@/components/platform/org-actions'
import { CreateOrgForm } from '@/components/platform/create-org-form'
import { Button } from '@/components/ui/button'
import { getDashboardStats, getEvents, getOrganizationWorkspace, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'
import { formatDate, truncateAddress } from '@/lib/utils'
import Header from '@/components/header'

export const metadata = {
  title: 'Dashboard - Agentix',
  description: 'Workspace overview for organizations, credentials, sessions, and wallets.',
}

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [organizationsRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])

  // If no organizations exist, show empty state
  const hasOrganizations = organizationsRes.data.length > 0
  const currentOrgId = hasOrganizations
    ? (selectedOrgId?.toString() ??
      organizationsRes.data[organizationsRes.data.length - 1]?.id ??
      null)
    : null

  // Only fetch stats/events/workspace if we have an organization
  const [statsRes, eventsRes, workspaceRes] = await Promise.all([
    getDashboardStats(currentOrgId),
    getEvents(currentOrgId),
    currentOrgId ? getOrganizationWorkspace(currentOrgId) : Promise.resolve(null),
  ])

  const stats = statsRes?.data ?? { totalAgents: 0, activeAgents: 0, totalSessions: 0, totalWallets: 0, recentEvents: 0 }
  const events = (eventsRes?.data ?? []).slice(0, 6)
  const workspace = workspaceRes?.data ?? null

  const cards = [
    { label: 'Agents', value: stats.totalAgents, icon: Shield },
    { label: 'Active Agents', value: stats.activeAgents, icon: Activity },
    { label: 'Sessions', value: stats.totalSessions, icon: KeyRound },
    { label: 'Wallets', value: stats.totalWallets, icon: Wallet },
  ]

  const quickLinks = [
    { href: '/agents/new', label: 'Register agent', description: 'Create a new protocol identity.' },
    { href: '/ai-agents', label: 'Connect runtime', description: 'Attach an external runtime to an agent.' },
    { href: '/events', label: 'Inspect events', description: 'Review indexed on-chain activity.' },
  ]

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Workspace</span>
              <h1 className="mt-2 text-3xl font-semibold">
                {workspace?.organization.name ?? 'Create or select an organization'}
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-zinc-400">
                The dashboard reflects the currently selected organization. Create agents here, sign platform actions
                from the owner wallet, and inspect the PostgreSQL-backed state of the protocol.
              </p>
            </div>
            {currentOrgId ? (
              <Link href="/agents">
                <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">Open agents</Button>
              </Link>
            ) : (
              <CreateOrgForm />
            )}
          </div>
        </div>

        <div className="mt-8">
          <WorkspaceControls
            organizations={organizationsRes.data.map((org) => ({ id: org.id, name: org.name }))}
            currentOrgId={currentOrgId}
          />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</span>
                <Icon className="h-4 w-4 text-zinc-500" />
              </div>
              <div className="mt-4 text-3xl font-semibold">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">Quick actions</h2>
                <p className="mt-1 text-sm text-zinc-500">Working entry points for the main flows.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {quickLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <div className="font-medium">{item.label}</div>
                  <div className="mt-2 text-sm text-zinc-500">{item.description}</div>
                  <div className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
                    Open
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-zinc-500" />
              <h2 className="font-medium">Contracts</h2>
            </div>
            {!workspace?.contracts ? (
              <p className="mt-4 text-sm text-zinc-500">
                No organization contracts are available yet. Connect the owner wallet and deploy from the controls below.
              </p>
            ) : (
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-500">Network</span>
                  <span className="capitalize">{workspace.contracts.networkName}</span>
                </div>
                {workspace.contracts.verifierAddress ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Verifier</span>
                    <a
                      href={`https://sepolia.etherscan.io/address/${workspace.contracts.verifierAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-zinc-300 hover:text-white hover:underline transition-colors"
                    >
                      {truncateAddress(workspace.contracts.verifierAddress, 14)}
                    </a>
                  </div>
                ) : null}
                {workspace.contracts.credentialRegistryAddress ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Registry</span>
                    <a
                      href={`https://sepolia.etherscan.io/address/${workspace.contracts.credentialRegistryAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-zinc-300 hover:text-white hover:underline transition-colors"
                    >
                      {truncateAddress(workspace.contracts.credentialRegistryAddress, 14)}
                    </a>
                  </div>
                ) : null}
                {workspace.contracts.sessionManagerAddress ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Session manager</span>
                    <a
                      href={`https://sepolia.etherscan.io/address/${workspace.contracts.sessionManagerAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-zinc-300 hover:text-white hover:underline transition-colors"
                    >
                      {truncateAddress(workspace.contracts.sessionManagerAddress, 14)}
                    </a>
                  </div>
                ) : null}
                {workspace.contracts.agentWalletFactoryAddress ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Wallet Factory</span>
                    <a
                      href={`https://sepolia.etherscan.io/address/${workspace.contracts.agentWalletFactoryAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-zinc-300 hover:text-white hover:underline transition-colors"
                    >
                      {truncateAddress(workspace.contracts.agentWalletFactoryAddress, 14)}
                    </a>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>

        {currentOrgId ? (
          <div className="mt-8">
            <OrgActions orgId={currentOrgId} />
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <h2 className="font-medium">Recent activity</h2>
            {events.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No indexed events yet for the selected workspace.</p>
            ) : (
              <div className="mt-4 divide-y divide-zinc-800">
                {events.map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <div className="text-sm text-zinc-200">{event.description}</div>
                      <div className="mt-1 text-xs text-zinc-500">{event.contractName}</div>
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <div>#{event.blockNumber}</div>
                      <div>{formatDate(event.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-zinc-500" />
              <h2 className="font-medium">Workspace status</h2>
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Organizations</span>
                <span>{organizationsRes.data.length}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Selected org</span>
                <span>{currentOrgId ?? 'None'}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Contracts deployed</span>
                <span>{workspace?.contracts ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Last event count</span>
                <span>{stats.recentEvents}</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
