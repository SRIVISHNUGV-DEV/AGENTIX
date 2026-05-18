'use client'

import { Credential } from '@/lib/types'
import { Key, ShieldCheck, Calendar, Clock } from 'lucide-react'
import { formatDate, truncateHash } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface CredentialCardProps {
  credential: Credential
  className?: string
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    completed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    revoked: 'bg-red-500/10 text-red-400 border-red-500/20',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border',
        colors[status] || 'bg-zinc-800 text-zinc-500 border-zinc-700'
      )}
    >
      {status}
    </span>
  )
}

export function CredentialCard({ credential, className }: CredentialCardProps) {
  const isZkVerified = credential.status === 'active'
  const daysUntilExpiry = credential.expiresAt
    ? Math.ceil(
        (new Date(credential.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    : null

  return (
    <div className={cn('h-full', className)}>
      <div className='group relative h-full flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 hover:border-zinc-700 transition-colors'>
        {/* Top row: Icon + Status */}
        <div className='flex items-start justify-between gap-3'>
          <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-800'>
            <Key className='h-5 w-5 text-zinc-400' />
          </div>
          <div className='flex flex-wrap items-center justify-end gap-2'>
            <StatusBadge status={credential.status} />
            {isZkVerified && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                <ShieldCheck className="h-3 w-3" />
                ZK Verified
              </span>
            )}
          </div>
        </div>

        {/* Credential info */}
        <div className='mt-4'>
          <h3 className='font-medium text-zinc-200'>
            Credential {credential.id}
          </h3>
          <p className='text-xs text-zinc-500 mt-0.5 font-mono'>
            {truncateHash(credential.credentialType, 24)}
          </p>
        </div>

        {/* Divider */}
        <div className='my-4 h-px bg-zinc-800' />

        {/* Metadata */}
        <div className='space-y-2 text-sm'>
          <div className='flex items-center justify-between'>
            <span className='flex items-center gap-1.5 text-zinc-500'>
              <Calendar className='h-3 w-3' />
              Issued
            </span>
            <span className='text-zinc-300'>
              {formatDate(credential.issuedAt)}
            </span>
          </div>

          {credential.expiresAt && (
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-1.5 text-zinc-500'>
                <Clock className='h-3 w-3' />
                {daysUntilExpiry !== null && daysUntilExpiry > 0
                  ? daysUntilExpiry < 7
                    ? 'Expiring soon'
                    : 'Expires'
                  : 'Expired'}
              </span>
              <span
                className={cn(
                  daysUntilExpiry !== null && daysUntilExpiry < 7 && daysUntilExpiry > 0
                    ? 'text-amber-400'
                    : 'text-zinc-300'
                )}
              >
                {formatDate(credential.expiresAt)}
              </span>
            </div>
          )}

          <div className='flex items-center justify-between'>
            <span className='text-zinc-500'>Issuer</span>
            <span className='font-mono text-zinc-300'>
              {truncateHash(credential.issuer, 16)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Compact version for tables/lists
export function CredentialCardCompact({
  credential,
  className,
}: CredentialCardProps) {
  const isZkVerified = credential.status === 'active'

  return (
    <div className={cn('h-full', className)}>
      <div className='flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 hover:border-zinc-700 transition-colors'>
        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800'>
          <Key className='h-4 w-4 text-zinc-400' />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-zinc-200 truncate'>
              Credential {credential.id}
            </span>
            {isZkVerified && (
              <ShieldCheck className='h-3.5 w-3.5 text-emerald-400 shrink-0' />
            )}
          </div>
          <p className='text-xs text-zinc-500 mt-0.5 font-mono truncate'>
            {truncateHash(credential.credentialType, 20)}
          </p>
        </div>
        <StatusBadge status={credential.status} />
      </div>
    </div>
  )
}
