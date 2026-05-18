"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Trash2, Shield, AlertCircle, CheckCircle, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getWalletWhitelist } from "@/lib/mock-api"
import { useWalletAction } from "@/lib/wallet-action"
import { truncateAddress } from "@/lib/utils"
import { getAddressExplorerUrl } from "@/lib/explorer"

const API_BASE_URL = process.env.NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL || "http://127.0.0.1:3001"

interface WhitelistPanelProps {
  walletAddress: string
  orgId?: number
}

export function WhitelistPanel({ walletAddress, orgId }: WhitelistPanelProps) {
  const [whitelist, setWhitelist] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newAddress, setNewAddress] = useState("")
  const [pendingAddresses, setPendingAddresses] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const { post, del, isConnected, isSepolia } = useWalletAction()

  const fetchWhitelist = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await getWalletWhitelist(walletAddress)
      if (response.success) {
        setWhitelist(response.data.whitelistedParties)
      } else {
        setError("Failed to load whitelist")
      }
    } catch (err) {
      setError("Failed to load whitelist")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress])

  useEffect(() => {
    fetchWhitelist()
  }, [fetchWhitelist])

  const isValidAddress = (addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr)

  const handleAddPending = () => {
    if (!newAddress || !isValidAddress(newAddress)) {
      setError("Please enter a valid Ethereum address")
      return
    }

    if (whitelist.includes(newAddress) || pendingAddresses.includes(newAddress)) {
      setError("Address already in whitelist or pending")
      return
    }

    setPendingAddresses([...pendingAddresses, newAddress])
    setNewAddress("")
    setError(null)
  }

  const handleRemovePending = (addr: string) => {
    setPendingAddresses(pendingAddresses.filter((a) => a !== addr))
  }

  const handleRemoveFromWhitelist = async (party: string) => {
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

    // Add to pending as "to be removed"
    setWhitelist(whitelist.filter(a => a !== party))

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await post(
        `${API_BASE_URL}/wallets/${walletAddress}/whitelist/batch`,
        {
          action: "BATCH_WHITELIST",
          orgId,
          target: `wallet:${walletAddress}`,
        },
        { parties: [party], statuses: [false] }
      )

      if (result.success) {
        setSuccess(`Removed ${truncateAddress(party)} from whitelist`)
      } else {
        setError(result.error || "Failed to remove address from whitelist")
        fetchWhitelist() // Revert on failure
      }
    } catch (err) {
      setError("Failed to remove address from whitelist")
      console.error(err)
      fetchWhitelist()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitAll = async () => {
    if (pendingAddresses.length === 0) {
      setError("No addresses to add")
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

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await post(
        `${API_BASE_URL}/wallets/${walletAddress}/whitelist/batch`,
        {
          action: "BATCH_WHITELIST",
          orgId,
          target: `wallet:${walletAddress}`,
        },
        { parties: pendingAddresses, statuses: pendingAddresses.map(() => true) }
      )

      if (result.success) {
        setWhitelist([...whitelist, ...pendingAddresses])
        setPendingAddresses([])
        setSuccess(`Added ${pendingAddresses.length} address${pendingAddresses.length > 1 ? "es" : ""} to whitelist`)
      } else {
        setError(result.error || "Failed to add addresses to whitelist")
      }
    } catch (err) {
      setError("Failed to add addresses to whitelist")
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalAddresses = whitelist.length + pendingAddresses.length

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2">
          <Shield className="h-4 w-4 text-zinc-500" />
          Whitelist
        </h3>
        <span className="text-xs text-zinc-500">
          {totalAddresses} address{totalAddresses !== 1 ? "es" : ""}
          {pendingAddresses.length > 0 && ` (${pendingAddresses.length} pending)`}
        </span>
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

      {/* Add New Address */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="0x... address to whitelist"
          value={newAddress}
          onChange={(e) => {
            setNewAddress(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              handleAddPending()
            }
          }}
          className={`bg-zinc-950 border-zinc-800 font-mono text-sm ${
            newAddress && !isValidAddress(newAddress) ? "border-red-500" : ""
          }`}
          suppressHydrationWarning
        />
        <Button
          onClick={handleAddPending}
          disabled={!newAddress || !isValidAddress(newAddress)}
          variant="outline"
          className="border-zinc-700"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Pending Addresses */}
      {pendingAddresses.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Pending</p>
          {pendingAddresses.map((addr) => (
            <div
              key={addr}
              className="flex items-center justify-between py-2 px-3 rounded bg-amber-500/10 border border-amber-500/20"
            >
              <span className="font-mono text-sm text-amber-400">
                {truncateAddress(addr, 16)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400"
                onClick={() => handleRemovePending(addr)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            onClick={handleSubmitAll}
            disabled={isSubmitting}
            className="w-full bg-white text-black hover:bg-zinc-200 mt-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Signing...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit All ({pendingAddresses.length})
              </>
            )}
          </Button>
        </div>
      )}

      {/* Existing Whitelist */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : whitelist.length === 0 && pendingAddresses.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-zinc-800 rounded">
          <Shield className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
          <p className="text-sm text-zinc-500">No whitelisted addresses</p>
          <p className="text-xs text-zinc-600 mt-1">
            Add addresses that this agent wallet can send transactions to
          </p>
        </div>
      ) : whitelist.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Active</p>
          {whitelist.map((party) => (
            <div
              key={party}
              className="flex items-center justify-between py-2 px-3 rounded bg-zinc-800/50 group"
            >
              <a
                href={getAddressExplorerUrl(party)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-zinc-300 hover:text-white hover:underline transition-colors"
              >
                {truncateAddress(party, 16)}
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemoveFromWhitelist(party)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-600 mt-4">
        The agent wallet can only send transactions to whitelisted addresses.
        This is enforced by the smart contract.
      </p>
    </div>
  )
}
