'use client'

import Link from 'next/link'
import { Plus, Users, KeyRound, Clock, Wallet, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'

interface Stats {
  totalAgents: number
  totalSessions: number
  totalWallets: number
  totalCredentials: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalAgents: 0,
    totalSessions: 0,
    totalWallets: 0,
    totalCredentials: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Mock data loading - replace with actual API call
    setTimeout(() => {
      setStats({
        totalAgents: 3,
        totalSessions: 12,
        totalWallets: 5,
        totalCredentials: 8,
      })
      setLoading(false)
    }, 500)
  }, [])

  const statCards = [
    { label: 'Agents', value: stats.totalAgents, icon: Users, href: '/agents' },
    { label: 'Sessions', value: stats.totalSessions, icon: Clock, href: '/sessions' },
    { label: 'Wallets', value: stats.totalWallets, icon: Wallet, href: '/wallets' },
    { label: 'Credentials', value: stats.totalCredentials, icon: KeyRound, href: '/credentials' },
  ]

  const contracts = [
    { name: 'CredentialRegistry', address: '0x...' },
    { name: 'SessionManager', address: '0x...' },
    { name: 'AgentWalletFactory', address: '0x...' },
  ]

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">Dashboard</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/agents" className="text-zinc-400 hover:text-zinc-200">Agents</Link>
            <Link href="/credentials" className="text-zinc-400 hover:text-zinc-200">Credentials</Link>
            <Link href="/sessions" className="text-zinc-400 hover:text-zinc-200">Sessions</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-4">
          {statCards.map(({ label, value, icon: Icon, href }) => (
            <Link key={label} href={href}>
              <div className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-colors">
                <div className="flex items-center justify-between">
                  <Icon className="h-4 w-4 text-zinc-500" />
                  <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-semibold">
                    {loading ? '-' : value}
                  </div>
                  <div className="text-sm text-zinc-500">{label}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Two Column Layout */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Actions */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="font-medium">Quick Actions</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/agents">
                  <Button size="sm" className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
                    <Plus className="mr-1 h-4 w-4" />
                    New Agent
                  </Button>
                </Link>
                <Link href="/credentials">
                  <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                    Issue Credential
                  </Button>
                </Link>
                <Link href="/sessions">
                  <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                    Open Session
                  </Button>
                </Link>
              </div>
            </div>

            {/* Agents List */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Agents</h2>
                <Link href="/agents" className="text-sm text-zinc-400 hover:text-zinc-200">View all</Link>
              </div>
              <div className="mt-4 space-y-2">
                {['agent-001', 'agent-002', 'agent-003'].map((agent) => (
                  <div key={agent} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-mono">
                        A
                      </div>
                      <div>
                        <div className="text-sm font-medium">{agent}</div>
                        <div className="text-xs text-zinc-500">Active</div>
                      </div>
                    </div>
                    <Link href={`/agents/${agent}`}>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Contracts */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="font-medium">Contracts</h2>
              <div className="mt-4 space-y-3">
                {contracts.map(({ name, address }) => (
                  <div key={name}>
                    <div className="text-xs text-zinc-500 uppercase tracking-wider">{name}</div>
                    <div className="mt-1 font-mono text-xs text-zinc-400 truncate">
                      {address}
                    </div>
                  </div>
                ))}
              </div>
              <Link href="https://sepolia.etherscan.io" target="_blank">
                <Button variant="outline" size="sm" className="mt-4 w-full border-zinc-700 bg-transparent hover:bg-zinc-800">
                  View on Explorer
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>

            {/* Network */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="font-medium">Network</h2>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Chain</span>
                  <span>Sepolia</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Chain ID</span>
                  <span>11155111</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Protocol</span>
                  <span>ERC-4337</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
