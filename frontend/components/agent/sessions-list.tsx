'use client'

import { Session } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { truncateAddress, formatDate } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Zap } from 'lucide-react'
import { getTxExplorerUrl } from '@/lib/explorer'

interface SessionsListProps {
  sessions: Session[]
}

export function SessionsList({ sessions }: SessionsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="h-5 w-5" />
          Sessions
        </CardTitle>
        <CardDescription>{sessions.length} session(s)</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions created yet</p>
        ) : (
          <div className="space-y-4">
            {sessions.map(session => (
              <div
                key={session.id}
                className="flex items-start justify-between rounded-lg border border-border p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="font-mono text-sm font-medium text-foreground">
                      {truncateAddress(session.id, 6)}
                    </code>
                    <StatusBadge status={session.status} />
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <span className="font-semibold">Session Key:</span>{' '}
                      <code className="font-mono">{truncateAddress(session.sessionKey)}</code>
                    </div>
                    <div>
                      <span className="font-semibold">TX Hash:</span>{' '}
                      <a
                        href={getTxExplorerUrl(session.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline decoration-white/20 underline-offset-4 hover:text-foreground"
                      >
                        {truncateAddress(session.txHash)}
                      </a>
                    </div>
                    <div className="flex gap-4">
                      <div>
                        <span className="font-semibold">Created:</span>{' '}
                        {formatDate(session.createdAt)}
                      </div>
                      <div>
                        <span className="font-semibold">Expires:</span>{' '}
                        {formatDate(session.expiresAt)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
