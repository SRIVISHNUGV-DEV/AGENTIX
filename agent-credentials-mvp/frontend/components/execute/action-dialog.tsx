"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Send, Layers, Wallet } from "lucide-react"
import { executeAgentAction, type SignaturePayload, type ChatMessageResult } from "@/lib/external-agents-api"
import type { QuickAction } from "./quick-actions"

interface ActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: QuickAction | null
  externalAgentId: number
  orgId: number
  walletAddress?: string
  signature?: SignaturePayload
  onComplete: (result: ChatMessageResult) => void
}

/**
 * Action Dialog
 *
 * Collects parameters for blockchain actions and executes them directly.
 * Bypasses chat - calls backend /execute endpoint with blockchain tool action.
 */
export function ActionDialog({
  open,
  onOpenChange,
  action,
  externalAgentId,
  orgId,
  walletAddress,
  signature,
  onComplete,
}: ActionDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state for send_transaction
  const [target, setTarget] = useState("")
  const [amount, setAmount] = useState("")

  // Form state for batch_transactions
  const [batchTargets, setBatchTargets] = useState("")
  const [batchAmount, setBatchAmount] = useState("")

  // Form state for deposit_gas
  const [depositAmount, setDepositAmount] = useState("0.1")

  const resetForm = () => {
    setTarget("")
    setAmount("")
    setBatchTargets("")
    setBatchAmount("")
    setDepositAmount("0.1")
    setError(null)
  }

  const handleSubmit = async () => {
    if (!action || !walletAddress) {
      setError("Missing action or wallet address")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      let params: Record<string, unknown> = {}

      switch (action.id) {
        case "send_transaction": {
          if (!target || !amount) {
            throw new Error("Target address and amount are required")
          }
          params = {
            walletAddress,
            target: target.trim(),
            valueWei: String(Math.floor(parseFloat(amount) * 1e18)), // Convert ETH to wei
          }
          break
        }

        case "batch_transactions": {
          if (!batchTargets || !batchAmount) {
            throw new Error("Target addresses and amount are required")
          }
          const addresses = batchTargets.split(",").map(a => a.trim()).filter(Boolean)
          if (addresses.length === 0) {
            throw new Error("At least one target address required")
          }
          params = {
            walletAddress,
            calls: addresses.map(addr => ({
              target: addr,
              valueWei: String(Math.floor(parseFloat(batchAmount) * 1e18)),
              data: "0x",
            })),
          }
          break
        }

        case "deposit_gas": {
          if (!depositAmount) {
            throw new Error("Amount is required")
          }
          params = {
            walletAddress,
            amount: depositAmount,
          }
          break
        }

        default:
          throw new Error(`Unknown action: ${action.id}`)
      }

      const result = await executeAgentAction(
        externalAgentId,
        action.id,
        params,
        orgId,
        signature
      )

      if (result.success) {
        resetForm()
        onOpenChange(false)
        onComplete(result)
      } else {
        setError(result.error || "Action failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsLoading(false)
    }
  }

  if (!action) return null

  // Custom action goes to chat
  if (action.id === "custom") {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action.id === "send_transaction" && <Send className="h-5 w-5" />}
            {action.id === "batch_transactions" && <Layers className="h-5 w-5" />}
            {action.id === "deposit_gas" && <Wallet className="h-5 w-5" />}
            {action.label}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {action.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Send Transaction Form */}
          {action.id === "send_transaction" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="target" className="text-zinc-300">Target Address</Label>
                <Input
                  id="target"
                  placeholder="0x..."
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount" className="text-zinc-300">Amount (ETH)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.001"
                  placeholder="0.1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
            </>
          )}

          {/* Batch Transactions Form */}
          {action.id === "batch_transactions" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="batch-targets" className="text-zinc-300">Target Addresses (comma-separated)</Label>
                <Input
                  id="batch-targets"
                  placeholder="0x..., 0x..."
                  value={batchTargets}
                  onChange={(e) => setBatchTargets(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-amount" className="text-zinc-300">Amount Per Address (ETH)</Label>
                <Input
                  id="batch-amount"
                  type="number"
                  step="0.001"
                  placeholder="0.05"
                  value={batchAmount}
                  onChange={(e) => setBatchAmount(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
            </>
          )}

          {/* Deposit Gas Form */}
          {action.id === "deposit_gas" && (
            <div className="space-y-2">
              <Label htmlFor="deposit-amount" className="text-zinc-300">Amount to Deposit (ETH)</Label>
              <Input
                id="deposit-amount"
                type="number"
                step="0.01"
                placeholder="0.1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                Deposits ETH to the EntryPoint contract for the agent wallet to pay gas fees.
              </p>
            </div>
          )}

          {/* Wallet Address Info */}
          <div className="text-xs text-zinc-500">
            From wallet: <code className="text-zinc-400">{walletAddress || "Not found"}</code>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => { resetForm(); onOpenChange(false) }}
              disabled={isLoading}
              className="border-zinc-700 bg-transparent hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !walletAddress}
              className="bg-white text-black hover:bg-zinc-200"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Execute
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
