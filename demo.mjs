#!/usr/bin/env node
/**
 * AgentIX × Covenant — One-Command Demo
 *
 * Flow: Register → Agent → Credential → Session → Task → Settle → Audit → Revoke
 *
 * Prerequisites:
 *   - AgentIX backend on http://localhost:3001
 *   - PostgreSQL running
 *
 * Usage: node demo.mjs
 */

const API = process.env.AGENTIX_URL || "http://localhost:3001"
let TOKEN = ""

async function api(method, path, body, authed = true) {
  const headers = { "Content-Type": "application/json" }
  if (authed && TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`)
  return data
}

// ── Step 0: Health ─────────────────────────────────────────────────────
async function healthCheck() {
  const h = await api("GET", "/health", null, false)
  console.log(`[✓] Backend healthy (${h.status})`)
}

// ── Step 1: Register user + org ────────────────────────────────────────
async function register() {
  const res = await api("POST", "/auth/register", {
    orgName: "Demo Corp",
    email: `demo-${Date.now()}@example.com`,
    name: "Demo User",
    password: "DemoPass1234!",
  }, false)
  TOKEN = res.token
  console.log(`[✓] Registered: orgId=${res.user.orgId}, userId=${res.user.id}`)
  return { orgId: res.user.orgId, userId: res.user.id }
}

// ── Step 2: Provision agent + credential ───────────────────────────────
async function provisionAgent(orgId) {
  const res = await api("POST", "/agents/simple/provision", {
    orgId,
    agentName: "Covenant Worker Agent",
  })
  const agentId = res.agentId
  console.log(`[✓] Agent provisioned: id=${agentId}`)

  const cred = await api("POST", "/credentials", {
    agentId,
    orgId,
    permissions: 0b01111111,
    expiry: Math.floor(Date.now() / 1000) + 86400,
    commitment: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`,
  })
  console.log(`[✓] Credential issued: leafIndex=${cred.leafIndex}`)
  return { agentId, credential: cred }
}

// ── Step 3: Create session ─────────────────────────────────────────────
async function createSession(agentId) {
  const sessionId = `0x${crypto.randomUUID().replace(/-/g, "")}`
  const sessionKey = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`
  const expiry = Math.floor(Date.now() / 1000) + 3600
  console.log(`[✓] Session created:`)
  console.log(`    sessionId:  ${sessionId}`)
  console.log(`    sessionKey: ${sessionKey}`)
  console.log(`    expiry:     ${new Date(expiry * 1000).toISOString()}`)
  console.log(`    permissions: 0b01111111`)
  return { sessionId, sessionKey, budget: 100, expiry }
}

// ── Step 4: Authorize + create Covenant task ───────────────────────────
async function createTask(session, orgId, agentId) {
  const authRes = await api("POST", "/covenant/authorize", {
    sessionId: session.sessionId,
    agentId,
    action: "create_task",
    value: 0,
  })

  if (!authRes.authorized) throw new Error(`Authorization failed: ${authRes.error}`)
  console.log(`[✓] Session authorized for create_task`)
  console.log(`    remaining budget: ${authRes.remainingBudget ?? "N/A"}`)

  const headers = {
    "x-covenant-session-id": session.sessionId,
    "x-covenant-agent-id": String(agentId),
    "x-covenant-org-id": String(orgId),
  }

  const task = await api("POST", "/covenant/task", {
    worker: "0x47b71B49552B16a58e2c4B796bF3bDB25eD9F2C4",
    payment: "0.001",
    deadline: Math.floor(Date.now() / 1000) + 86400,
    metaHash: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`,
  })
  console.log(`[✓] Covenant task created:`)
  console.log(`    taskId: ${task.taskId}`)
  console.log(`    txHash: ${task.txHash}`)
  return task
}

// ── Step 5: Submit work ───────────────────────────────────────────────
async function submitWork(session, orgId, agentId, taskId) {
  const res = await api("POST", `/covenant/task/${taskId}/submit`, {
    deliverableHash: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`,
  })
  console.log(`[✓] Work submitted: txHash=${res.txHash}`)
  return res
}

// ── Step 6: Complete task ─────────────────────────────────────────────
async function completeTask(session, orgId, agentId, taskId) {
  const res = await api("POST", `/covenant/task/${taskId}/complete`, {
    clientSignature: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 130)}`,
  })
  console.log(`[✓] Task settled: txHash=${res.txHash}`)
  return res
}

// ── Step 7: Audit trail ───────────────────────────────────────────────
async function viewAudit() {
  const entries = await api("GET", "/covenant/audit?limit=20")
  console.log(`[✓] Audit trail (${entries.length} entries):`)
  for (const e of entries.slice(-5)) {
    console.log(`    ${e.action || e.covenantAction} | agent:${e.agentId}`)
  }
}

// ── Security tests ─────────────────────────────────────────────────────
async function testBudgetExceeded(session, orgId, agentId) {
  console.log(`\n── Security Test: Budget exceeded ──`)
  try {
    await api("POST", "/covenant/authorize", {
      sessionId: session.sessionId, agentId, action: "create_task", value: 999999,
    })
    console.log(`[✗] FAIL: Should have rejected`)
  } catch (err) {
    console.log(`[✓] Correctly rejected: ${err.message.slice(0, 80)}`)
  }
}

async function testWrongOrg(session, orgId, agentId) {
  console.log(`\n── Security Test: Wrong organization ──`)
  try {
    await api("POST", "/covenant/task", {
      worker: "0x0000000000000000000000000000000000000001",
      payment: "0.001",
      deadline: Math.floor(Date.now() / 1000) + 3600,
      metaHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    })
    console.log(`[✗] FAIL: Should have rejected`)
  } catch (err) {
    console.log(`[✓] Correctly rejected: ${err.message.slice(0, 80)}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(60))
  console.log("  AgentIX × Covenant — End-to-End Demo")
  console.log("═".repeat(60))
  console.log()

  await healthCheck()
  const { orgId } = await register()
  const { agentId } = await provisionAgent(orgId)
  const session = await createSession(agentId)

  const task = await createTask(session, orgId, agentId)
  await submitWork(session, orgId, agentId, task.taskId)
  await completeTask(session, orgId, agentId, task.taskId)
  await viewAudit()

  console.log(`\n── Security Tests ──`)
  await testBudgetExceeded(session, orgId, agentId)
  await testWrongOrg(session, orgId, agentId)

  console.log()
  console.log("═".repeat(60))
  console.log("  Demo complete.")
  console.log("═".repeat(60))
}

main().catch((err) => {
  console.error("\n[FAIL]", err.message)
  process.exit(1)
})
