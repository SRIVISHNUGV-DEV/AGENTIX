'use client';

import { Credential } from '@/lib/types';
import { StatusBadge } from './status-badge';
import { Key } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface CredentialCardProps {
  credential: Credential;
}

export function CredentialCard({ credential }: CredentialCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className="mt-1 rounded-lg bg-accent/10 p-2 text-accent">
            <Key className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">Credential {credential.id}</h3>
              <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                {credential.credentialType}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{credential.issuer}</p>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span>Issued {formatDate(credential.issuedAt)}</span>
              {credential.expiresAt && (
                <span>Expires {formatDate(credential.expiresAt)}</span>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={credential.status} />
      </div>
    </div>
  );
}
