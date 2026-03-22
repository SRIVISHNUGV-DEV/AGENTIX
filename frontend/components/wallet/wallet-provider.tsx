'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { buildSignedActionMessage } from '@/lib/signed-actions'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on?: (event: string, listener: (...args: unknown[]) => void) => void
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
    }
  }
}

const SEPOLIA_CHAIN_ID = 11155111

type WalletContextValue = {
  account: string | null
  chainId: number | null
  isConnected: boolean
  isSepolia: boolean
  isConnecting: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchToSepolia: () => Promise<void>
  signPlatformAction: (input: { action: string; orgId: number; target: string }) => Promise<{
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  }>
}

const WalletContext = createContext<WalletContextValue | null>(null)

function parseChainId(value: unknown) {
  if (typeof value === 'string') {
    return Number.parseInt(value, 16)
  }

  if (typeof value === 'number') {
    return value
  }

  return null
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) {
      return
    }

    let mounted = true

    const syncWallet = async () => {
      try {
        const [accounts, activeChainId] = await Promise.all([
          window.ethereum!.request({ method: 'eth_accounts' }) as Promise<string[]>,
          window.ethereum!.request({ method: 'eth_chainId' }),
        ])

        if (!mounted) return

        setAccount(accounts[0] ?? null)
        setChainId(parseChainId(activeChainId))
      } catch (walletError: any) {
        if (!mounted) return
        setError(walletError?.message ?? 'Failed to read wallet state')
      }
    }

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : []
      setAccount(nextAccounts[0] ?? null)
    }

    const handleChainChanged = (nextChainId: unknown) => {
      setChainId(parseChainId(nextChainId))
    }

    syncWallet()
    window.ethereum.on?.('accountsChanged', handleAccountsChanged)
    window.ethereum.on?.('chainChanged', handleChainChanged)

    return () => {
      mounted = false
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  const connect = async () => {
    if (!window.ethereum) {
      setError('No injected wallet found. Install MetaMask or another EVM wallet.')
      return
    }

    try {
      setIsConnecting(true)
      setError(null)
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[]
      const activeChainId = await window.ethereum.request({ method: 'eth_chainId' })
      setAccount(accounts[0] ?? null)
      setChainId(parseChainId(activeChainId))
    } catch (walletError: any) {
      setError(walletError?.message ?? 'Wallet connection failed')
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnect = () => {
    setAccount(null)
    setError(null)
  }

  const switchToSepolia = async () => {
    if (!window.ethereum) {
      setError('No injected wallet found.')
      return
    }

    try {
      setError(null)
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      })
      setChainId(SEPOLIA_CHAIN_ID)
    } catch (walletError: any) {
      setError(walletError?.message ?? 'Failed to switch to Sepolia')
    }
  }

  const signPlatformAction = async ({
    action,
    orgId,
    target,
  }: {
    action: string
    orgId: number
    target: string
  }) => {
    if (!window.ethereum || !account) {
      throw new Error('Connect a wallet first')
    }

    const nonce =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const requestedAt = Math.floor(Date.now() / 1000)
    const message = buildSignedActionMessage({
      action,
      orgId,
      target,
      walletAddress: account,
      nonce,
      requestedAt,
    })

    const signature = (await window.ethereum.request({
      method: 'personal_sign',
      params: [message, account],
    })) as string

    return {
      walletAddress: account,
      signature,
      nonce,
      requestedAt,
    }
  }

  const value = useMemo(
    () => ({
      account,
      chainId,
      isConnected: Boolean(account),
      isSepolia: chainId === SEPOLIA_CHAIN_ID,
      isConnecting,
      error,
      connect,
      disconnect,
      switchToSepolia,
      signPlatformAction,
    }),
    [account, chainId, error, isConnecting, signPlatformAction]
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider')
  }

  return context
}
