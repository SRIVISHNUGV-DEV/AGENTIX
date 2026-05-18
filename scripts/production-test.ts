/**
 * Production Test Script for Agentix
 *
 * Tests the complete agent lifecycle in a production-like environment:
 * 1. Health checks (backend, MCP)
 * 2. Organization creation with wallet signature
 * 3. External agent creation and connection
 * 4. MCP tool operations
 *
 * Prerequisites:
 * - PostgreSQL database running
 * - Backend server running on port 3001
 * - TEST_WALLET_PRIVATE_KEY environment variable set
 * - Wallet funded with Sepolia ETH for on-chain operations
 *
 * Run with: npx tsx scripts/production-test.ts
 */

import { config } from "dotenv"
import axios from "axios"
import { Wallet } from "ethers"
import crypto from "crypto"
import path from "path"

// Load environment from backend/.env
config({ path: path.join(__dirname, "../backend/.env") })

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3001"
const CHAIN_ID = Number(process.env.CHAIN_ID || "11155111")

// Test result tracking
interface TestResult {
    name: string
    passed: boolean
    error?: string
    duration: number
    data?: any
}

const results: TestResult[] = []

async function runTest(name: string, testFn: () => Promise<any>): Promise<any> {
    const start = Date.now()
    try {
        const data = await testFn()
        results.push({ name, passed: true, duration: Date.now() - start, data })
        console.log(`  ✅ PASS: ${name} (${Date.now() - start}ms)`)
        return data
    } catch (error: any) {
        const errorMsg = error.response?.data?.error || error.message || String(error)
        results.push({ name, passed: false, error: errorMsg, duration: Date.now() - start })
        console.log(`  ❌ FAIL: ${name} - ${errorMsg}`)
        throw error
    }
}

// =============================================================================
// Phase 1: Health Checks
// =============================================================================

async function testHealthEndpoints() {
    console.log("\n=== Phase 1: Health Checks ===")

    await runTest("Backend health endpoint", async () => {
        const response = await axios.get(`${BACKEND_URL}/health`)
        if (response.data.status !== "ok") {
            throw new Error(`Expected status 'ok', got '${response.data.status}'`)
        }
        return response.data
    })

    await runTest("MCP health endpoint", async () => {
        const response = await axios.get(`${BACKEND_URL}/mcp/health`)
        return response.data
    })

    await runTest("MCP tools list", async () => {
        const response = await axios.get(`${BACKEND_URL}/mcp/tools`)
        const toolCount = response.data.tools?.length || 0
        console.log(`    Found ${toolCount} MCP tools`)
        return response.data
    })

    await runTest("External agent types", async () => {
        const response = await axios.get(`${BACKEND_URL}/external/types`)
        return response.data
    })
}

// =============================================================================
// Phase 2: Organization Creation
// =============================================================================

function buildSignedActionMessage(
    action: string,
    orgId: number | string,
    target: string,
    walletAddress: string,
    nonce: string,
    requestedAt: number,
    chainId: number
): string {
    return [
        "Agentix Authorization",
        `Action: ${action}`,
        `Org: ${orgId}`,
        `Target: ${target}`,
        `Wallet: ${walletAddress.toLowerCase()}`,
        `Nonce: ${nonce}`,
        `RequestedAt: ${requestedAt}`,
        `ChainId: ${chainId}`
    ].join("\n")
}

async function createOrganization(signer: Wallet): Promise<{ orgId: number; orgName: string }> {
    console.log("\n=== Phase 2: Organization Creation ===")

    const nonce = crypto.randomUUID()
    const requestedAt = Math.floor(Date.now() / 1000)
    const orgName = `Test Org ${Date.now()}`

    const message = buildSignedActionMessage(
        "CREATE_ORG",
        0,
        "org:new",
        signer.address,
        nonce,
        requestedAt,
        CHAIN_ID
    )

    const signature = await signer.signMessage(message)

    const result = await runTest("Create organization with signature", async () => {
        const response = await axios.post(`${BACKEND_URL}/orgs`, {
            name: orgName,
            walletAddress: signer.address,
            signature,
            nonce,
            requestedAt
        })
        return response.data
    })

    const orgId = result.id || result.orgId
    console.log(`    Created org ID: ${orgId}`)

    return { orgId, orgName }
}

// =============================================================================
// Phase 3: External Agent Creation
// =============================================================================

async function createExternalAgent(
    orgId: number,
    signer: Wallet
): Promise<{ agentId: number; name: string }> {
    console.log("\n=== Phase 3: External Agent Creation ===")

    const nonce = crypto.randomUUID()
    const requestedAt = Math.floor(Date.now() / 1000)
    const agentName = `Test External Agent ${Date.now()}`

    const message = buildSignedActionMessage(
        "CREATE_EXTERNAL_AGENT",
        orgId,
        `org:${orgId}`,
        signer.address,
        nonce,
        requestedAt,
        CHAIN_ID
    )

    const signature = await signer.signMessage(message)

    const result = await runTest("Create external agent with signature", async () => {
        const response = await axios.post(`${BACKEND_URL}/external`, {
            orgId,
            agentType: "custom",
            name: agentName,
            metadata: { ownerAddress: signer.address },
            walletAddress: signer.address,
            signature,
            nonce,
            requestedAt
        })
        return response.data
    })

    const agentId = result.agentId || result.id
    console.log(`    Created external agent ID: ${agentId}`)

    // Test listing external agents
    await runTest("List external agents", async () => {
        const response = await axios.get(`${BACKEND_URL}/external`, {
            params: { orgId }
        })
        return response.data
    })

    return { agentId, name: agentName }
}

