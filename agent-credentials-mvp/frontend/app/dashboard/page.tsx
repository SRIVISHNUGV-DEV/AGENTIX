import Link from 'next/link'
import { Shield, Users, Key, Wallet, Activity, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Dashboard() {
  const stats = [
    { label: 'Total Agents', value: '0', icon: Users },
    { label: 'Active Sessions', value: '0', icon: Activity },
    { label: 'Credentials Issued', value: '0', icon: Key },
    { label: 'Wallets Deployed', value: '0', icon: Wallet },
  ]

  const recentActivity = [
    { type: 'agent', message: 'No agents registered yet', time: '-' },
    { type: 'credential', message: 'Issue your first credential to get started', time: '-' },
    { type: 'session', message: 'Agent sessions will appear here', time: '-' },
  ]

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <div className="w-5 h-5 bg-white rounded-sm flex items-center justify-center">
              <span className="text-black text-xs font-bold">A</span>
            </div>
            <span>Agentix</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-white">
              Dashboard
            </Link>
            <Link href="/agents" className="text-zinc-400 hover:text-white transition-colors">
              Agents
            </Link>
            <Link href="/docs" className="text-zinc-400 hover:text-white transition-colors">
              Docs
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-zinc-400 mt-1">Overview of your agent credentials protocol</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-4 mb-8">
          {stats.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  {label}
                </span>
                <Icon className="w-4 h-4 text-zinc-600" />
              </div>
              <div className="text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Link
              href="/agents/new"
              className="group flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all"
            >
              <div>
                <div className="font-medium">Register Agent</div>
                <div className="text-sm text-zinc-400">Add a new agent identity</div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
            </Link>
            <Link
              href="/credentials/issue"
              className="group flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all"
            >
              <div>
                <div className="font-medium">Issue Credential</div>
                <div className="text-sm text-zinc-400">Create ZK credential</div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
            </Link>
            <Link
              href="/sessions"
              className="group flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all"
            >
              <div>
                <div className="font-medium">Create Session</div>
                <div className="text-sm text-zinc-400">Start agent session</div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 overflow-hidden">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold">Recent Activity</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {recentActivity.map((item, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-zinc-600" />
                  <div className="text-sm">{item.message}</div>
                </div>
                <div className="text-xs text-zinc-500">{item.time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Network Status */}
        <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
          <h2 className="text-lg font-semibold mb-4">Network Status</h2>
          <div className="grid gap-6 sm:grid-cols-4">
            <div>
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Network
              </div>
              <div className="font-medium">Sepolia</div>
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Latest Block
              </div>
              <div className="font-medium font-mono">-</div>
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Gas Price
              </div>
              <div className="font-medium font-mono">-</div>
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Status
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-zinc-600" />
                <span className="text-zinc-400">Not connected</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
