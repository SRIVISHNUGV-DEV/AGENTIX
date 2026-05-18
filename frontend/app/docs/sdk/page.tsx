import Link from 'next/link'
import { ArrowLeft, Copy, Check, Terminal, Package, Key, Wallet, Clock, Shield, Zap, Code2, BookOpen, Layers, Globe } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const metadata = {
  title: 'SDK Reference - Agentix',
  description: 'Complete TypeScript SDK documentation for Agentix Protocol.',
}

const installCode = `npm install @agentix/sdk

# Or with yarn
yarn add @agentix/sdk

# Or with pnpm
pnpm add @agentix/sdk`

const quickStartCode = `import { AgentClient, AGENT_PERMISSIONS } from "@agentix/sdk"

// Step 1: Initialize the client
const client = new AgentClient("http://127.0.0.1:3001")
await client.init()

// Step 2: Register an agent
const registration = await client.registerAgent({
  orgId: 1,
  agentName: "Treasury Manager",
  permissions: AGENT_PERMISSIONS.ALL,
  expiry: Math.floor(Date.now() / 1000) + 86400 * 30  // 30 days
})

console.log("Agent ID:", registration.agentId)
// Agent ID: 42`

const fullFlowCode = `import { AgentClient, AGENT_PERMISSIONS } from "@agentix/sdk"

async function main() {
  // ============================================
  // STEP 1: Initialize Client
  // ============================================
  const client = new AgentClient("http://127.0.0.1:3001")
  await client.init()  // Required: initializes Poseidon hash

  // ============================================
  // STEP 2: Register Agent
  // ============================================
  const registration = await client.registerAgent({
    orgId: 1,
    agentName: "My Production Agent",
    permissions: AGENT_PERMISSIONS.READ_FILE | AGENT_PERMISSIONS.WRITE_FILE,
    expiry: Math.floor(Date.now() / 1000) + 86400 * 30
  })

  const { agentId, orgId } = registration

  // ============================================
  // STEP 3: Create Wallet (ERC-4337)
  // ============================================
  const wallet = await client.createWallet({
    ownerAddress: "0xYourWalletAddress...",
    agentId: agentId
  })

  console.log("Wallet deployed:", wallet.walletAddress)

  // ============================================
  // STEP 4: Create On-Chain Session
  // ============================================
  const session = await client.createSession({
    agentId: agentId,
    orgId: orgId,
    expirySeconds: 3600  // 1 hour
  })

  console.log("Session created:", session.session.sessionId)

  // ============================================
  // STEP 5: Execute Actions
  // ============================================
  const result = await client.readFile(agentId, "/data/config.json")
  console.log("File contents:", result.execution.result)
}

main().catch(console.error)`

const executionCode = `import { AgentClient } from "@agentix/sdk"

const client = new AgentClient()
await client.init()

const agentId = 42

// ============================================
// READ FILE
// ============================================
const readResult = await client.readFile(agentId, "/data/config.json")
console.log(readResult.execution.result)
// { "content": "..." }

// ============================================
// WRITE FILE
// ============================================
const writeResult = await client.writeFile(
  agentId,
  "/data/output.json",
  JSON.stringify({ status: "complete", timestamp: Date.now() })
)
console.log(writeResult.execution.success)
// true

// ============================================
// EXECUTE COMMAND
// ============================================
const cmdResult = await client.executeCommand(
  agentId,
  "npm",
  ["run", "build"],
  "/project/path"
)
console.log(cmdResult.execution.result)

// ============================================
// API CALL
// ============================================
const apiResult = await client.apiCall(
  agentId,
  "https://api.example.com/users",
  "GET"
)
console.log(apiResult.execution.result)

// ============================================
// SIGN TRANSACTION
// ============================================
const txResult = await client.signTransaction(
  agentId,
  "0xRecipientAddress...",
  "1000000000000000000",  // 1 ETH in wei
  "0x"  // data
)

// ============================================
// CUSTOM ACTION
// ============================================
const customResult = await client.customAction(
  agentId,
  "my_custom_action",
  { param1: "value1", param2: "value2" }
)`

const permissionsCode = `import { AGENT_PERMISSIONS } from "@agentix/sdk"

// Individual permissions (bitmasks)
AGENT_PERMISSIONS.READ_FILE         // 1
AGENT_PERMISSIONS.WRITE_FILE        // 2
AGENT_PERMISSIONS.EXECUTE_COMMAND   // 4
AGENT_PERMISSIONS.QUERY             // 8
AGENT_PERMISSIONS.API_CALL          // 16
AGENT_PERMISSIONS.SIGN_TRANSACTION  // 32
AGENT_PERMISSIONS.DEPLOY_CONTRACT   // 64
AGENT_PERMISSIONS.CUSTOM            // 128
AGENT_PERMISSIONS.ALL               // 255

// Combine permissions with bitwise OR
const readWrite = AGENT_PERMISSIONS.READ_FILE | AGENT_PERMISSIONS.WRITE_FILE  // 3

// Check permission with bitwise AND
const canWrite = (permissions & AGENT_PERMISSIONS.WRITE_FILE) !== 0`

