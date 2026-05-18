'use client'

import { Event } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { truncateAddress, formatDate } from '@/lib/utils'
import { FileText, Lock, Wallet as WalletIcon } from 'lucide-react'
import { getTxExplorerUrl } from '@/lib/explorer'

interface EventsFeedProps {
  events: Event[]
}

const getEventIcon = (type: string) => {
  switch (type) {
    case 'credential_issued':
    case 'credential_revoked':
      return <Lock className="h-4 w-4" />
    case 'wallet_added':
      return <WalletIcon className="h-4 w-4" />
    default:
      return <FileText className="h-4 w-4" />
  }
}

export function EventsFeed({ events }: EventsFeedProps) {
  return (
    <div className="space-y-4">
      {events.slice(0, 10).map((event, idx) => (
        <div key={event.id} className="flex gap-4 pb-4 border-b border-border last:border-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground flex-shrink-0">
            {getEventIcon(event.type)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h4 className="text-sm font-medium text-foreground truncate">
                {event.description}
              </h4>
              <StatusBadge status={event.type} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{event.contractName}</span>
              <span>•</span>
              <a
                href={getTxExplorerUrl(event.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline decoration-white/20 underline-offset-4 hover:text-foreground"
              >
                {truncateAddress(event.txHash, 6)}
              </a>
              <span>•</span>
              <span>Block {String(event.blockNumber)}</span>
            </div>
            <span className="text-xs text-muted-foreground/70 mt-1 block">
              {formatDate(event.timestamp)}
            </span>
          </div>
        </div>
      ))}
      {events.length === 0 && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <p className="text-sm">No events yet</p>
        </div>
      )}
    </div>
  )
}
