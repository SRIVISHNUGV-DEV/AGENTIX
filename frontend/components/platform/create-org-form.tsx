'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useWallet } from '@/components/wallet/wallet-provider'
import { useWalletAction } from '@/lib/wallet-action'

interface CreateOrgFormProps {
  trigger?: React.ReactNode
}

export function CreateOrgForm({ trigger }: CreateOrgFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const { isConnected, isSepolia, account } = useWallet()
  const { post } = useWalletAction()

  const disabled = isPending || !isConnected || !isSepolia || !name.trim()

  const handleCreate = async () => {
    if (!account) {
      setMessage({ text: 'Wallet not connected', error: true })
      return
    }

    setMessage(null)

    const result = await post(
      '/api/platform/orgs',
      {
        action: 'CREATE_ORG',
        orgId: 0, // New org, no ID yet
        target: 'org:new',
      },
      {
        name: name.trim(),
      }
    )

    if (result.success) {
      const data = result.data as { id: number }
      setMessage({ text: 'Organization created successfully' })
      setOpen(false)
      setName('')
      startTransition(() => {
        router.push(`/dashboard?org=${data.id}`)
        router.refresh()
      })
    } else {
      setMessage({ text: result.error, error: true })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            disabled={!isConnected || !isSepolia}
            className="rounded-2xl bg-primary px-6 py-4 text-primary-foreground hover:bg-primary/90"
          >
            Create Organization
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Create a new organization. Your connected wallet will be set as the owner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Organization"
              className="border-zinc-700 bg-zinc-800"
            />
          </div>

          <div className="space-y-2">
            <Label>Owner Wallet</Label>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-400">
              {account || 'Connect wallet first'}
            </div>
          </div>

          {!isConnected || !isSepolia ? (
            <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
              Connect your wallet on Sepolia to create an organization.
            </div>
          ) : null}

          {message ? (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                message.error
                  ? 'border border-red-800/50 bg-red-900/20 text-red-200'
                  : 'border border-green-800/50 bg-green-900/20 text-green-200'
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <Button
            disabled={disabled}
            onClick={handleCreate}
            className="w-full rounded-lg bg-primary py-2"
          >
            {isPending ? 'Creating...' : 'Create Organization'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
