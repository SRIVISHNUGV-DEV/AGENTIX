'use client'

import { DashboardStats } from '@/lib/types'
import { StatCard } from '@/components/common/stat-card'
import { Users, Lock, Zap, Wallet } from 'lucide-react'

interface OverviewCardsProps {
  stats: DashboardStats
}

export function OverviewCards({ stats }: OverviewCardsProps) {
  const activeRatio =
    stats.totalAgents === 0 ? 0 : Math.round((stats.activeAgents / stats.totalAgents) * 100)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div className="group">
        <StatCard
          label="Total Agents"
          value={stats.totalAgents}
          icon={<Users className="h-4 w-4" />}
        />
      </div>
      <div className="group">
        <StatCard
          label="Active Agents"
          value={stats.activeAgents}
          icon={<Lock className="h-4 w-4" />}
          trend={{
            value: activeRatio,
            isPositive: true,
          }}
        />
      </div>
      <div className="group">
        <StatCard
          label="Total Sessions"
          value={stats.totalSessions}
          icon={<Zap className="h-4 w-4" />}
        />
      </div>
      <div className="group">
        <StatCard
          label="Total Wallets"
          value={stats.totalWallets}
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>
    </div>
  )
}
