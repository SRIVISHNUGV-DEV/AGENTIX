"use client"

import { useState, useEffect, useCallback } from "react"
import { Wallet, AlertCircle, CheckCircle, Loader2, Fuel, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWalletAction } from "@/lib/wallet-action"
import { truncateAddress } from "@/lib/utils"
import { getAddressExplorerUrl } from "@/lib/explorer"

const API_BASE_URL = process.env.NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL || "http://127.0.0.1:3001"

interface DepositGasPanelProps {
  walletAddress: string
  orgId?: number
}

/**
 * Panel for depositing ETH to the EntryPoint (Bundler)
 *
 * The owner wallet deposits ETH to the agent's smart account
 * to fund gas for transaction execution.
 *
 * Flow:
 * 1. Owner enters amount to deposit
 * 2. Owner signs the request with their wallet
 * 3. Backend calls depositToEntryPoint() on the AgentWallet contract
 * 4. Contract adds ETH to the EntryPoint balance for gas
 */
export function DepositGasPanel({ walletAddress, orgId }: DepositGasPanelProps) {
  const [amount, setAmount] = useState("0.01")
  const [isLoading, setIsLoading] = useState(false)
  const [balance, setBalance] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { post, isConnected, isSepolia } = useWalletAction()

  // Fetch current entrypoint balance
  const fetchBalance = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/wallets/${walletAddress}/entrypoint-balance`
      )
      if (response.ok) {
        const data = await response.json()
        setBalance(data.balance || "0")
      }
    } catch (err) {
      console.error("Failed to fetch entrypoint balance:", err)
    }
  }, [walletAddress])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount")
      return
    }

    if (!orgId) {
      setError("Organization ID required for signing")
      return
    }

    if (!isConnected) {
      setError("Please connect your wallet first")
      return
    }

    if (!isSepolia) {
      setError("Please switch to Sepolia network")
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await post(
        `${API_BASE_URL}/wallets/${walletAddress}/deposit-gas`,
        {
          action: "DEPOSIT_GAS",
          orgId,
          target: `wallet:${walletAddress}`,
        },
        { amount }
      )

      if (result.success) {
        setSuccess(`Deposited ${amount} ETH to EntryPoint for gas`)
        setBalance((prev) => {
          const prevBalance = parseFloat(prev || "0")
          return (prevBalance + parseFloat(amount)).toFixed(6)
        })
        setAmount("0.01")
      } else {
        setError(result.error || "Failed to deposit gas")
      }
    } catch (err) {
      setError("Failed to deposit gas")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2">
          <Fuel className="h-4 w-4 text-zinc-500" />
          Gas Deposit
        </h3>
        {balance !== null && (
          <span className="text-xs text-zinc-500">
            EntryPoint Balance: {parseFloat(balance).toFixed(4)} ETH
          </span>
        )}
      </div>

      {/* Info Banner */}
      <div className="mb-4 p-3 rounded bg-zinc-800/50 border border-zinc-700">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Deposit ETH to the EntryPoint (Bundler) to fund transaction execution.
          The agent wallet uses this balance to pay for gas when executing whitelisted transactions.
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Wallet Info */}
      <div className="mb-4 p-3 rounded bg-zinc-800/30 border border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Agent Wallet</p>
            <a
              href={getAddressExplorerUrl(walletAddress)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm text-zinc-300 hover:text-white hover:underline transition-colors flex items-center gap-1"
            >
              {truncateAddress(walletAddress, 16)}
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          </div>
          <Wallet className="h-5 w-5 text-zinc-600" />
        </div>
      </div>

      {/* Deposit Form */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            step="0.001"
            min="0.001"
            placeholder="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleDeposit()
              }
            }}
            className="bg-zinc-950 border-zinc-800 text-sm pr-16"
            suppressHydrationWarning
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
            ETH
          </span>
        </div>
        <Button
          onClick={handleDeposit}
          disabled={isLoading || !isConnected || !isSepolia}
          className="bg-white text-black hover:bg-zinc-200 min-w-[120px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Signing...
            </>
          ) : (
            <>
              <Fuel className="h-4 w-4 mr-2" />
              Deposit
            </>
          )}
        </Button>
      </div>

      {/* Quick Amount Buttons */}
      <div className="flex gap-2 mt-3">
        {["0.01", "0.05", "0.1", "0.5"].map((amt) => (
          <button
            key={amt}
            onClick={() => setAmount(amt)}
            className="px-2 py-1 text-xs font-medium rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            {amt} ETH
          </button>
        ))}
      </div>

      {/* Network Warning */}
      {!isSepolia && isConnected && (
        <div className="mt-4 p-3 rounded bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-sm text-amber-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Switch to Sepolia network to deposit
        </div>
      )}
    </div>
  )
}
