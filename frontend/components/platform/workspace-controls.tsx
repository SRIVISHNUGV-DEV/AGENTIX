'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'

type OrgOption = {
  id: string
  name: string
}

interface WorkspaceControlsProps {
  organizations: OrgOption[]
  currentOrgId: string | null
}

export function WorkspaceControls({
  organizations,
  currentOrgId,
}: WorkspaceControlsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedOrgId, setSelectedOrgId] = useState(currentOrgId ?? organizations[0]?.id ?? '')
  const [orgName, setOrgName] = useState('')
  const [agentName, setAgentName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const { account, isConnected, isSepolia } = useWallet()
  const disabled = isPending || !isConnected || !isSepolia

  const refresh = () => {
    startTransition(() => {
      router.refresh()
    })
  }

  const selectOrg = async (orgId: string) => {
    try {
      const response = await fetch('/api/platform/org/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: Number(orgId) }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? 'Failed to select organization')
      }

      setSelectedOrgId(orgId)
      setMessage('Organization selected')
      refresh()
    } catch (error: any) {
      setMessage(error.message ?? 'Failed to select organization')
    }
  }

  const createOrg = async () => {
    try {
      setMessage(null)
      const response = await fetch('/api/platform/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: orgName,
          ownerWalletAddress: account,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to create organization')
      }

      setOrgName('')
      setSelectedOrgId(String(payload.id))
      setMessage(`Organization created: ${payload.name}`)
      refresh()
    } catch (error: any) {
      setMessage(error.message ?? 'Failed to create organization')
    }
  }

  const createAgent = async () => {
    try {
      setMessage(null)
      const response = await fetch('/api/platform/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: Number(selectedOrgId),
          agentName,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to create agent')
      }

      setAgentName('')
      setMessage(`Agent created: #${payload.agentId}`)
      startTransition(() => {
        router.push(`/agents/${payload.agentId}`)
        router.refresh()
      })
    } catch (error: any) {
      setMessage(error.message ?? 'Failed to create agent')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-card p-4">
        <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Workspace</label>
        <select
          value={selectedOrgId}
          onChange={(event) => setSelectedOrgId(event.target.value)}
          className="mt-3 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="" disabled>
            Select organization
          </option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <Button
          disabled={isPending || !selectedOrgId}
          variant="outline"
          className="mt-3 w-full rounded-full border-white/15 bg-transparent text-foreground hover:bg-white/5"
          onClick={() => selectOrg(selectedOrgId)}
        >
          Switch workspace
        </Button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-card p-4">
        <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">New organization</label>
        <Input
          value={orgName}
          onChange={(event) => setOrgName(event.target.value)}
          placeholder="Acme Treasury Ops"
          className="mt-3 border-white/10 bg-background text-foreground"
        />
        <Button
          disabled={disabled || !orgName.trim()}
          className="mt-3 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={createOrg}
        >
          Create from connected wallet
        </Button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-card p-4">
        <label className="text-xs uppercase tracking-[0.18em] text-foreground/45">Create agent</label>
        <Input
          value={agentName}
          onChange={(event) => setAgentName(event.target.value)}
          placeholder="Treasury Agent"
          className="mt-3 border-white/10 bg-background text-foreground"
        />
        <Button
          disabled={disabled || !selectedOrgId || !agentName.trim()}
          className="mt-3 w-full rounded-full bg-white text-background hover:bg-white/90"
          onClick={createAgent}
        >
          Add agent to workspace
        </Button>
      </div>

      {!isConnected || !isSepolia ? (
        <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground/60">
          Connect a wallet on Sepolia to create organizations and submit signed platform actions.
        </div>
      ) : null}

      {message ? (
        <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}
    </div>
  )
}
