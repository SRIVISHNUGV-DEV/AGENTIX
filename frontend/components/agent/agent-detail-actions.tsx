'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { getTxExplorerUrl } from '@/lib/explorer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ShieldCheck, Wallet, Banknote, KeyRound, XCircle, Loader2 } from 'lucide-react'

interface AgentDetailActionsProps {
  agentId: string
  orgId: string
  hasCredential: boolean
  hasWallet: boolean
  defaultExpiry: number
  defaultPermissions: number
}

type ActionStatus = 'idle' | 'loading' | 'success' | 'error'

export function AgentDetailActions({
  agentId,
  orgId,
  hasCredential,
  hasWallet,
  defaultExpiry,
  defaultPermissions,
}: AgentDetailActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [credentialOpen, setCredentialOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [fundOpen, setFundOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)

  const [permissions, setPermissions] = useState(String(defaultPermissions))
  const [expiry, setExpiry] = useState(String(defaultExpiry))
  const [fundAmount, setFundAmount] = useState('0.01')
  const [maxValue, setMaxValue] = useState(String(defaultPermissions))
  const [sessionExpiry, setSessionExpiry] = useState(
    String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60)
  )
  const [ownerAddress, setOwnerAddress] = useState('')

  const [credentialStatus, setCredentialStatus] = useState<ActionStatus>('idle')
  const [sessionStatus, setSessionStatus] = useState<ActionStatus>('idle')
  const [walletStatus, setWalletStatus] = useState<ActionStatus>('idle')
  const [fundStatus, setFundStatus] = useState<ActionStatus>('idle')
  const [revokeStatus, setRevokeStatus] = useState<ActionStatus>('idle')

  const [result, setResult] = useState<{ text: string; txHash?: string } | null>(null)

  const { account, signPlatformAction, isConnected, isBaseSepolia } = useWallet()
  const disabled = !isConnected || !isBaseSepolia
  const effectiveOwnerAddress = ownerAddress || account || ''

  const expiryDate = new Date(Number(expiry) * 1000)
  const sessionExpiryDate = new Date(Number(sessionExpiry) * 1000)

  const runAction = async (
    action: string,
    endpoint: string,
    body: Record<string, unknown>,
    setStatus: (status: ActionStatus) => void
  ) => {
    if (disabled) return

    setStatus('loading')
    setResult(null)

    try {
      const signaturePayload = await signPlatformAction({
        action,
        orgId: Number(orgId),
        target: `agent:${agentId}`,
      })

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          ...signaturePayload,
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error((payload as { error?: string }).error ?? 'Request failed')
      }

      setStatus('success')
      const txHash = (payload as { txHash?: string }).txHash
      setResult(
        txHash
          ? { text: 'Transaction submitted', txHash }
          : { text: `Success: ${(payload as { sessionId?: string }).sessionId}` }
      )

      startTransition(() => {
        router.refresh()
      })
    } catch (error: unknown) {
      setStatus('error')
      const err = error as Error
      setResult({ text: err.message ?? 'Request failed' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Dialog open={credentialOpen} onOpenChange={setCredentialOpen}>
          <DialogTrigger asChild>
            <Button
              disabled={disabled || hasCredential}
              className="rounded-full bg-primary px-5"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              {hasCredential ? 'Credential Issued' : 'Issue Credential'}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue Credential</DialogTitle>
              <DialogDescription>
                Grant this agent a zero-knowledge credential for session authentication.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Permissions</Label>
                <Input
                  value={permissions}
                  onChange={(e) => setPermissions(e.target.value)}
                  placeholder="7"
                />
                <p className="text-xs text-foreground/50">
                  Bitmask for permissions (e.g., 7 = read + write + execute)
                </p>
              </div>
              <div className="space-y-2">
                <Label>Expiry (Unix timestamp)</Label>
                <Input
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder={String(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)}
                />
                <p className="text-xs text-foreground/50">
                  Expires: {expiryDate.toLocaleDateString()}
                </p>
              </div>
              {credentialStatus === 'loading' && (
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting transaction...
                </div>
              )}
              {result && credentialStatus === 'success' && (
                <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400">
                  {result.text}
                  {result.txHash && (
                    <a
                      href={getTxExplorerUrl(result.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 underline"
                    >
                      View on Etherscan
                    </a>
                  )}
                </div>
              )}
              {result && credentialStatus === 'error' && (
                <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{result.text}</div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setCredentialOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={credentialStatus === 'loading'}
                onClick={() =>
                  runAction(
                    'ISSUE_CREDENTIAL',
                    `/api/platform/agents/${agentId}/credential`,
                    { permissions: Number(permissions), expiry: Number(expiry) },
                    setCredentialStatus
                  )
                }
              >
                {credentialStatus === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Issue Credential
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
          <DialogTrigger asChild>
            <Button
              disabled={disabled || !hasCredential || !hasWallet}
              variant="outline"
              className="rounded-full border-white/15 bg-transparent"
            >
              <KeyRound className="mr-2 h-4 w-4" />
              Create Session
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Session</DialogTitle>
              <DialogDescription>
                Open a policy-bound session for this agent. Sessions are the actual spending permission boundary.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Max Value</Label>
                <Input
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="7"
                />
                <p className="text-xs text-foreground/50">
                  Maximum ETH value this session can transfer
                </p>
              </div>
              <div className="space-y-2">
                <Label>Expiry (Unix timestamp)</Label>
                <Input
                  value={sessionExpiry}
                  onChange={(e) => setSessionExpiry(e.target.value)}
                />
                <p className="text-xs text-foreground/50">
                  Expires: {sessionExpiryDate.toLocaleDateString()}
                </p>
              </div>
              {result && (
                <div
                  className={`rounded-lg p-3 text-sm ${
                    sessionStatus === 'success'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {result.text}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setSessionOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={sessionStatus === 'loading'}
                onClick={() =>
                  runAction(
                    'CREATE_SESSION',
                    `/api/platform/agents/${agentId}/session`,
                    { maxValue: Number(maxValue), expiry: Number(sessionExpiry) },
                    setSessionStatus
                  )
                }
              >
                {sessionStatus === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Session
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
          <DialogTrigger asChild>
            <Button
              disabled={disabled}
              variant="outline"
              className="rounded-full border-white/15 bg-transparent"
            >
              <Wallet className="mr-2 h-4 w-4" />
              {hasWallet ? 'Add Wallet' : 'Deploy Wallet'}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deploy Agent Wallet</DialogTitle>
              <DialogDescription>
                Deploy an ERC-4337 wallet for this agent. Treasury funds live here, not in the model provider.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Owner Address</Label>
                <Input
                  value={ownerAddress}
                  onChange={(e) => setOwnerAddress(e.target.value)}
                  placeholder={account ?? '0x...'}
                />
                <p className="text-xs text-foreground/50">
                  The address that will own this wallet
                </p>
              </div>
              {result && (
                <div
                  className={`rounded-lg p-3 text-sm ${
                    walletStatus === 'success'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {result.text}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setWalletOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={walletStatus === 'loading'}
                onClick={() =>
                  runAction(
                    'CREATE_WALLET',
                    `/api/platform/agents/${agentId}/wallet`,
                    { ownerAddress: effectiveOwnerAddress },
                    setWalletStatus
                  )
                }
              >
                {walletStatus === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Deploy Wallet
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={fundOpen} onOpenChange={setFundOpen}>
          <DialogTrigger asChild>
            <Button
              disabled={disabled || !hasWallet}
              variant="outline"
              className="rounded-full border-white/15 bg-transparent"
            >
              <Banknote className="mr-2 h-4 w-4" />
              Fund Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Fund Agent Wallet</DialogTitle>
              <DialogDescription>
                Send ETH to this agent wallet from the organization treasury. Funding does not grant permission by itself; session limits still apply.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Amount (ETH)</Label>
                <Input
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  placeholder="0.01"
                />
              </div>
              {result && (
                <div
                  className={`rounded-lg p-3 text-sm ${
                    fundStatus === 'success'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {result.text}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setFundOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={fundStatus === 'loading'}
                onClick={() =>
                  runAction(
                    'FUND_AGENT',
                    `/api/platform/agents/${agentId}/fund`,
                    { amountEth: fundAmount },
                    setFundStatus
                  )
                }
              >
                {fundStatus === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Funds
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
          <DialogTrigger asChild>
            <Button
              disabled={disabled || !hasCredential}
              variant="outline"
              className="rounded-full border-white/15 bg-transparent text-red-400 hover:bg-red-500/10"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Revoke
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-400">Revoke Credential</DialogTitle>
              <DialogDescription>
                Revoking will invalidate this agent's credential and prevent future session
                creation. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {result && (
                <div
                  className={`rounded-lg p-3 text-sm ${
                    revokeStatus === 'success'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {result.text}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRevokeOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={revokeStatus === 'loading'}
                onClick={() =>
                  runAction(
                    'REVOKE_CREDENTIAL',
                    `/api/platform/agents/${agentId}/revoke`,
                    {},
                    setRevokeStatus
                  )
                }
              >
                {revokeStatus === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Revoke Credential
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!isConnected || !isBaseSepolia ? (
        <div className="rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground/60">
          Connect the organization owner wallet on Base Sepolia. Every action here asks for a fresh
          signature before the backend submits an on-chain transaction.
        </div>
      ) : null}

      {isConnected && isBaseSepolia ? (
        <div className="rounded-2xl border border-white/10 bg-card/80 px-4 py-4 text-sm text-foreground/68 backdrop-blur-xl">
          <div className="micro-label">Execution model</div>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <div>1. Provider drives decisions.</div>
            <div>2. Credential binds identity.</div>
            <div>3. Wallet holds treasury.</div>
            <div>4. Session gates execution.</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
