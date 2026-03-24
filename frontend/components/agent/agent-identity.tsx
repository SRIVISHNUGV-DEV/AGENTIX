'use client'

import { Agent } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { formatDate } from '@/lib/utils'
import { Copy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

interface AgentIdentityProps {
  agent: Agent
}

export function AgentIdentity({ agent }: AgentIdentityProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(agent.publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="hero-panel p-8 sm:p-10">
      <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="section-kicker">Agent profile</div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{agent.name}</h1>
              <p className="mt-4 max-w-2xl text-foreground/62">{agent.description}</p>
            </div>
            <StatusBadge status={agent.status} />
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="metric-tile">
              <div className="micro-label">Agent ID</div>
              <code className="mt-3 block rounded-2xl border border-white/10 bg-background px-3 py-3 font-mono text-sm text-foreground">
                {agent.id}
              </code>
            </div>

            <div className="metric-tile">
              <div className="micro-label">Public Key</div>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 truncate rounded-2xl border border-white/10 bg-background px-3 py-3 font-mono text-sm text-foreground">
                  {agent.publicKey}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopy} className="h-11 rounded-2xl border-white/10 bg-background">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 text-xs text-foreground/45">{copied ? 'Copied to clipboard' : 'Copy public identifier'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-background/70 p-6 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-5 w-5 text-foreground/55" />
            <div>
              <div className="micro-label">Operational timing</div>
              <div className="mt-3 grid gap-4">
                <div className="metric-tile">
                  <div className="micro-label">Created</div>
                  <div className="mt-2 text-xl font-semibold">{formatDate(agent.createdAt)}</div>
                </div>
                <div className="metric-tile">
                  <div className="micro-label">Last updated</div>
                  <div className="mt-2 text-xl font-semibold">{formatDate(agent.updatedAt)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
