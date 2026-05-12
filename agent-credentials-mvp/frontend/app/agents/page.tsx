import Link from 'next/link'
import { ArrowRight, Bot, Plus, Shield, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgents, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'
import { formatDate, truncateAddress } from '@/lib/utils'
import Header from '@/components/header'

export const metadata = {
  title: 'Agents - Agentix',
  description: 'Registered protocol agents for the active organization.',
}

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const [organizationsRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])
  const currentOrgId =
    selectedOrgId?.toString() ??
    organizationsRes.data[organizationsRes.data.length - 1]?.id ??
    null
  const agentsRes = await getAgents(currentOrgId)
  const agents = agentsRes.data

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Organization</span>
            <h1 className="mt-2 text-3xl font-semibold">Protocol agents</h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400">
              Browse every agent identity in the selected workspace. Open an agent to issue credentials,
              create sessions, deploy wallets, or fund activity from the owner wallet.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/ai-agents">
              <Button variant="outline" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                Connect runtime
              </Button>
            </Link>
            <Link href="/agents/new">
              <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
                <Plus className="mr-2 h-4 w-4" />
                Register agent
              </Button>
            </Link>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <Bot className="mx-auto h-10 w-10 text-zinc-600" />
            <h2 className="mt-4 text-lg font-medium">No agents yet</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Create a protocol-native agent directly, or connect an external runtime and let Agentix provision the linked identity.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/agents/new">
                <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">Create agent</Button>
              </Link>
              <Link href="/ai-agents">
                <Button variant="outline" className="border-zinc-700 bg-transparent hover:bg-zinc-800">Connect runtime</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-800 text-lg font-medium">
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-medium">{agent.name}</h2>
                        <span className={agent.status === 'active' ? 'text-emerald-400 text-sm' : 'text-zinc-500 text-sm'}>
                          {agent.status}
                        </span>
                      </div>
                      <p className="mt-2 max-w-2xl text-sm text-zinc-500">{agent.description}</p>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
                        <span>Created {formatDate(agent.createdAt)}</span>
                        <span>Public key {truncateAddress(agent.publicKey, 16)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid min-w-[260px] grid-cols-3 gap-3">
                    <div className="rounded-lg bg-zinc-800/50 p-3 text-center">
                      <Shield className="mx-auto h-4 w-4 text-zinc-500" />
                      <div className="mt-2 text-lg font-medium">{agent.credentials.length}</div>
                      <div className="text-xs text-zinc-500">Credentials</div>
                    </div>
                    <div className="rounded-lg bg-zinc-800/50 p-3 text-center">
                      <Wallet className="mx-auto h-4 w-4 text-zinc-500" />
                      <div className="mt-2 text-lg font-medium">{agent.wallets.length}</div>
                      <div className="text-xs text-zinc-500">Wallets</div>
                    </div>
                    <div className="rounded-lg bg-zinc-800/50 p-3 text-center">
                      <ArrowRight className="mx-auto h-4 w-4 text-zinc-500" />
                      <div className="mt-2 text-lg font-medium">{agent.sessions.length}</div>
                      <div className="text-xs text-zinc-500">Sessions</div>
                    </div>
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