const walletCode = `// ============================================
// CREATE WALLET WITH AUTO-GENERATED OWNER
// ============================================
const wallet = await client.createWallet()

console.log("Wallet Address:", wallet.walletAddress)
console.log("Owner Address:", wallet.ownerAddress)
console.log("Private Key:", wallet.ownerPrivateKey)  // ⚠️ Store securely!

// ============================================
// CREATE WALLET WITH EXISTING OWNER
// ============================================
const wallet = await client.createWallet({
  ownerAddress: "0xMyExistingAddress..."
})

// ============================================
// CREATE WALLET FOR AGENT
// ============================================
const wallet = await client.createWallet({
  ownerAddress: "0x...",
  agentId: 42
})`

const whitelistCode = `// ============================================
// GET WHITELIST
// ============================================
const { whitelistedParties } = await client.getWhitelist(
  "0xWalletAddress..."
)
console.log(whitelistedParties)
// ["0xContract1...", "0xContract2..."]

// ============================================
// ADD TO WHITELIST
// ============================================
const result = await client.addToWhitelist(
  "0xWalletAddress...",
  "0xContractToAdd...",
  signature,
  nonce,
  requestedAt
)

// ============================================
// REMOVE FROM WHITELIST
// ============================================
const result = await client.removeFromWhitelist(
  "0xWalletAddress...",
  "0xContractToRemove...",
  signature,
  nonce,
  requestedAt
)`

const sessionCode = `// ============================================
// CREATE SESSION
// ============================================
const session = await client.createSession({
  agentId: 42,
  orgId: 1,
  expirySeconds: 7200  // 2 hours
})

console.log("Session ID:", session.session.sessionId)
console.log("Session Key:", session.sessionKey)
console.log("Expires:", new Date(session.session.expiresAt * 1000))

// ============================================
// LOW-LEVEL SESSION MANAGER
// ============================================
const manager = client.sessionManager()

// Fetch Merkle proof for agent
const proof = await manager.fetchMerkleProof(agentId)

// Generate ZK proof
const zkProof = await manager.generateProof(
  agentId,
  orgId,
  permissions,
  expiry,
  timestamp,
  proofBundle
)

// Submit session on-chain
const result = await manager.submitSession(
  agentId,
  zkProof,
  sessionKeyAddress
)`

const statsCode = `// ============================================
// GET EXECUTION HISTORY
// ============================================
const { executions } = await client.getExecutions(agentId, 50)

for (const exec of executions) {
  console.log(\`\${exec.action}: \${exec.status}\`)
}

// ============================================
// GET SPECIFIC EXECUTION
// ============================================
const execution = await client.getExecution(agentId, "execution-uuid")

// ============================================
// GET EXECUTION STATS
// ============================================
const { stats } = await client.getExecutionStats(agentId)

console.log("Total:", stats.totalExecutions)
console.log("Success Rate:", (stats.successfulExecutions / stats.totalExecutions * 100).toFixed(1) + "%")
console.log("Avg Time:", stats.avgExecutionTimeMs + "ms")`

const typesCode = `// Execution Types
type ExecutionAction =
  | "read_file"
  | "write_file"
  | "execute_command"
  | "query"
  | "api_call"
  | "sign_transaction"
  | "deploy_contract"
  | "custom"

type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "timeout"

// Agent Types
type AgentType =
  | "openclaude"
  | "langchain"
  | "claude_code"
  | "crewai"
  | "llama_index"
  | "autogen"
  | "smolagents"
  | "custom"

// Response Types
interface Execution {
  id: string
  externalAgentId: string
  orgId: string
  requestId: string
  action: ExecutionAction
  params: Record<string, unknown>
  proof: unknown | null
  result: unknown | null
  success: boolean
  errorMessage: string | null
  executionTimeMs: number
  createdAt: string
  status: ExecutionStatus
}

interface WalletResponse {
  success: boolean
  txHash: string
  walletAddress: string
  ownerAddress: string
  sessionManagerAddress: string
  walletKind: string
}`

