'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWallet } from '@/components/wallet/wallet-provider'
import { useWalletAction } from '@/lib/wallet-action'

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
  const { isConnected, isSepolia } = useWallet()
  const { post } = useWalletAction()
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

      // Use wallet signature for org creation
      const result = await post<{ id: number; name: string }>(
        '/api/platform/orgs',
        { action: 'CREATE_ORG', orgId: 0, target: 'org:new' },
        { name: orgName }
      )

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create organization')
      }

      setOrgName('')
      setSelectedOrgId(String(result.data.id))
      setMessage(`Organization created: ${result.data.name}`)
      refresh()
    } catch (error: any) {
      setMessage(error.message ?? 'Failed to create organization')
    }
  }

  const createAgent = async () => {
    try {
      setMessage(null)
      const orgId = Number(selectedOrgId)

      // Use wallet signature for agent creation
      const result = await post<{ agentId: number }>(
        '/api/platform/agents',
        { action: 'CREATE_AGENT', orgId, target: `org:${orgId}:agent:new` },
        { orgId, agentName }
      )

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create agent')
      }

      setAgentName('')
      setMessage(`Agent created: #${result.data.agentId}`)
      startTransition(() => {
        router.push(`/agents/${result.data.agentId}`)
        router.refresh()
      })
    } catch (error: any) {
      setMessage(error.message ?? 'Failed to create agent')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lux-panel p-4">
        <label htmlFor="workspace-select" className="text-xs uppercase tracking-[0.18em] text-foreground/45">Workspace</label>
        <select
          id="workspace-select"
          value={selectedOrgId}
          onChange={(event) => setSelectedOrgId(event.target.value)}
          className="mt-3 w-full rounded-xl border border-white/10 bg-background/80 px-3 py-2 text-sm text-foreground backdrop-blur-xl"
          suppressHydrationWarning
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

      <div className="lux-panel p-4">
        <label htmlFor="new-organization-name" className="text-xs uppercase tracking-[0.18em] text-foreground/45">New organization</label>
        <Input
          id="new-organization-name"
          value={orgName}
          onChange={(event) => setOrgName(event.target.value)}
          placeholder="Acme Treasury Ops"
          className="mt-3 border-white/10 bg-background/80 text-foreground backdrop-blur-xl"
        />
        <Button
          disabled={disabled || !orgName.trim()}
          className="mt-3 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={createOrg}
        >
          Create from connected wallet
        </Button>
      </div>

      <div className="lux-panel p-4">
        <label htmlFor="new-agent-name" className="text-xs uppercase tracking-[0.18em] text-foreground/45">Create agent</label>
        <Input
          id="new-agent-name"
          value={agentName}
          onChange={(event) => setAgentName(event.target.value)}
          placeholder="Treasury Agent"
          className="mt-3 border-white/10 bg-background/80 text-foreground backdrop-blur-xl"
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
        <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-card/80 px-4 py-3 text-sm text-foreground/60 backdrop-blur-xl">
          Connect a wallet on Sepolia to create organizations and submit signed platform actions.
        </div>
      ) : null}

      {message ? (
        <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-card/80 px-4 py-3 text-sm text-foreground backdrop-blur-xl">
          {message}
        </div>
      ) : null}
    </div>
  )
}
