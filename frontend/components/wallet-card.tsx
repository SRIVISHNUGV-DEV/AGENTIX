'use client';

import { Wallet } from '@/lib/types';
import { Wallet2 } from 'lucide-react';
import { formatDate, truncateAddress } from '@/lib/utils';

interface WalletCardProps {
  wallet: Wallet;
}

export function WalletCard({ wallet }: WalletCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className="mt-1 rounded-lg bg-accent/10 p-2 text-accent">
            <Wallet2 className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">
                {truncateAddress(wallet.address)}
              </h3>
              <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                {wallet.chain.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Agent wallet</p>
            <p className="font-mono text-xs text-muted-foreground mt-2 break-all">
              {wallet.address}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-foreground">{wallet.balance}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Created {formatDate(wallet.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
