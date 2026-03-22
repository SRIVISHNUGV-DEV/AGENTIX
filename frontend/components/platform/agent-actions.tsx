'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { getTxExplorerUrl } from '@/lib/explorer'

interface AgentActionsProps {
  agentId: string
  orgId: string
  hasCredential: boolean
  hasWallet: boolean
  defaultExpiry: number
  defaultPermissions: number
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
  const [message, setMessage] = useState<{ text: string; txHash?: string } | null>(null)
  const { account, signPlatformAction, isConnected, isSepolia } = useWallet()
  const disabled = isPending || !isConnected || !isSepolia

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

      setMessage(
        payload.txHash
          ? { text: 'Transaction submitted', txHash: payload.txHash }
          : payload.sessionId
            ? { text: `Session created: ${payload.sessionId}` }
            : { text: 'Success' }
      )
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
        onClick={() => runAction(`/api/platform/agents/${agentId}/revoke`, 'REVOKE_CREDENTIAL')}
      >
        Revoke credential
      </Button>
      {!isConnected || !isSepolia ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground/60">
          Connect the org owner wallet on Sepolia. Every action here asks for a fresh signature before the backend submits an on-chain transaction.
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground">
          <div>{message.text}</div>
          {message.txHash ? (
            <a
              href={getTxExplorerUrl(message.txHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-xs underline decoration-white/20 underline-offset-4 hover:text-foreground/80"
            >
              View on Etherscan
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
