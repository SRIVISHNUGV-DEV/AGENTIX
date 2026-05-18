'use client'

import { Agent } from '@/lib/types'
import { ChevronRight, Bot, Fingerprint, WalletCards } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface AgentCardProps {
  agent: Agent
  className?: string
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'active'
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
      )}
    >
      {status}
    </span>
  )
}

export function AgentCard({ agent, className }: AgentCardProps) {
  const isOnline = agent.status === 'active'

  return (
    <div className={cn('h-full', className)}>
      <Link href={`/agents/${agent.id}`} className='block h-full'>
        <div className='group relative flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 hover:border-zinc-700 transition-colors'>
          {/* Header */}
          <div className='flex items-start justify-between gap-3'>
            <div className='relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800'>
              <Bot className='h-6 w-6 text-zinc-400' />
              {isOnline && (
                <span className='absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 bg-emerald-400' />
              )}
            </div>
            <StatusBadge status={agent.status} />
          </div>

          {/* Content */}
          <div className='mt-4 flex-1'>
            <h3 className='text-lg font-medium text-zinc-200 group-hover:text-zinc-100'>
              {agent.name}
            </h3>
            <p className='mt-1.5 text-sm text-zinc-500 line-clamp-2'>
              {agent.description}
            </p>
          </div>

          {/* Divider */}
          <div className='my-4 h-px bg-zinc-800' />

          {/* Stats */}
          <div className='flex items-center justify-between pt-1'>
            <div className='flex items-center gap-4 text-xs text-zinc-500'>
              <span className='flex items-center gap-1.5'>
                <Fingerprint className='h-3.5 w-3.5' />
                {agent.credentials.length}
              </span>
              <span className='flex items-center gap-1.5'>
                <WalletCards className='h-3.5 w-3.5' />
                {agent.wallets.length}
              </span>
            </div>
            <ChevronRight className='h-4 w-4 text-zinc-600 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-400' />
          </div>
        </div>
      </Link>
    </div>
  )
}

// Grid view variant for agent lists
export function AgentCardGrid({ agents }: { agents: Agent[] }) {
  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {agents.map((agent) => (
        <div key={agent.id}>
          <AgentCard agent={agent} />
        </div>
      ))}
    </div>
  )
}
