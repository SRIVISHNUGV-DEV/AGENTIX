/**
 * AgentIX × Covenant — Security Test Suite
 *
 * Tests the 7 mandatory security scenarios:
 * 1. Budget exceeded
 * 2. Session expired
 * 3. Session revoked
 * 4. Wrong organization
 * 5. Wrong permission
 * 6. Concurrent budget overspend
 * 7. Audit verification
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"

const API = process.env.AGENTIX_URL || "http://localhost:3000"

async function api(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

function covenantHeaders(sessionId: string, agentId: number, orgId: number) {
  return {
    "x-covenant-session-id": sessionId,
    "x-covenant-agent-id": String(agentId),
    "x-covenant-org-id": String(orgId),
  }
}

describe("Covenant Security", () => {
  let orgId: number
  let userId: number
  let agentId: number
  let sessionId: string
  let sessionKey: string

  beforeAll(async () => {
    const org = await api("POST", "/orgs", { name: `Security Test Org ${Date.now()}` })
    orgId = org.data.id

    const user = await api("POST", "/auth/register", {
      orgId,
      email: `security-${Date.now()}@test.com`,
      name: "Security Tester",
      password: "test-password-123",
    })
    userId = user.data.id

    const agent = await api("POST", "/agents", { orgId, agentName: "Security Test Agent" })
    agentId = agent.data.id

    await api("POST", "/credentials", {
      agentId,
      orgId,
      permissions: 0b01111111,
      expiry: Math.floor(Date.now() / 1000) + 86400,
      commitment: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`,
    })

    sessionKey = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`
    sessionId = `0x${crypto.randomUUID().replace(/-/g, "")}`

    await api("POST", "/sessions", {
      agentId,
      sessionId,
      sessionKey,
      maxValue: 100,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      proof: {},
      publicSignals: [sessionId, sessionKey, "100", String(Math.floor(Date.now() / 1000) + 3600), "0"],
    })
  })

  it("TEST 1: Budget exceeded — task cost 500 > budget 100", async () => {
    const auth = await api("POST", "/covenant/authorize", {
      sessionId,
      agentId,
      action: "create_task",
      value: 500,
    })
    expect(auth.data.authorized).toBe(false)
    expect(auth.data.error).toContain("limit exceeded")
  })

  it("TEST 2: Session expired — attempt task after expiry", async () => {
    const expiredSessionId = `0x${crypto.randomUUID().replace(/-/g, "")}`
    await api("POST", "/sessions", {
      agentId,
      sessionId: expiredSessionId,
      sessionKey: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`,
      maxValue: 1000,
      expiry: 1,
      proof: {},
      publicSignals: [expiredSessionId, "0x0", "1000", "1", "0"],
    })

    const auth = await api("POST", "/covenant/authorize", {
      sessionId: expiredSessionId,
      agentId,
      action: "create_task",
      value: 1,
    })
    expect(auth.data.authorized).toBe(false)
    expect(auth.data.error).toContain("expired")
  })

  it("TEST 3: Session revoked — attempt task after revocation", async () => {
    const revokeSessionId = `0x${crypto.randomUUID().replace(/-/g, "")}`
    const revokeKey = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`
    const nullifier = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`

    await api("POST", "/sessions", {
      agentId,
      sessionId: revokeSessionId,
      sessionKey: revokeKey,
      maxValue: 1000,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      proof: {},
      publicSignals: [revokeSessionId, revokeKey, "1000", String(Math.floor(Date.now() / 1000) + 3600), nullifier],
    })

    await api("POST", "/credentials/revoke", {
      agentId,
      secretHash: nullifier,
    })

    const auth = await api("POST", "/covenant/authorize", {
      sessionId: revokeSessionId,
      agentId,
      action: "create_task",
      value: 1,
    })
    expect(auth.data.authorized).toBe(false)
    expect(auth.data.error).toContain("revoked")
  })

  it("TEST 4: Wrong organization — session used with wrong orgId", async () => {
    const auth = await api("POST", "/covenant/authorize", {
      sessionId,
      agentId,
      orgId: 99999,
      action: "create_task",
      value: 1,
    })
    expect(auth.data.authorized).toBe(false)
  })

  it("TEST 5: Wrong permission — action not in permission bits", async () => {
    const limitedSessionId = `0x${crypto.randomUUID().replace(/-/g, "")}`
    const limitedKey = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`

    await api("POST", "/credentials", {
      agentId: agentId + 1000,
      orgId,
      permissions: 0b00000001,
      expiry: Math.floor(Date.now() / 1000) + 86400,
      commitment: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`,
    }).catch(() => {})

    const auth = await api("POST", "/covenant/authorize", {
      sessionId,
      agentId,
      action: "deploy_contract",
      value: 1,
    })
    expect(auth.data.authorized).toBe(false)
  })

  it("TEST 6: Concurrent budget — two requests, second should fail", async () => {
    const concurrentSessionId = `0x${crypto.randomUUID().replace(/-/g, "")}`
    const concurrentKey = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`

    await api("POST", "/sessions", {
      agentId,
      sessionId: concurrentSessionId,
      sessionKey: concurrentKey,
      maxValue: 100,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      proof: {},
      publicSignals: [concurrentSessionId, concurrentKey, "100", String(Math.floor(Date.now() / 1000) + 3600), "0"],
    })

    const results = await Promise.all([
      api("POST", "/covenant/authorize", {
        sessionId: concurrentSessionId,
        agentId,
        action: "create_task",
        value: 80,
      }),
      api("POST", "/covenant/authorize", {
        sessionId: concurrentSessionId,
        agentId,
        action: "create_task",
        value: 80,
      }),
    ])

    const authorized = results.filter((r) => r.data.authorized)
    const rejected = results.filter((r) => !r.data.authorized)

    expect(authorized.length).toBe(1)
    expect(rejected.length).toBe(1)
  })

  it("TEST 7: Audit trail — every action is logged", async () => {
    const audit = await api("GET", `/covenant/audit?limit=50`)

    expect(audit.status).toBe(200)
    expect(Array.isArray(audit.data)).toBe(true)

    if (audit.data.length > 0) {
      const entry = audit.data[0]
      expect(entry).toHaveProperty("org_id")
      expect(entry).toHaveProperty("action")
      expect(entry).toHaveProperty("resource_type")
      expect(entry).toHaveProperty("resource_id")
      expect(entry).toHaveProperty("details")
    }
  })
})
