'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { getTxExplorerUrl, getAddressExplorerUrl } from '@/lib/explorer'

interface AgentActionsProps {
  agentId: string
  orgId: string
  hasCredential: boolean
  hasWallet: boolean
  defaultExpiry: number
  defaultPermissions: number
}

interface ActionResult {
  text: string
  txHash?: string
  walletAddress?: string
  sessionId?: string
  credentialId?: string
}

export function AgentActions({
  agentId,
  orgId,
  hasCredential,
  hasWallet,
  defaultExpiry,
  defaultPermissions,
}: AgentActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [permissions, setPermissions] = useState(String(defaultPermissions))
  const [expiry, setExpiry] = useState(String(defaultExpiry))
  const [fundAmount, setFundAmount] = useState('0.01')
  const [message, setMessage] = useState<ActionResult | null>(null)
  const [showRevokeModal, setShowRevokeModal] = useState(false)
  const [revokeConfirmText, setRevokeConfirmText] = useState('')
  const { account, signPlatformAction, isConnected, isBaseSepolia } = useWallet()
  const disabled = isPending || !isConnected || !isBaseSepolia

  const expiryDate = useMemo(() => {
    const asNumber = Number(expiry)
    return Number.isFinite(asNumber) ? new Date(asNumber * 1000).toISOString().slice(0, 10) : ''
  }, [expiry])

  const runAction = async (
    path: string,
    action: string,
    body?: Record<string, unknown>
  ) => {
    try {
      setMessage(null)
      const signaturePayload = await signPlatformAction({
        action,
        orgId: Number(orgId),
        target: `agent:${agentId}`,
      })
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(body ?? {}),
          ...signaturePayload,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? 'Request failed')
      }

      startTransition(() => {
        router.refresh()
      })

      // Build action result with all relevant info for Etherscan links
      const result: ActionResult = { text: 'Success' }
      if (payload.txHash) {
        result.text = 'Transaction submitted'
        result.txHash = payload.txHash
      }
      if (payload.walletAddress) {
        result.walletAddress = payload.walletAddress
      }
      if (payload.sessionId) {
        result.text = `Session created`
        result.sessionId = payload.sessionId
      }
      if (payload.credentialId) {
        result.credentialId = payload.credentialId
      }
      setMessage(result)
    } catch (error: any) {
      setMessage({ text: error.message ?? 'Request failed' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-card p-4">
          <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Permissions</label>
          <Input
            value={permissions}
            onChange={(event) => setPermissions(event.target.value)}
            className="mt-3 border-white/10 bg-background text-foreground"
          />
        </div>
        <div className="rounded-2xl border border-white/10 bg-card p-4">
          <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Credential expiry</label>
          <Input
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            className="mt-3 border-white/10 bg-background text-foreground"
          />
          <div className="mt-2 text-xs text-foreground/45">{expiryDate}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-card p-4">
          <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Fund amount</label>
          <Input
            value={fundAmount}
            onChange={(event) => setFundAmount(event.target.value)}
            className="mt-3 border-white/10 bg-background text-foreground"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Button
          disabled={disabled || hasCredential}
          className="rounded-2xl bg-primary px-5 py-5 text-primary-foreground hover:bg-primary/90"
          onClick={() =>
            runAction(`/api/platform/agents/${agentId}/credential`, 'ISSUE_CREDENTIAL', {
              permissions: Number(permissions),
              expiry: Number(expiry),
            })
          }
        >
          {hasCredential ? 'Credential already issued' : 'Create credential'}
        </Button>
        <Button
          disabled={disabled || !hasCredential}
          variant="outline"
          className="rounded-2xl border-white/15 bg-transparent px-5 py-5 text-foreground hover:bg-white/5"
          onClick={() =>
            runAction(`/api/platform/agents/${agentId}/session`, 'CREATE_SESSION', {
              maxValue: Number(permissions),
            })
          }
        >
          Create session
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          className="rounded-2xl border-white/15 bg-transparent px-5 py-5 text-foreground hover:bg-white/5"
          onClick={() =>
            runAction(`/api/platform/agents/${agentId}/wallet`, 'CREATE_WALLET', {
              ownerAddress: account,
            })
          }
        >
          {hasWallet ? 'Add another wallet' : 'Create wallet'}
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          className="rounded-2xl border-white/15 bg-transparent px-5 py-5 text-foreground hover:bg-white/5"
          onClick={() =>
            runAction(`/api/platform/agents/${agentId}/fund`, 'FUND_AGENT', { amountEth: fundAmount })
          }
        >
          Fund this agent
        </Button>
      </div>

      <Button
        disabled={disabled || !hasCredential}
        variant="destructive"
        className="rounded-2xl px-5"
        onClick={() => {
          setShowRevokeModal(true)
          setRevokeConfirmText('')
        }}
      >
        Revoke credential
      </Button>
      {!isConnected || !isBaseSepolia ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground/60">
          Connect the org owner wallet on Base Sepolia. Every action here asks for a fresh signature before the backend submits an on-chain transaction.
        </div>
      ) : null}

      {/* Revoke Confirmation Modal */}
      {showRevokeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 p-6">
            <h3 className="text-lg font-semibold">Revoke Credential</h3>
            <p className="mt-2 text-sm text-foreground/60">
              This action cannot be undone. Type <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs">confirm</code> to proceed.
            </p>
            <Input
              value={revokeConfirmText}
              onChange={(e) => setRevokeConfirmText(e.target.value)}
              placeholder='Type "confirm"'
              className="mt-4 border-white/10 bg-background text-foreground"
              suppressHydrationWarning
            />
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                className="flex-1 rounded-lg border-white/15 bg-transparent"
                onClick={() => setShowRevokeModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1 rounded-lg"
                disabled={revokeConfirmText !== 'confirm' || isPending}
                onClick={() => {
                  setShowRevokeModal(false)
                  runAction(`/api/platform/agents/${agentId}/revoke`, 'REVOKE_CREDENTIAL')
                }}
              >
                {isPending ? 'Revoking...' : 'Revoke'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground">
          <div className="font-medium">{message.text}</div>
          {message.txHash ? (
            <div className="mt-2">
              <span className="text-foreground/60">Tx: </span>
              <a
                href={getTxExplorerUrl(message.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline decoration-white/20 underline-offset-4 hover:text-foreground/80"
              >
                {message.txHash.slice(0, 10)}...{message.txHash.slice(-8)}
              </a>
            </div>
          ) : null}
          {message.walletAddress ? (
            <div className="mt-2">
              <span className="text-foreground/60">Wallet: </span>
              <a
                href={getAddressExplorerUrl(message.walletAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline decoration-white/20 underline-offset-4 hover:text-foreground/80"
              >
                {message.walletAddress.slice(0, 10)}...{message.walletAddress.slice(-8)}
              </a>
            </div>
          ) : null}
          {message.sessionId ? (
            <div className="mt-1 text-foreground/60">Session ID: {message.sessionId}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