function CodeBlock({ code, language = 'typescript' }: { code: string; language?: string }) {
  return (
    <div className="relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <span className="text-xs text-zinc-500 font-mono">{language}</span>
        <button className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="text-sm font-mono text-zinc-300 whitespace-pre">{code}</code>
      </pre>
    </div>
  )
}

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 mt-16 first:mt-0">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10">
          <Icon className="h-5 w-5 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function MethodCard({ name, params, returns, description }: { name: string; params: string; returns: string; description: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="font-mono text-sm">
        <span className="text-emerald-400">{name}</span>
        <span className="text-zinc-500">(</span>
        <span className="text-zinc-300">{params}</span>
        <span className="text-zinc-500">)</span>
        <span className="text-zinc-500">: </span>
        <span className="text-blue-400">{returns}</span>
      </div>
      <p className="mt-2 text-sm text-zinc-500">{description}</p>
    </div>
  )
}

export default function SDKDocsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Link href="/docs" className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" />
              Docs
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-100">SDK Reference</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/docs/api" className="text-zinc-400 hover:text-zinc-200">API Reference</Link>
            <Link href="/docs/mcp" className="text-zinc-400 hover:text-zinc-200">MCP Server</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Hero */}
        <div className="max-w-3xl mb-12">
          <div className="flex items-center gap-2 mb-4">
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">TypeScript</span>
            <span className="rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-400">v1.0.0</span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">SDK Reference</h1>
          <p className="mt-4 text-lg text-zinc-400">
            The official TypeScript SDK for integrating AI agents with the Agentix Protocol.
            Zero dependencies, fully typed, works in Node.js and browsers.
          </p>
        </div>

        {/* Quick Navigation */}
        <div className="grid gap-3 sm:grid-cols-4 mb-16">
          {[
            { label: 'Installation', id: 'installation' },
            { label: 'Quick Start', id: 'quickstart' },
            { label: 'AgentClient', id: 'agentclient' },
            { label: 'Executions', id: 'executions' },
          ].map(({ label, id }) => (
            <a key={id} href={`#${id}`} className="text-sm text-zinc-400 hover:text-zinc-200 text-center py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              {label}
            </a>
          ))}
        </div>

        {/* Installation */}
        <Section id="installation" title="Installation" icon={Package}>
          <p className="text-zinc-400 mb-6">
            Install the SDK using your preferred package manager:
          </p>
          <CodeBlock code={installCode} language="bash" />
        </Section>

        {/* Quick Start */}
        <Section id="quickstart" title="Quick Start" icon={Zap}>
          <p className="text-zinc-400 mb-6">
            Get started in 5 minutes. This minimal example registers an agent and logs the ID:
          </p>
          <CodeBlock code={quickStartCode} />
        </Section>

        {/* Full Integration Flow */}
        <section id="full-flow" className="scroll-mt-20 mt-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10">
              <Layers className="h-5 w-5 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-semibold">Complete Integration Flow</h2>
          </div>
          <p className="text-zinc-400 mb-6">
            Follow these 5 steps to fully integrate an AI agent with Agentix:
          </p>
          <CodeBlock code={fullFlowCode} />
        </section>

        {/* AgentClient */}
        <Section id="agentclient" title="AgentClient Methods" icon={Terminal}>
          <p className="text-zinc-400 mb-6">
            The <code className="text-emerald-400">AgentClient</code> class is the main entry point. Here are all available methods:
          </p>

          <h3 className="text-lg font-medium mb-4 mt-8">Initialization</h3>
          <div className="grid gap-3">
            <MethodCard name="constructor" params="backendUrl?: string" returns="AgentClient"
              description="Create a new client instance. Defaults to http://127.0.0.1:3001" />
            <MethodCard name="init" params="" returns="Promise<void>"
              description="Initialize Poseidon hash function. Must be called before other methods." />
          </div>

          <h3 className="text-lg font-medium mb-4 mt-8">Agent Registration</h3>
          <div className="grid gap-3">
            <MethodCard name="registerAgent" params="input: AgentRegistrationInput" returns="Promise<AgentRegistrationResponse>"
              description="Register a new agent with ZK credentials." />
            <MethodCard name="registerCredential" params="input: CredentialInput" returns="Promise<any>"
              description="Register credentials for an existing agent." />
            <MethodCard name="revokeAgent" params="agentId: number" returns="Promise<any>"
              description="Revoke agent credentials and deactivate." />
            <MethodCard name="getAgentState" params="agentId: number" returns="Promise<any>"
              description="Get full agent state including credentials, sessions, wallets." />
          </div>

          <h3 className="text-lg font-medium mb-4 mt-8">Wallet Operations</h3>
          <div className="grid gap-3">
            <MethodCard name="createWallet" params="options?: WalletOptions" returns="Promise<WalletResponse>"
              description="Deploy an ERC-4337 smart contract wallet for the agent." />
            <MethodCard name="getWhitelist" params="walletAddress: string" returns="Promise<WhitelistResponse>"
              description="Get whitelisted contracts for a wallet." />
            <MethodCard name="addToWhitelist" params="walletAddress, address, signature, nonce, requestedAt" returns="Promise<any>"
              description="Add contract to wallet whitelist." />
            <MethodCard name="removeFromWhitelist" params="walletAddress, address, signature, nonce, requestedAt" returns="Promise<any>"
              description="Remove contract from wallet whitelist." />
          </div>

          <h3 className="text-lg font-medium mb-4 mt-8">Session Management</h3>
          <div className="grid gap-3">
            <MethodCard name="createSession" params="input: SessionInput" returns="Promise<SessionResponse>"
              description="Create an on-chain session with ZK proof." />
            <MethodCard name="getSessions" params="orgId?: string" returns="Promise<Session[]>"
              description="List active sessions." />
          </div>
        </Section>

        {/* Executions */}
        <Section id="executions" title="Execution Methods" icon={Code2}>
          <p className="text-zinc-400 mb-6">
            Execute actions on registered agents. Each method returns an <code className="text-blue-400">Execution</code> object with the result:
          </p>
          <CodeBlock code={executionCode} />
        </Section>

        {/* Permissions */}
        <Section id="permissions" title="Permissions" icon={Key}>
          <p className="text-zinc-400 mb-6">
            Use bitmask constants to define agent capabilities. Combine with bitwise OR, check with bitwise AND:
          </p>
          <CodeBlock code={permissionsCode} />

          <div className="mt-6 grid gap-2 sm:grid-cols-4">
            {[
              { name: 'READ_FILE', value: '1', desc: 'Read file contents' },
              { name: 'WRITE_FILE', value: '2', desc: 'Write file contents' },
              { name: 'EXECUTE_COMMAND', value: '4', desc: 'Run shell commands' },
              { name: 'QUERY', value: '8', desc: 'Database queries' },
              { name: 'API_CALL', value: '16', desc: 'HTTP API calls' },
              { name: 'SIGN_TRANSACTION', value: '32', desc: 'Sign blockchain tx' },
              { name: 'DEPLOY_CONTRACT', value: '64', desc: 'Deploy smart contracts' },
              { name: 'CUSTOM', value: '128', desc: 'Custom actions' },
            ].map(({ name, value, desc }) => (
              <div key={name} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="font-mono text-sm">
                  <span className="text-emerald-400">{name}</span>
                  <span className="text-zinc-600 ml-2">= {value}</span>
                </div>
                <p className="text-xs text-zinc-500 mt-1">{desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Wallet */}
        <Section id="wallet" title="Wallet Creation" icon={Wallet}>
          <p className="text-zinc-400 mb-6">
            Deploy ERC-4337 compliant smart contract wallets for your agents:
          </p>
          <CodeBlock code={walletCode} />
        </Section>

        {/* Session */}
        <Section id="session" title="Session Management" icon={Shield}>
          <p className="text-zinc-400 mb-6">
            Create on-chain sessions with ZK proofs for time-limited agent authorizations:
          </p>
          <CodeBlock code={sessionCode} />
        </Section>

        {/* Stats */}
        <Section id="stats" title="Execution Stats" icon={Clock}>
          <p className="text-zinc-400 mb-6">
            Monitor execution history and performance metrics:
          </p>
          <CodeBlock code={statsCode} />
        </Section>

        {/* Types */}
        <Section id="types" title="TypeScript Types" icon={BookOpen}>
          <p className="text-zinc-400 mb-6">
            All types are exported from <code className="text-emerald-400">@agentix/sdk</code>:
          </p>
          <CodeBlock code={typesCode} />
        </Section>

        {/* Next Steps */}
        <div className="mt-16 rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <h3 className="text-xl font-semibold mb-4">Next Steps</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link href="/docs/api" className="flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              <Globe className="h-5 w-5 text-blue-400" />
              <div>
                <div className="font-medium">API Reference</div>
                <div className="text-sm text-zinc-500">REST API endpoints</div>
              </div>
            </Link>
            <Link href="/docs/mcp" className="flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              <Package className="h-5 w-5 text-pink-400" />
              <div>
                <div className="font-medium">MCP Server</div>
                <div className="text-sm text-zinc-500">Model Context Protocol</div>
              </div>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-800 mt-20">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center">
          Agentix Protocol • BUSR 1.1 License • <Link href="https://github.com/SRIVISHNUGV-DEV/AGENTIX" className="hover:text-zinc-300">GitHub</Link>
        </div>
      </footer>
    </div>
  )
}
