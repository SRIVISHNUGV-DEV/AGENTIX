'use client'

import { cn } from '@/lib/utils'
import { CredentialStatus, SessionStatus, EventType } from '@/lib/types'

interface StatusBadgeProps {
  status: CredentialStatus | SessionStatus | EventType | string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-foreground/10 text-foreground border border-foreground/20'
      case 'expired':
      case 'revoked':
        return 'bg-foreground/5 text-foreground/60 border border-foreground/10'
      case 'credential_issued':
      case 'wallet_added':
        return 'bg-foreground/10 text-foreground border border-foreground/20'
      case 'transaction_signed':
        return 'bg-foreground/10 text-foreground border border-foreground/20'
      case 'session_created':
        return 'bg-foreground/10 text-foreground border border-foreground/20'
      case 'credential_revoked':
      case 'session_expired':
        return 'bg-foreground/5 text-foreground/60 border border-foreground/10'
      default:
        return 'bg-foreground/5 text-foreground/60 border border-foreground/10'
    }
  }

  const getStatusLabel = (status: string) => {
    return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  return (
    <span
      className={cn(
        'inline-block rounded-md px-2.5 py-1 text-xs font-medium',
        getStatusColor(status),
        className
      )}
    >
      {getStatusLabel(status)}
    </span>
  )
}
