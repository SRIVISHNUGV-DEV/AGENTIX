'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { getTxExplorerUrl, getAddressExplorerUrl } from '@/lib/explorer'

interface TransferResult {
  txHash: string
  to: string
  amountEth: string
  agentId?: number
}

interface ContractResult {
  verifierAddress?: string
  credentialRegistryAddress?: string
  sessionManagerAddress?: string
  agentWalletFactoryAddress?: string
  agentWalletImplementationAddress?: string
  deploymentTxHashes?: Record<string, string>
}

interface ActionResult {
  text: string
  txHash?: string
  txHashes?: string[]
  contracts?: ContractResult
  transfers?: TransferResult[]
}

interface OrgActionsProps {
  orgId: string
}

export function OrgActions({ orgId }: OrgActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [amountEth, setAmountEth] = useState('0.01')
  const [result, setResult] = useState<ActionResult | null>(null)
  const { signPlatformAction, isConnected, isBaseSepolia } = useWallet()
  const disabled = isPending || !isConnected || !isBaseSepolia

  const runAction = async (
    method: 'POST' | 'DELETE',
    path: string,
    action: string,
    target: string,
    body?: Record<string, unknown>
  ) => {
    try {
      setResult(null)
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

      // Handle deploy contracts response
      if (payload.contracts) {
        const contracts = payload.contracts as ContractResult
        const txHashes = contracts.deploymentTxHashes
          ? Object.values(contracts.deploymentTxHashes).filter(Boolean)
          : []
        setResult({
          text: 'Contracts deployed successfully',
          txHashes,
          contracts,
        })
        return
      }

      // Handle fund org response
      if (payload.transfers) {
        const txHashes = (payload.transfers as TransferResult[]).map(t => t.txHash).filter(Boolean)
        setResult({
          text: 'Funding completed',
          txHashes,
          transfers: payload.transfers as TransferResult[],
        })
        return
      }

      // Handle other responses
      setResult({
        text: payload.txHash ? 'Transaction submitted' : 'Success',
        txHash: payload.txHash,
      })
    } catch (error: any) {
      setResult({ text: error.message ?? 'Request failed' })
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

      {!isConnected || !isBaseSepolia ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground/60">
          Connect the owner wallet on Base Sepolia. Every on-chain action requires a fresh wallet signature.
        </div>
      ) : null}
      {result ? (
        <div className="space-y-4">
          {/* Status message */}
          <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground">
            <div className="font-medium">{result.text}</div>
          </div>

          {/* Deployed contracts section */}
          {result.contracts ? (
            <div className="rounded-2xl border border-white/10 bg-card p-4">
              <div className="text-sm font-medium text-foreground mb-3">Deployed Contracts</div>
              <div className="space-y-2 text-xs font-mono">
                {result.contracts.verifierAddress ? (
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/55">Verifier:</span>
                    <a
                      href={getAddressExplorerUrl(result.contracts.verifierAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {result.contracts.verifierAddress.slice(0, 10)}...{result.contracts.verifierAddress.slice(-8)}
                    </a>
                  </div>
                ) : null}
                {result.contracts.credentialRegistryAddress ? (
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/55">CredentialRegistry:</span>
                    <a
                      href={getAddressExplorerUrl(result.contracts.credentialRegistryAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {result.contracts.credentialRegistryAddress.slice(0, 10)}...{result.contracts.credentialRegistryAddress.slice(-8)}
                    </a>
                  </div>
                ) : null}
                {result.contracts.sessionManagerAddress ? (
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/55">SessionManager:</span>
                    <a
                      href={getAddressExplorerUrl(result.contracts.sessionManagerAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {result.contracts.sessionManagerAddress.slice(0, 10)}...{result.contracts.sessionManagerAddress.slice(-8)}
                    </a>
                  </div>
                ) : null}
                {result.contracts.agentWalletFactoryAddress ? (
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/55">AgentWalletFactory:</span>
                    <a
                      href={getAddressExplorerUrl(result.contracts.agentWalletFactoryAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {result.contracts.agentWalletFactoryAddress.slice(0, 10)}...{result.contracts.agentWalletFactoryAddress.slice(-8)}
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Funding transfers section */}
          {result.transfers && result.transfers.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-card p-4">
              <div className="text-sm font-medium text-foreground mb-3">Funding Transfers</div>
              <div className="space-y-3">
                {result.transfers.map((transfer, idx) => (
                  <div key={transfer.txHash || idx} className="flex flex-col gap-1 rounded-lg bg-background/50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-foreground/55">Amount:</span>
                      <span className="font-mono text-sm">{transfer.amountEth} ETH</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-foreground/55">To:</span>
                      <a
                        href={getAddressExplorerUrl(transfer.to)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {transfer.to.slice(0, 10)}...{transfer.to.slice(-8)}
                      </a>
                    </div>
                    {transfer.txHash ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground/55">Tx:</span>
                        <a
                          href={getTxExplorerUrl(transfer.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {transfer.txHash.slice(0, 10)}...{transfer.txHash.slice(-8)}
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Transaction hashes section */}
          {result.txHashes && result.txHashes.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-card p-4">
              <div className="text-sm font-medium text-foreground mb-3">Deployment Transactions</div>
              <div className="space-y-2">
                {result.txHashes.map((txHash, idx) => (
                  <a
                    key={txHash}
                    href={getTxExplorerUrl(txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg bg-background/50 p-2 hover:bg-background/80 transition-colors"
                  >
                    <span className="text-xs text-foreground/55">Tx {idx + 1}:</span>
                    <span className="font-mono text-xs text-primary">
                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                    </span>
                    <svg className="w-3 h-3 text-foreground/40 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {/* Single tx hash (fallback) */}
          {result.txHash && !result.txHashes ? (
            <div className="rounded-2xl border border-white/10 bg-card p-4">
              <a
                href={getTxExplorerUrl(result.txHash)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 font-mono text-xs text-primary hover:underline"
              >
                View transaction on Etherscan
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
