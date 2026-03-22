'use client'

import { Button } from '@/components/ui/button'
import { useWallet } from './wallet-provider'

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function ConnectWalletButton() {
  const {
    account,
    isConnected,
    isConnecting,
    isSepolia,
    error,
    connect,
    disconnect,
    switchToSepolia,
  } = useWallet()

  if (!isConnected) {
    return (
      <div className="flex items-center gap-3">
        {error ? <span className="hidden text-xs text-amber-200 lg:inline">{error}</span> : null}
        <Button
          className="rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          onClick={connect}
          disabled={isConnecting}
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {!isSepolia ? (
        <Button
          variant="outline"
          className="rounded-full border-white/15 bg-card text-foreground hover:bg-white/5"
          onClick={switchToSepolia}
        >
          Switch to Sepolia
        </Button>
      ) : null}
      <div className="hidden rounded-full border border-white/10 bg-card px-4 py-2 text-xs text-foreground/72 sm:block">
        {truncateAddress(account!)}
      </div>
      <Button
        variant="ghost"
        className="rounded-full text-foreground/65 hover:text-foreground"
        onClick={disconnect}
      >
        Disconnect
      </Button>
    </div>
  )
}
