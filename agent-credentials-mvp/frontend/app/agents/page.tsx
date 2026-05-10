import Link from 'next/link'
import { Plus, Users, Shield, Wallet, Clock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgents, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'
import { formatDate, truncateAddress } from '@/lib/utils'

export const metadata = {
  title: 'Agents - Agentix',
  description: 'Browse issued agents, credentials, wallets, and session counts.',
}

export default async function AgentsPage() {
  const [orgListRes, selectedOrgId] = await Promise.all([listOrganizations(), getSelectedOrgId()])
  const currentOrgId = selectedOrgId?.toString() ?? orgListRes.data[orgListRes.data.length - 1]?.id ?? null
  const agentsRes = await getAgents(currentOrgId)
  const agents = agentsRes.data

  const readyAgents = agents.filter((agent) => agent.credentials.length > 0 && agent.wallets.length > 0)

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">Agents</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-200">Dashboard</Link>
            <Link href="/credentials" className="text-zinc-400 hover:text-zinc-200">Credentials</Link>
            <Link href="/sessions" className="text-zinc-400 hover:text-zinc-200">Sessions</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Total Agents', value: agents.length, icon: Users },
            { label: 'Ready Agents', value: readyAgents.length, icon: Shield },
            { label: 'With Wallets', value: agents.filter(a => a.wallets.length > 0).length, icon: Wallet },
            { label: 'Active Sessions', value: agents.reduce((acc, a) => acc + a.sessions.length, 0), icon: Clock },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <Icon className="h-4 w-4 text-zinc-500" />
              </div>
              <div className="mt-4">
                <div className="text-2xl font-semibold">{value}</div>
                <div className="text-sm text-zinc-500">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Agents</h1>
            <p className="text-sm text-zinc-500 mt-1">Protocol-native agent identities with credentials and wallets</p>
          </div>
          <Link href="/ai-agents">
            <Button size="sm" className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
              <Plus className="mr-1 h-4 w-4" />
              Register Agent
            </Button>
          </Link>
        </div>

        {/* Agents Grid */}
        {agents.length === 0 ? (
          <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <Users className="mx-auto h-10 w-10 text-zinc-600" />
            <h2 className="mt-4 text-lg font-medium text-zinc-300">No agents registered</h2>
            <p className="mt-2 text-sm text-zinc-500 max-w-md mx-auto">
              Register your first agent to begin issuing credentials and creating session wallets.
            </p>
            <Link href="/ai-agents" className="inline-block mt-4">
              <Button size="sm" className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
                <Plus className="mr-1 h-4 w-4" />
                Register Agent
              </Button>
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Link key={agent.id} href={`/agents/${agent.id}`}>
                <div className="group rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 hover:border-zinc-600 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs text-zinc-500 font-mono">#{agent.id}</div>
                      <h2 className="text-lg font-medium text-zinc-200 group-hover:text-zinc-100">{agent.name}</h2>
                    </div>
                    <div className={`h-2 w-2 rounded-full ${agent.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                  </div>

                  <p className="mt-2 text-sm text-zinc-500 line-clamp-2">{agent.description}</p>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-zinc-800/50 p-2">
                      <div className="text-lg font-medium">{agent.credentials.length}</div>
                      <div className="text-xs text-zinc-500">Creds</div>
                    </div>
                    <div className="rounded bg-zinc-800/50 p-2">
                      <div className="text-lg font-medium">{agent.wallets.length}</div>
                      <div className="text-xs text-zinc-500">Wallets</div>
                    </div>
                    <div className="rounded bg-zinc-800/50 p-2">
                      <div className="text-lg font-medium">{agent.sessions.length}</div>
                      <div className="text-xs text-zinc-500">Sessions</div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center justify-between text-xs">
                    <span className="text-zinc-500">{truncateAddress(agent.publicKey)}</span>
                    <span className="text-zinc-500">{formatDate(agent.createdAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
