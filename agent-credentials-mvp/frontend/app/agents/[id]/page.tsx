import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Shield, Wallet, Clock, Key, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgent, getEventsByAgent, getSessionsByAgent } from '@/lib/mock-api'
import { formatDate, truncateAddress } from '@/lib/utils'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agentRes = await getAgent(id)
  if (!agentRes.data) {
    return { title: 'Agent Not Found' }
  }
  return {
    title: `${agentRes.data.name} - Agentix`,
    description: agentRes.data.description,
  }
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [agentRes, eventsRes, sessionsRes] = await Promise.all([
    getAgent(id),
    getEventsByAgent(id),
    getSessionsByAgent(id),
  ])

  if (!agentRes.data) {
    notFound()
  }

  const agent = agentRes.data
  const events = eventsRes.data
  const sessions = sessionsRes.data

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <Link href="/agents" className="text-zinc-400 hover:text-zinc-200">Agents</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400 truncate max-w-[150px]">{agent.name}</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-200">Dashboard</Link>
            <Link href="/credentials" className="text-zinc-400 hover:text-zinc-200">Credentials</Link>
            <Link href="/sessions" className="text-zinc-400 hover:text-zinc-200">Sessions</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Back */}
        <Link href="/agents">
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-200 -ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Agents
          </Button>
        </Link>

        {/* Agent Header */}
        <div className="mt-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-zinc-800 flex items-center justify-center text-lg font-medium">
              {agent.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{agent.name}</h1>
              <div className="flex items-center gap-3 text-sm text-zinc-500">
                <span>ID #{agent.id}</span>
                <span className="text-zinc-600">•</span>
                <span className={agent.status === 'active' ? 'text-emerald-400' : 'text-zinc-500'}>
                  {agent.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>
          <p className="mt-4 text-zinc-400 max-w-2xl">{agent.description}</p>
        </div>

        {/* Stats */}
        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Credentials', value: agent.credentials.length, icon: Key },
            { label: 'Wallets', value: agent.wallets.length, icon: Wallet },
            { label: 'Sessions', value: sessions.length, icon: Clock },
            { label: 'Events', value: events.length, icon: Shield },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <Icon className="h-4 w-4 text-zinc-500" />
              <div className="mt-4">
                <div className="text-2xl font-semibold">{value}</div>
                <div className="text-sm text-zinc-500">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Two Column Layout */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Credentials */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-medium flex items-center gap-2">
                  <Key className="h-4 w-4 text-zinc-500" />
                  Credentials
                </h2>
                <Link href="/credentials">
                  <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                    Issue New
                  </Button>
                </Link>
              </div>
              {agent.credentials.length === 0 ? (
                <div className="mt-4 p-6 text-center border border-dashed border-zinc-800 rounded-lg">
                  <p className="text-sm text-zinc-500">No credentials issued for this agent yet.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {agent.credentials.map((cred) => (
                    <div key={cred.id} className="flex items-center justify-between py-3 border-b border-zinc-800/50 last:border-0">
                      <div>
                        <div className="font-mono text-sm">{truncateAddress(cred.proofHash, 12)}</div>
                        <div className="text-xs text-zinc-500 mt-1">Permissions: {cred.permissions}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm">Expires {formatDate(cred.expiresAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Wallets */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-medium flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-zinc-500" />
                  Wallets
                </h2>
                <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                  Deploy New
                </Button>
              </div>
              {agent.wallets.length === 0 ? (
                <div className="mt-4 p-6 text-center border border-dashed border-zinc-800 rounded-lg">
                  <p className="text-sm text-zinc-500">No wallets deployed for this agent yet.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {agent.wallets.map((wallet) => (
                    <div key={wallet.id} className="flex items-center justify-between py-3 border-b border-zinc-800/50 last:border-0">
                      <div className="font-mono text-sm">{truncateAddress(wallet.address, 16)}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500 uppercase">{wallet.walletKind ?? 'ERC-4337'}</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sessions */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-zinc-500" />
                  Sessions
                </h2>
                <Link href="/sessions">
                  <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                    Open Session
                  </Button>
                </Link>
              </div>
              {sessions.length === 0 ? (
                <div className="mt-4 p-6 text-center border border-dashed border-zinc-800 rounded-lg">
                  <p className="text-sm text-zinc-500">No active sessions for this agent.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {sessions.map((session) => (
                    <div key={session.id} className="flex items-center justify-between py-3 border-b border-zinc-800/50 last:border-0">
                      <div>
                        <div className="font-mono text-sm">{truncateAddress(session.sessionKey, 12)}</div>
                        <div className="text-xs text-zinc-500 mt-1">{formatDate(session.createdAt)}</div>
                      </div>
                      <span className="text-xs text-emerald-400">{session.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Agent Info */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="font-medium">Agent Details</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Organization</span>
                  <span>Org {agent.orgId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Public Key</span>
                  <span className="font-mono">{truncateAddress(agent.publicKey)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Created</span>
                  <span>{formatDate(agent.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* Recent Events */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="font-medium">Recent Activity</h2>
              {events.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No recent events.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {events.slice(0, 5).map((event) => (
                    <div key={event.id} className="text-sm">
                      <div className="text-zinc-300">{event.type}</div>
                      <div className="text-xs text-zinc-500 mt-1">{formatDate(event.timestamp)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
