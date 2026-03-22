'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { getTxExplorerUrl } from '@/lib/explorer'

interface OrgActionsProps {
  orgId: string
}

export function OrgActions({ orgId }: OrgActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [amountEth, setAmountEth] = useState('0.01')
  const [message, setMessage] = useState<{ text: string; txHash?: string } | null>(null)
  const { signPlatformAction, isConnected, isSepolia } = useWallet()
  const disabled = isPending || !isConnected || !isSepolia

  const runAction = async (
    method: 'POST' | 'DELETE',
    path: string,
    action: string,
    target: string,
    body?: Record<string, unknown>
  ) => {
    try {
      setMessage(null)
      const signaturePayload = await signPlatformAction({
        action,
        orgId: Number(orgId),
        target,
      })
      const response = await fetch(path, {
        method,
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
        if (method === 'DELETE') {
          router.push('/dashboard')
        }
        router.refresh()
      })

      setMessage(
        payload.txHash
          ? { text: 'Transaction submitted', txHash: payload.txHash }
          : payload.transfers
            ? { text: 'Bulk funding submitted' }
            : method === 'DELETE'
              ? { text: 'Organization removed from this platform workspace' }
              : { text: 'Success' }
      )
    } catch (error: any) {
      setMessage({ text: error.message ?? 'Request failed' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto]">
        <div className="rounded-2xl border border-white/10 bg-card p-4">
          <label className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">Bulk funding amount</label>
          <Input
            value={amountEth}
            onChange={(event) => setAmountEth(event.target.value)}
            className="mt-3 border-white/10 bg-background text-foreground"
            placeholder="0.01"
          />
        </div>
        <Button
          disabled={disabled}
          className="h-auto rounded-2xl bg-primary px-6 py-4 text-primary-foreground hover:bg-primary/90"
          onClick={() =>
            runAction('POST', `/api/platform/orgs/${orgId}/deploy`, 'DEPLOY_CONTRACTS', `org:${orgId}`)
          }
        >
          Deploy contracts
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          className="h-auto rounded-2xl border-white/15 bg-transparent px-6 py-4 text-foreground hover:bg-white/5"
          onClick={() =>
            runAction('POST', `/api/platform/orgs/${orgId}/fund`, 'FUND_ORG', `org:${orgId}`, {
              amountEth,
            })
          }
        >
          Fund all wallets
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card p-4">
        <div>
          <div className="text-sm font-medium text-foreground">Danger zone</div>
          <div className="mt-1 text-sm text-foreground/55">
            Remove this organization from the platform database. On-chain contracts stay deployed.
          </div>
        </div>
        <Button
          disabled={disabled}
          variant="outline"
          className="rounded-full border-white/15 bg-transparent text-foreground hover:bg-white/5"
          onClick={() =>
            runAction('DELETE', `/api/platform/orgs/${orgId}`, 'DELETE_ORG', `org:${orgId}`)
          }
        >
          Remove organization
        </Button>
      </div>

      {!isConnected || !isSepolia ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground/60">
          Connect the owner wallet on Sepolia. Every on-chain action requires a fresh wallet signature.
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
