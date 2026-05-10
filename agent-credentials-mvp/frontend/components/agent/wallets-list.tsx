'use client'

import { Wallet } from '@/lib/types'
import { truncateAddress, formatDate } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Coins, ArrowUpRight } from 'lucide-react'
import { getAddressExplorerUrl } from '@/lib/explorer'

interface WalletsListProps {
  wallets: Wallet[]
}

const getChainColor = (chain: string) => {
  const colors: Record<string, string> = {
    ethereum: 'bg-blue-100 text-blue-800',
    polygon: 'bg-purple-100 text-purple-800',
    arbitrum: 'bg-cyan-100 text-cyan-800',
    base: 'bg-orange-100 text-orange-800',
  }
  return colors[chain] || 'bg-gray-100 text-gray-800'
}

export function WalletsList({ wallets }: WalletsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Coins className="h-5 w-5" />
          Wallets
        </CardTitle>
        <CardDescription>{wallets.length} wallet(s) registered</CardDescription>
      </CardHeader>
      <CardContent>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wallets registered yet</p>
        ) : (
          <div className="space-y-4">
            {wallets.map(wallet => (
              <div
                key={wallet.id}
                className="flex items-start justify-between rounded-lg border border-border p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <a
                      href={getAddressExplorerUrl(wallet.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-sm font-medium text-foreground underline decoration-white/15 underline-offset-4 hover:text-foreground/75"
                    >
                      {truncateAddress(wallet.address)}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                    <span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${getChainColor(wallet.chain)}`}>
                      {wallet.chain.charAt(0).toUpperCase() + wallet.chain.slice(1)}
                    </span>
                    {wallet.walletKind ? (
                      <span className="inline-block rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-foreground/60">
                        {wallet.walletKind}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <span className="font-semibold">Balance:</span>{' '}
                      <span className="font-mono text-foreground">{wallet.balance}</span>
                    </div>
                    {wallet.entryPointAddress ? (
                      <div>
                        <span className="font-semibold">EntryPoint:</span>{' '}
                        <span className="font-mono text-foreground">{truncateAddress(wallet.entryPointAddress)}</span>
                      </div>
                    ) : null}
                    {wallet.ownerAddress ? (
                      <div>
                        <span className="font-semibold">Owner:</span>{' '}
                        <span className="font-mono text-foreground">{truncateAddress(wallet.ownerAddress)}</span>
                      </div>
                    ) : null}
                    <div className="flex gap-4">
                      <div>
                        <span className="font-semibold">Created:</span> {formatDate(wallet.createdAt)}
                      </div>
                      {wallet.lastUsed && (
                        <div>
                          <span className="font-semibold">Last Used:</span> {formatDate(wallet.lastUsed)}
                        </div>
                      )}
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
