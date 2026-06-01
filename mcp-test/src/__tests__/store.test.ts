import { describe, it, expect } from "bun:test"
import { InMemoryStore } from "../store.js"

describe("InMemoryStore", () => {
  it("should create and retrieve an agent", () => {
    const store = new InMemoryStore()
    const agent = store.createAgent({
      name: "test-agent",
      orgId: 1,
      agentType: "external",
    })
    expect(agent.id).toBe(1)
    expect(agent.name).toBe("test-agent")
    expect(agent.orgId).toBe(1)

    const retrieved = store.getAgent(agent.id)
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe("test-agent")
  })

  it("should list all agents", () => {
    const store = new InMemoryStore()
    store.createAgent({ name: "a1", orgId: 1, agentType: "external" })
    store.createAgent({ name: "a2", orgId: 1, agentType: "external" })
    const agents = store.listAgents()
    expect(agents.length).toBe(2)
  })

  it("should filter agents by orgId", () => {
    const store = new InMemoryStore()
    store.createAgent({ name: "a1", orgId: 1, agentType: "external" })
    store.createAgent({ name: "a2", orgId: 2, agentType: "external" })

    const org1Agents = store.listAgents(1)
    expect(org1Agents.length).toBe(1)
  })

  it("should create and list capabilities by orgId", () => {
    const store = new InMemoryStore()
    const cap = store.createCapability({
      orgId: 1,
      action: "database.read",
      effect: "allow",
    })
    expect(cap.id).toBe(1)
    expect(cap.action).toBe("database.read")

    const caps = store.listCapabilities(1)
    expect(caps.length).toBe(1)
    expect(caps[0].action).toBe("database.read")
  })

  it("should grant capability and retrieve it for an agent", () => {
    const store = new InMemoryStore()
    const agent = store.createAgent({ name: "agent", orgId: 1, agentType: "external" })
    const cap = store.createCapability({
      orgId: 1,
      action: "database.read",
      effect: "allow",
    })

    const grant = store.grantCapability({
      grantorAgentId: agent.id,
      granteeAgentId: agent.id,
      orgId: 1,
      capabilityId: cap.id,
    })

    expect(grant.id).toBe(1)

    const grants = store.getGrantsForAgent(agent.id, 1)
    expect(grants.length).toBe(1)
    expect(grants[0].capabilityId).toBe(cap.id)
  })

  it("should revoke a grant", () => {
    const store = new InMemoryStore()
    const agent = store.createAgent({ name: "agent", orgId: 1, agentType: "external" })
    const cap = store.createCapability({ orgId: 1, action: "read", effect: "allow" })
    const grant = store.grantCapability({
      grantorAgentId: agent.id,
      granteeAgentId: agent.id,
      orgId: 1,
      capabilityId: cap.id,
    })

    store.revokeGrant(grant.id, 1)
    const grants = store.getGrantsForAgent(agent.id, 1)
    expect(grants.length).toBe(0)
  })

  it("should create a delegation and check it", () => {
    const store = new InMemoryStore()
    const delegator = store.createAgent({ name: "d1", orgId: 1, agentType: "external" })
    const delegate = store.createAgent({ name: "d2", orgId: 1, agentType: "external" })

    store.createDelegation({
      orgId: 1,
      delegatorAgentId: delegator.id,
      delegateAgentId: delegate.id,
      scope: { allowedActions: ["read"] },
    })

    const check = store.checkDelegation(delegate.id, 1, "read")
    expect(check.allowed).toBe(true)
  })

  it("should revoke a delegation", () => {
    const store = new InMemoryStore()
    const d1 = store.createAgent({ name: "d1", orgId: 1, agentType: "external" })
    const d2 = store.createAgent({ name: "d2", orgId: 1, agentType: "external" })
    const del = store.createDelegation({
      orgId: 1,
      delegatorAgentId: d1.id,
      delegateAgentId: d2.id,
      scope: { allowedActions: ["read"] },
    })

    store.revokeDelegation(del.id, 1)
    const check = store.checkDelegation(d2.id, 1, "read")
    expect(check.allowed).toBe(false)
  })

  it("checkCapability should return allowed when grant matches", () => {
    const store = new InMemoryStore()
    const agent = store.createAgent({ name: "a", orgId: 1, agentType: "external" })
    const cap = store.createCapability({ orgId: 1, action: "read", effect: "allow" })
    store.grantCapability({
      grantorAgentId: agent.id,
      granteeAgentId: agent.id,
      orgId: 1,
      capabilityId: cap.id,
    })

    const check = store.checkCapability(agent.id, 1, "read")
    expect(check.allowed).toBe(true)
  })

  it("checkCapability should deny when not granted", () => {
    const store = new InMemoryStore()
    const check = store.checkCapability(999, 1, "write")
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("No grant")
  })
})