// =============================================================================
// Phase 4: MCP Tool Operations
// =============================================================================

async function testMCPTools(orgId: number, agentId: number) {
    console.log("\n=== Phase 4: MCP Tool Operations ===")

    await runTest("MCP: list_agents", async () => {
        const response = await axios.post(`${BACKEND_URL}/mcp/call`, {
            name: "list_agents",
            arguments: { orgId }
        })
        console.log(`    Found ${response.data.agents?.length || 0} agents`)
        return response.data
    })

    await runTest("MCP: get_agent_state", async () => {
        const response = await axios.post(`${BACKEND_URL}/mcp/call`, {
            name: "get_agent_state",
            arguments: { agentId, orgId }
        })
        return response.data
    })

    await runTest("MCP: heartbeat", async () => {
        const response = await axios.post(`${BACKEND_URL}/mcp/call`, {
            name: "heartbeat",
            arguments: { agentId, orgId, status: "connected" }
        })
        return response.data
    })

    await runTest("MCP: get_execution_stats", async () => {
        const response = await axios.post(`${BACKEND_URL}/mcp/call`, {
            name: "get_execution_stats",
            arguments: { agentId }
        })
        return response.data
    })
}

// =============================================================================
// Phase 5: Whitelist Operations (Optional)
// =============================================================================

async function testWhitelist(orgId: number, agentId: number, signer: Wallet) {
    console.log("\n=== Phase 5: Whitelist Operations ===")

    const testAddress = "0x1234567890123456789012345678901234567890"
    const nonce = crypto.randomUUID()
    const requestedAt = Math.floor(Date.now() / 1000)

    // Note: Whitelist operations may require different signature format
    // This is a basic test of the endpoint structure

    try {
        const message = buildSignedActionMessage(
            "UPDATE_WHITELIST",
            orgId,
            `agent:${agentId}`,
            signer.address,
            nonce,
            requestedAt,
            CHAIN_ID
        )

        const signature = await signer.signMessage(message)

        await runTest("Add to whitelist", async () => {
            const response = await axios.post(`${BACKEND_URL}/whitelist`, {
                agentId,
                addresses: [testAddress],
                walletAddress: signer.address,
                signature,
                nonce,
                requestedAt
            })
            return response.data
        })
    } catch (error: any) {
        console.log(`    ⚠️ Whitelist test skipped or requires different auth: ${error.message}`)
    }
}

// =============================================================================
// Phase 6: Summary Report
// =============================================================================

function printSummary() {
    console.log("\n" + "=".repeat(60))
    console.log("TEST SUMMARY")
    console.log("=".repeat(60))

    const passed = results.filter(r => r.passed)
    const failed = results.filter(r => !r.passed)

    console.log(`\nTotal Tests: ${results.length}`)
    console.log(`Passed: ${passed.length}`)
    console.log(`Failed: ${failed.length}`)

    if (failed.length > 0) {
        console.log("\nFailed Tests:")
        failed.forEach(f => {
            console.log(`  - ${f.name}: ${f.error}`)
        })
    }

    console.log("\nTest Durations:")
    results.forEach(r => {
        console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}: ${r.duration}ms`)
    })

    console.log("\n" + "=".repeat(60))

    if (failed.length === 0) {
        console.log("🎉 ALL TESTS PASSED")
    } else {
        console.log("⚠️ SOME TESTS FAILED")
    }
    console.log("=".repeat(60))
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    console.log("╔══════════════════════════════════════════════════════════╗")
    console.log("║        AGENTIX PRODUCTION TEST SUITE                    ║")
    console.log("╚══════════════════════════════════════════════════════════╝")

    console.log(`\nBackend URL: ${BACKEND_URL}`)
    console.log(`Chain ID: ${CHAIN_ID}`)

    // Check for test wallet private key
    const testPrivateKey = process.env.TEST_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY
    if (!testPrivateKey) {
        console.error("\n❌ ERROR: TEST_WALLET_PRIVATE_KEY or PRIVATE_KEY environment variable required")
        console.error("\nUsage:")
        console.error("  TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/production-test.ts")
        console.error("\nOr add to backend/.env:")
        console.error("  TEST_WALLET_PRIVATE_KEY=0x...")
        process.exit(1)
    }

    let signer: Wallet
    try {
        signer = new Wallet(testPrivateKey)
        console.log(`Test wallet: ${signer.address}`)
    } catch (error: any) {
        console.error("\n❌ ERROR: Invalid private key format")
        console.error(error.message)
        process.exit(1)
    }

    let orgId: number = 0
    let agentId: number = 0

    try {
        // Phase 1: Health checks
        await testHealthEndpoints()

        // Phase 2: Create organization
        const org = await createOrganization(signer)
        orgId = org.orgId

        // Phase 3: Create external agent
        const agent = await createExternalAgent(orgId, signer)
        agentId = agent.agentId

        // Phase 4: MCP tools
        await testMCPTools(orgId, agentId)

        // Phase 5: Whitelist (optional)
        await testWhitelist(orgId, agentId, signer)

        // Print summary
        printSummary()

        // Exit with appropriate code
        const failed = results.filter(r => !r.passed)
        process.exit(failed.length === 0 ? 0 : 1)

    } catch (error: any) {
        console.error("\n\n❌ FATAL ERROR:", error.message)
        printSummary()
        process.exit(1)
    }
}

main()
