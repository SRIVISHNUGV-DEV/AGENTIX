"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AgentTabs } from "@/components/agents/agent-tabs"
import { Agent, Session, Event } from "@/lib/types"
import { disconnectExternalAgent } from "@/lib/external-agents-api"
import { useWallet } from "@/components/wallet/wallet-provider"
import { toast } from "sonner"

interface AgentDetailClientProps {
  agent: Agent
  sessions: Session[]
  events: Event[]
}

export function AgentDetailClient({ agent, sessions, events }: AgentDetailClientProps) {
  const router = useRouter()
  const { account } = useWallet()
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const handleDisconnectRuntime = useCallback(async () => {
    if (!agent.linkedExternalAgent) {
      toast.error("No runtime connected")
      return
    }

    if (!agent.orgId) {
      toast.error("Organization ID not found")
      return
    }

    setIsDisconnecting(true)
    try {
      await disconnectExternalAgent(agent.linkedExternalAgent.id, parseInt(agent.orgId, 10))
      toast.success("Runtime disconnected")
      router.refresh()
    } catch (error: any) {
      console.error("Disconnect runtime error:", error)
      toast.error(error.message || "Failed to disconnect runtime")
    } finally {
      setIsDisconnecting(false)
    }
  }, [agent.linkedExternalAgent, agent.orgId, router])

  return (
    <AgentTabs
      agent={agent}
      sessions={sessions}
      events={events}
      onDisconnectRuntime={handleDisconnectRuntime}
    />
  )
}
