'use client'

import { Credential } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { truncateAddress, formatDate } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck } from 'lucide-react'

interface CredentialsListProps {
  credentials: Credential[]
}

export function CredentialsList({ credentials }: CredentialsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" />
          Credentials
        </CardTitle>
        <CardDescription>{credentials.length} credential(s)</CardDescription>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credentials issued yet</p>
        ) : (
          <div className="space-y-4">
            {credentials.map(cred => (
              <div
                key={cred.id}
                className="flex items-start justify-between rounded-lg border border-border p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-foreground">
                      {cred.credentialType}
                    </span>
                    <StatusBadge status={cred.status} />
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <span className="font-semibold">Proof Hash:</span>{' '}
                      <code className="font-mono">{truncateAddress(cred.proofHash)}</code>
                    </div>
                    <div>
                      <span className="font-semibold">Issuer:</span>{' '}
                      <code className="font-mono">{truncateAddress(cred.issuer)}</code>
                    </div>
                    <div>
                      <span className="font-semibold">Issued:</span> {formatDate(cred.issuedAt)}
                      {' • '}
                      <span className="font-semibold">Expires:</span>{' '}
                      {formatDate(cred.expiresAt)}
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
