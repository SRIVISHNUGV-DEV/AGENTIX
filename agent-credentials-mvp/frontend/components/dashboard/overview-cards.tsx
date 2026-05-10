'use client'

import { DashboardStats } from '@/lib/types'
import { TrendingUp, TrendingDown, Users, Lock, Zap, Wallet } from 'lucide-react'

interface OverviewCardsProps {
  stats: DashboardStats
}

interface StatItemProps {
  label: string
  value: number
  icon: React.ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
}

function StatItem({ label, value, icon, trend }: StatItemProps) {
  return (
    <div className='group relative h-full rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 hover:border-zinc-700 transition-colors'>
      {/* Icon */}
      <div className='mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-800/50 group-hover:bg-zinc-800 transition-colors'>
        <div className='text-zinc-400 group-hover:text-zinc-300 transition-colors'>
          {icon}
        </div>
      </div>

      {/* Label */}
      <p className='mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500'>
        {label}
      </p>

      {/* Value */}
      <div className='flex items-baseline gap-3'>
        <span className='text-2xl font-semibold text-zinc-100'>
          {value.toLocaleString()}
        </span>
        {trend && (
          <span
            className={`flex items-center text-xs font-medium ${
              trend.isPositive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {trend.isPositive ? (
              <TrendingUp className='mr-0.5 h-3 w-3' />
            ) : (
              <TrendingDown className='mr-0.5 h-3 w-3' />
            )}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  )
}

export function OverviewCards({ stats }: OverviewCardsProps) {
  const activeRatio =
    stats.totalAgents === 0
      ? 0
      : Math.round((stats.activeAgents / stats.totalAgents) * 100)

  const cards: StatItemProps[] = [
    {
      label: 'Total Agents',
      value: stats.totalAgents,
      icon: <Users className='h-4 w-4' />,
    },
    {
      label: 'Active Agents',
      value: stats.activeAgents,
      icon: <Lock className='h-4 w-4' />,
      trend: {
        value: activeRatio,
        isPositive: true,
      },
    },
    {
      label: 'Total Sessions',
      value: stats.totalSessions,
      icon: <Zap className='h-4 w-4' />,
    },
    {
      label: 'Total Wallets',
      value: stats.totalWallets,
      icon: <Wallet className='h-4 w-4' />,
    },
  ]

  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      {cards.map((card) => (
        <StatItem key={card.label} {...card} />
      ))}
    </div>
  )
}
