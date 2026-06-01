// Simple in-memory store — no DB required for testnet MCP server

type Agent = {
  id: number
  orgId: number
  agentType: string
  name: string
  status: string
  isActive: boolean
  createdAt: number
  lastHeartbeatAt: number | null
}

type Capability = {
  id: number
  orgId: number
  action: string
  effect: string
  constraints: Record<string, unknown>
  resourcePattern?: string
  expiresAt?: number
  createdAt: number
}

type Grant = {
  id: number
  orgId: number
  grantorAgentId: number
  granteeAgentId: number
  capabilityId: number
  constraints: Record<string, unknown>
  expiresAt?: number
  revoked: boolean
  createdAt: number
}

type Delegation = {
  id: number
  orgId: number
  delegatorAgentId: number
  delegateAgentId: number
  scope: Record<string, unknown>
  status: string
  expiresAt?: number
  maxDepth: number
  currentDepth: number
  grantorDelegationId?: number
  label?: string
  createdAt: number
}

export class InMemoryStore {
  private agents: Map<number, Agent> = new Map()
  private capabilities: Map<number, Capability> = new Map()
  private grants: Map<number, Grant> = new Map()
  private delegations: Map<number, Delegation> = new Map()
  private nextAgentId = 1
  private nextCapId = 1
  private nextGrantId = 1
  private nextDelegId = 1

  createAgent(data: { orgId: number; agentType: string; name: string }): Agent {
    const id = this.nextAgentId++
    const agent: Agent = {
      id,
      orgId: data.orgId,
      agentType: data.agentType,
      name: data.name,
      status: "connected",
      isActive: true,
      createdAt: Math.floor(Date.now() / 1000),
      lastHeartbeatAt: null,
    }
    this.agents.set(id, agent)
    return agent
  }

  listAgents(orgId?: number): Agent[] {
    const all = Array.from(this.agents.values())
    return orgId ? all.filter((a) => a.orgId === orgId) : all
  }

  getAgent(agentId: number, orgId?: number): Agent | null {
    const agent = this.agents.get(agentId)
    if (!agent) return null
    if (orgId && agent.orgId !== orgId) return null
    return agent
  }

  deleteAgent(agentId: number, orgId?: number): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    if (orgId && agent.orgId !== orgId) return false
    return this.agents.delete(agentId)
  }

  heartbeat(agentId: number): void {
    const agent = this.agents.get(agentId)
    if (agent) agent.lastHeartbeatAt = Math.floor(Date.now() / 1000)
  }

  createCapability(data: {
    orgId: number
    action: string
    effect?: string
    constraints?: Record<string, unknown>
    resourcePattern?: string
    expiresAt?: number
  }): Capability {
    const id = this.nextCapId++
    const cap: Capability = {
      id,
      orgId: data.orgId,
      action: data.action,
      effect: data.effect || "allow",
      constraints: data.constraints || {},
      resourcePattern: data.resourcePattern,
      expiresAt: data.expiresAt,
      createdAt: Math.floor(Date.now() / 1000),
    }
    this.capabilities.set(id, cap)
    return cap
  }

  listCapabilities(orgId: number): Capability[] {
    return Array.from(this.capabilities.values()).filter((c) => c.orgId === orgId)
  }

  grantCapability(data: {
    orgId: number
    grantorAgentId: number
    granteeAgentId: number
    capabilityId: number
    constraints?: Record<string, unknown>
    expiresAt?: number
  }): Grant {
    const id = this.nextGrantId++
    const grant: Grant = {
      id,
      orgId: data.orgId,
      grantorAgentId: data.grantorAgentId,
      granteeAgentId: data.granteeAgentId,
      capabilityId: data.capabilityId,
      constraints: data.constraints || {},
      expiresAt: data.expiresAt,
      revoked: false,
      createdAt: Math.floor(Date.now() / 1000),
    }
    this.grants.set(id, grant)
    return grant
  }

  revokeGrant(grantId: number, orgId: number): boolean {
    const grant = this.grants.get(grantId)
    if (!grant || grant.orgId !== orgId) return false
    grant.revoked = true
    return true
  }

  checkCapability(agentId: number, orgId: number, action: string): {
    allowed: boolean
    grants: Grant[]
    reason?: string
  } {
    const matching = Array.from(this.grants.values()).filter(
      (g) => g.granteeAgentId === agentId && g.orgId === orgId && !g.revoked
    )
    for (const grant of matching) {
      const cap = this.capabilities.get(grant.capabilityId)
      if (cap && cap.action === action && cap.effect !== "deny") {
        if (cap.expiresAt && cap.expiresAt < Math.floor(Date.now() / 1000)) continue
        if (grant.expiresAt && grant.expiresAt < Math.floor(Date.now() / 1000)) continue
        return { allowed: true, grants: [grant] }
      }
    }
    return { allowed: false, grants: [], reason: `No grant for action: ${action}` }
  }

  getGrantsForAgent(agentId: number, orgId: number): Grant[] {
    return Array.from(this.grants.values()).filter(
      (g) => g.granteeAgentId === agentId && g.orgId === orgId && !g.revoked
    )
  }

  createDelegation(data: {
    orgId: number
    delegatorAgentId: number
    delegateAgentId: number
    scope: Record<string, unknown>
    expiresAt?: number
    maxDepth?: number
    label?: string
  }): Delegation {
    const id = this.nextDelegId++
    const delegation: Delegation = {
      id,
      orgId: data.orgId,
      delegatorAgentId: data.delegatorAgentId,
      delegateAgentId: data.delegateAgentId,
      scope: data.scope,
      status: "active",
      expiresAt: data.expiresAt,
      maxDepth: data.maxDepth || 5,
      currentDepth: 1,
      label: data.label,
      createdAt: Math.floor(Date.now() / 1000),
    }
    this.delegations.set(id, delegation)
    return delegation
  }

  revokeDelegation(delegationId: number, orgId: number): boolean {
    const d = this.delegations.get(delegationId)
    if (!d || d.orgId !== orgId) return false
    d.status = "revoked"
    return true
  }

  checkDelegation(delegateAgentId: number, orgId: number, requiredAction: string): {
    allowed: boolean
    delegation?: Delegation
    reason?: string
  } {
    const active = Array.from(this.delegations.values()).filter(
      (d) => d.delegateAgentId === delegateAgentId && d.orgId === orgId && d.status === "active"
    )
    for (const d of active) {
      const actions = (d.scope as any).allowedActions
      if (!actions || actions.includes(requiredAction)) {
        return { allowed: true, delegation: d }
      }
    }
    return { allowed: false, reason: "No delegation permits this action" }
  }

  getDelegationChain(delegateAgentId: number, orgId: number): {
    chain: Array<Record<string, unknown>>
    depth: number
  } | null {
    const chain: Array<Record<string, unknown>> = []
    let currentId = delegateAgentId
    for (let i = 0; i < 10; i++) {
      const d = Array.from(this.delegations.values()).find(
        (del) => del.delegateAgentId === currentId && del.orgId === orgId && del.status === "active"
      )
      if (!d) break
      chain.unshift({
        delegationId: d.id,
        delegatorAgentId: d.delegatorAgentId,
        delegateAgentId: d.delegateAgentId,
        scope: d.scope,
        status: d.status,
      })
      currentId = d.delegatorAgentId
    }
    if (chain.length === 0) return null
    return { chain, depth: chain.length }
  }
}
