'use client'

import { Button } from '@/components/ui/button'
import { useWallet } from './wallet-provider'
import { Loader2, Wallet, AlertTriangle, CheckCircle2, LogOut } from 'lucide-react'

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function ConnectWalletButton() {
  const {
    account,
    isConnected,
    isConnecting,
    isBaseSepolia,
    error,
    connect,
    disconnect,
    switchToBaseSepolia,
  } = useWallet()

  if (!isConnected) {
    return (
      <div className="flex items-center gap-3">
        {error ? (
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
            <AlertTriangle className="h-3 w-3" />
            <span className="hidden sm:inline">{error}</span>
          </div>
        ) : null}
        <Button
          className="rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          onClick={connect}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </>
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {!isBaseSepolia ? (
        <Button
          variant="outline"
          className="rounded-full border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
          onClick={switchToBaseSepolia}
        >
          <AlertTriangle className="mr-2 h-3 w-3" />
          Switch to Base Sepolia
        </Button>
      ) : (
        <div className="flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs text-green-400">
          <CheckCircle2 className="h-3 w-3" />
          <span className="hidden sm:inline">Connected</span>
        </div>
      )}
      <div className="hidden rounded-full border border-white/10 bg-card px-4 py-2 text-xs text-foreground/72 sm:block">
        {truncateAddress(account!)}
      </div>
      <Button
        variant="ghost"
        className="rounded-full text-foreground/65 hover:text-foreground"
        onClick={disconnect}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}
