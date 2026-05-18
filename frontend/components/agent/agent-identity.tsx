'use client'

import { Agent } from '@/lib/types'
import { formatDate, truncateAddress } from '@/lib/utils'
import { Copy, Calendar, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface AgentIdentityProps {
  agent: Agent
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

export function AgentIdentity({ agent }: AgentIdentityProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(agent.publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 sm:p-8">
      <div className="section-kicker text-xs text-zinc-500 uppercase tracking-wider">Agent profile</div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{agent.name}</h1>
          <p className="mt-2 max-w-2xl text-zinc-400">{agent.description}</p>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
          <div className="text-xs text-zinc-500 uppercase">Agent ID</div>
          <code className="mt-3 block font-mono text-sm text-zinc-300">{agent.id}</code>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
          <div className="text-xs text-zinc-500 uppercase">Public Key</div>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate font-mono text-sm text-zinc-300">
              {truncateAddress(agent.publicKey, 24)}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 border-zinc-700 bg-transparent">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 text-xs text-zinc-500">{copied ? 'Copied to clipboard' : 'Copy identifier'}</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-zinc-500" />
            <span className="text-xs text-zinc-500 uppercase">Created</span>
          </div>
          <div className="mt-2 text-zinc-300">{formatDate(agent.createdAt)}</div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            <span className="text-xs text-zinc-500 uppercase">Last Updated</span>
          </div>
          <div className="mt-2 text-zinc-300">{formatDate(agent.updatedAt)}</div>
        </div>
      </div>
    </div>
  )
}
