'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { getTxExplorerUrl } from '@/lib/explorer'

interface WalletUserOpPanelProps {
  walletAddress: string
  orgId: string
}

type UserOpShape = {
  sender: string
  nonce: string
  initCode: string
  callData: string
  accountGasLimits: string
  preVerificationGas: string
  gasFees: string
  paymasterAndData: string
  signature: string
}

export function WalletUserOpPanel({ walletAddress, orgId }: WalletUserOpPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [target, setTarget] = useState('')
  const [valueWei, setValueWei] = useState('0')
  const [data, setData] = useState('0x')
  const [result, setResult] = useState<{
    text: string
    userOpHash?: string
    transactionHash?: string
  } | null>(null)
  const { isConnected, isSepolia, signPlatformAction, signMessage } = useWallet()
  const disabled = isPending || !isConnected || !isSepolia

  const execute = async () => {
    try {
      setResult(null)

      const signaturePayload = await signPlatformAction({
        action: 'PREPARE_USER_OPERATION',
        orgId: Number(orgId),
        target: `wallet:${walletAddress}`,
      })

      const prepareResponse = await fetch(`/api/platform/wallets/${walletAddress}/userop/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          valueWei,
          data,
          ...signaturePayload,
        }),
      })

      const preparedPayload = await prepareResponse.json().catch(() => ({}))
      if (!prepareResponse.ok) {
        throw new Error(preparedPayload.error ?? 'Failed to prepare user operation')
      }

      const userOp = preparedPayload.userOp as UserOpShape
      const userOpHash = preparedPayload.userOpHash as string
      const ownerSignature = await signMessage(userOpHash)

      const submitSignaturePayload = await signPlatformAction({
        action: 'SUBMIT_USER_OPERATION',
        orgId: Number(orgId),
        target: `wallet:${walletAddress}`,
      })

      const submitResponse = await fetch(`/api/platform/wallets/${walletAddress}/userop/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userOp: {
            ...userOp,
            signature: ownerSignature,
          },
          entryPointAddress: preparedPayload.entryPointAddress,
          ...submitSignaturePayload,
        }),
      })

      const submitPayload = await submitResponse.json().catch(() => ({}))
      if (!submitResponse.ok) {
        throw new Error(submitPayload.error ?? 'Failed to submit user operation')
      }

      const receiptResponse = await fetch(
        `/api/platform/wallets/userops/${submitPayload.userOpHash}?entryPointAddress=${encodeURIComponent(preparedPayload.entryPointAddress)}`,
        { method: 'GET' }
      )
      const receiptPayload = await receiptResponse.json().catch(() => ({}))

      const transactionHash =
        receiptPayload?.receipt?.receipt?.transactionHash ??
        receiptPayload?.receipt?.transactionHash ??
        undefined

      startTransition(() => {
        setResult({
          text: transactionHash ? 'UserOperation landed on-chain' : 'UserOperation submitted to bundler',
          userOpHash: submitPayload.userOpHash,
          transactionHash,
        })
      })
    } catch (error: any) {
      setResult({ text: error.message ?? 'UserOperation failed' })
    }
  }

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-card p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
      <div className="mb-4">
        <div className="micro-label">ERC-4337 execution</div>
        <h2 className="mt-2 text-xl font-semibold">Submit a wallet operation</h2>
        <p className="mt-2 text-sm text-foreground/55">
          Prepare a user operation for this agent wallet, sign the userOp hash with the connected owner wallet, and send it to the configured bundler.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Target address</label>
          <Input value={target} onChange={(event) => setTarget(event.target.value)} className="mt-3 border-white/10 bg-background text-foreground" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Value (wei)</label>
          <Input value={valueWei} onChange={(event) => setValueWei(event.target.value)} className="mt-3 border-white/10 bg-background text-foreground" />
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Calldata</label>
        <Input value={data} onChange={(event) => setData(event.target.value)} className="mt-3 border-white/10 bg-background font-mono text-foreground" />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={disabled || !target}
          className="rounded-2xl bg-primary px-5 py-5 text-primary-foreground hover:bg-primary/90"
          onClick={execute}
        >
          Prepare, sign, and submit
        </Button>
      </div>

      {!isConnected || !isSepolia ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-background px-4 py-3 text-sm text-foreground/60">
          Connect the owner wallet on Sepolia. This flow signs both the platform authorization and the ERC-4337 userOp hash.
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-background px-4 py-3 text-sm text-foreground">
          <div>{result.text}</div>
          {result.userOpHash ? (
            <div className="mt-2 font-mono text-xs text-foreground/60 break-all">
              userOpHash: {result.userOpHash}
            </div>
          ) : null}
          {result.transactionHash ? (
            <a
              href={getTxExplorerUrl(result.transactionHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-xs underline decoration-white/20 underline-offset-4 hover:text-foreground/80"
            >
              View transaction on Etherscan
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
