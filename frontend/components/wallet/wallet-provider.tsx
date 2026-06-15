'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { buildSignedActionMessage } from '@/lib/signed-actions'

interface Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

interface EIP6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo
  provider: Provider
}

type EIP6963AnnounceProviderEvent = CustomEvent<EIP6963ProviderDetail>

declare global {
  interface Window {
    ethereum?: Provider
  }
}

const CHAIN_ID = 84532

type WalletContextValue = {
  account: string | null
  chainId: number | null
  isConnected: boolean
  isBaseSepolia: boolean
  isConnecting: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchToBaseSepolia: () => Promise<void>
  signMessage: (message: string) => Promise<string>
  signPlatformAction: (input: { action: string; orgId: number; target: string }) => Promise<{
    walletAddress: string
    signature: string
    nonce: string
    requestedAt: number
  }>
  sendTransaction: (to: string, valueWei: string) => Promise<string>
  depositToAgent: (agentWalletAddress: string, amountEth: string) => Promise<string>
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

function isMetaMaskNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const msg = String((err as any).message ?? (err as any).code ?? '')
  return msg.includes('MetaMask extension not found') || msg.includes('extension not found')
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providerRef = useRef<Provider | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const found: Provider[] = []

    const handleAnnouncement = (event: EIP6963AnnounceProviderEvent) => {
      found.push(event.detail.provider)
      if (!providerRef.current) {
        providerRef.current = event.detail.provider
      }
    }

    window.addEventListener('eip6963:announceProvider', handleAnnouncement as EventListener)
    window.dispatchEvent(new Event('eip6963:requestProvider'))

    setTimeout(() => {
      if (!providerRef.current && window.ethereum) {
        providerRef.current = window.ethereum
      }

      if (providerRef.current) {
        syncWallet(providerRef.current)
      }
    }, 300)

    let mounted = true

    const syncWallet = async (provider: Provider) => {
      try {
        const [accounts, activeChainId] = await Promise.all([
          provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
          provider.request({ method: 'eth_chainId' }),
        ])

        if (!mounted) return

        setAccount(accounts[0] ?? null)
        setChainId(parseChainId(activeChainId))
      } catch (walletError: any) {
        if (!mounted) return
        if (!isMetaMaskNotFoundError(walletError)) {
          setError(walletError?.message ?? 'Failed to read wallet state')
        }
      }
    }

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : []
      setAccount(nextAccounts[0] ?? null)
    }

    const handleChainChanged = (nextChainId: unknown) => {
      setChainId(parseChainId(nextChainId))
    }

    if (providerRef.current) {
      providerRef.current.on?.('accountsChanged', handleAccountsChanged)
      providerRef.current.on?.('chainChanged', handleChainChanged)
    }

    return () => {
      mounted = false
      window.removeEventListener('eip6963:announceProvider', handleAnnouncement as EventListener)
      providerRef.current?.removeListener?.('accountsChanged', handleAccountsChanged)
      providerRef.current?.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  const getProvider = (): Provider => {
    if (providerRef.current) return providerRef.current
    if (typeof window !== 'undefined' && window.ethereum) {
      providerRef.current = window.ethereum
      return window.ethereum
    }
    throw new Error('No injected wallet found. Install MetaMask or another EVM wallet.')
  }

  const connect = async () => {
    try {
      setIsConnecting(true)
      setError(null)
      const provider = getProvider()
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[]
      const activeChainId = await provider.request({ method: 'eth_chainId' })
      setAccount(accounts[0] ?? null)
      setChainId(parseChainId(activeChainId))
    } catch (walletError: any) {
      if (isMetaMaskNotFoundError(walletError)) {
        setError('MetaMask is installed but not responding. Please unlock MetaMask or refresh the page.')
      } else {
        setError(walletError?.message ?? 'Wallet connection failed')
      }
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnect = () => {
    setAccount(null)
    setError(null)
  }

  const switchToBaseSepolia = async () => {
    try {
      setError(null)
      const provider = getProvider()
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x14a34' }],
      })
      setChainId(CHAIN_ID)
    } catch (walletError: any) {
      setError(walletError?.message ?? 'Failed to switch to Base Sepolia')
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
    const provider = getProvider()
    if (!account) {
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

    const signature = (await provider.request({
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

  const signMessage = async (message: string) => {
    const provider = getProvider()
    if (!account) {
      throw new Error('Connect a wallet first')
    }

    const signature = (await provider.request({
      method: 'personal_sign',
      params: [message, account],
    })) as string

    return signature
  }

  const sendTransaction = async (to: string, valueWei: string): Promise<string> => {
    const provider = getProvider()
    if (!account) {
      throw new Error('Connect a wallet first')
    }

    const txHash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: account,
        to,
        value: '0x' + BigInt(valueWei).toString(16),
      }],
    })) as string

    return txHash
  }

  const depositToAgent = async (agentWalletAddress: string, amountEth: string): Promise<string> => {
    const valueWei = BigInt(Math.floor(parseFloat(amountEth) * 10 ** 18)).toString()
    return sendTransaction(agentWalletAddress, valueWei)
  }

  const value = useMemo(
    () => ({
      account,
      chainId,
      isConnected: Boolean(account),
      isBaseSepolia: chainId === CHAIN_ID,
      isConnecting,
      error,
      connect,
      disconnect,
      switchToBaseSepolia,
      signMessage,
      signPlatformAction,
      sendTransaction,
      depositToAgent,
    }),
    [account, chainId, error, isConnecting, signMessage, signPlatformAction, sendTransaction, depositToAgent]
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
