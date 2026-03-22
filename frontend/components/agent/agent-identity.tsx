'use client'

import { Agent } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { truncateAddress, formatDate } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy } from 'lucide-react'
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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl">{agent.name}</CardTitle>
            <CardDescription className="mt-2">{agent.description}</CardDescription>
          </div>
          <StatusBadge status={agent.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Public Key
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-3 py-2 font-mono text-sm text-foreground">
                {agent.publicKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="flex-shrink-0"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Agent ID
            </p>
            <div className="mt-2">
              <code className="block rounded bg-muted px-3 py-2 font-mono text-sm text-foreground">
                {agent.id}
              </code>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Created
            </p>
            <p className="mt-2 text-sm text-foreground">{formatDate(agent.createdAt)}</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Last Updated
            </p>
            <p className="mt-2 text-sm text-foreground">{formatDate(agent.updatedAt)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
