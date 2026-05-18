import Link from 'next/link'
import { ArrowLeft, Copy, Globe, Server, Key, Users, Bot, Shield, Wallet, FileJson, Terminal, BookOpen, Layers, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const metadata = {
  title: 'API Reference - Agentix',
  description: 'Complete REST API documentation for Agentix Protocol.',
}

const baseUrl = 'http://127.0.0.1:3001 (dev) | https://api.agentix.io (prod)'

const authCode = `// All mutating operations require wallet signatures
interface SignedRequest {
  signature: string      // EIP-191 personal_sign signature
  message: string        // JSON stringified message
  nonce: string          // UUID for replay protection
  requestedAt: number    // Unix timestamp in seconds
}

// Example: Creating a signed request
const message = {
  action: "create_agent",
  orgId: 1,
  nonce: crypto.randomUUID(),
  requestedAt: Math.floor(Date.now() / 1000)
}

const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [JSON.stringify(message), walletAddress]
})

// Send to API
const response = await fetch('/external', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...message, signature })
})`

const orgsCode = `# List all organizations
GET /orgs

# Response
[
  { "id": 1, "name": "Agentix", "ownerWalletAddress": "0x...", "created_at": 1715624400 }
]

# Create organization (requires signature)
POST /orgs
{
  "name": "My Organization",
  "walletAddress": "0x...",
  "signature": "...",
  "message": "...",
  "nonce": "uuid-v4",
  "requestedAt": 1715624400
}

# Response
{ "id": 1, "name": "My Organization", "ownerWalletAddress": "0x..." }

# Get organization state (includes agents, credentials, wallets, sessions)
GET /orgs/:orgId/state`

const agentsCode = `# List agents for organization
GET /agents?orgId=1

# Get single agent
GET /agents/:agentId

# Provision agent (auto-creates org if needed)
POST /v1/agents/provision
{
  "orgId": 1,
  "orgName": "MyOrg",
  "agentName": "Treasury Agent"
}

# Response
{
  "success": true,
  "orgId": 1,
  "agentId": 42,
  "next": {
    "credentialRegisterUrl": "/credentials",
    "proofBundleUrl": "/proofs/bundle",
    "sessionSubmitUrl": "/sessions",
    "revokeUrl": "/credentials/revoke",
    "walletCreateUrl": "/wallets"
  }
}`

const externalCode = `# List external agents
GET /external?orgId=1
GET /external-agents?orgId=1   # Alias for frontend compatibility

# Response
[
  {
    "id": 1,
    "org_id": 1,
    "agent_name": "Treasury Manager",
    "agent_type": "openclaude",
    "agent_endpoint": "http://localhost:8080",
    "status": "active",
    "linked_agent_id": 42,
    "created_at": 1715624400
  }
]

# Create external agent (requires signature)
POST /external
{
  "orgId": 1,
  "agentType": "openclaude",
  "name": "Treasury Manager",
  "endpoint": "http://localhost:8080",
  "signature": "...",
  "message": "...",
  "nonce": "uuid-v4",
  "requestedAt": 1715624400
}

# Supported agent types
# openclaude, langchain, claude_code, crewai, llama_index, autogen, smolagents, custom

# Get single agent
GET /external/:agentId?orgId=1

# Update agent
PATCH /external/:agentId
{
  "orgId": 1,
  "name": "New Name",
  "endpoint": "http://new-endpoint:8080"
}`

const executionCode = `# Execute action on agent (requires signature)
POST /external/:agentId/execute
{
  "action": "read_file",
  "params": { "path": "/data/config.json" },
  "nonce": "uuid-v4",
  "requestedAt": 1715624400,
  "timeout": 30000
}

# Action Types:
# read_file      - { path: string }
# write_file     - { path: string, content: string }
# execute_command - { command: string, args?: string[], cwd?: string }
# query          - { query: string, params?: any[] }
# api_call       - { url: string, method?: "GET"|"POST"|"PUT"|"DELETE", headers?: {}, body?: any }
# sign_transaction - { to: string, value: string, data?: string }
# deploy_contract - { bytecode: string, abi: any, constructorArgs?: any[] }
# custom         - { customType: string, ... }

# Response
{
  "success": true,
  "execution": {
    "id": "uuid-v4",
    "externalAgentId": "1",
    "action": "read_file",
    "params": { "path": "/data/config.json" },
    "result": { "content": "..." },
    "success": true,
    "executionTimeMs": 150,
    "createdAt": "2026-05-14T10:00:00Z",
    "status": "success"
  }
}

# Get execution history
GET /external/:agentId/executions?orgId=1&limit=50
GET /external-agents/:agentId/executions?orgId=1&limit=50

# Get execution statistics
GET /external/:agentId/executions/stats?orgId=1
# Response
{
  "total": 100,
  "successful": 95,
  "failed": 5,
  "avgTime": 250,
  "lastExecution": 1715624400
}`

const credentialsCode = `# List credentials for agent
GET /credentials?agentId=1

# Register credential (requires signature)
POST /credentials
{
  "agentId": 1,
  "orgId": 1,
  "permissions": 255,
  "expiry": 1715624400,
  "commitment": "123456789012345678",
  "secretHash": "987654321098765432"
}

# Revoke credential
POST /credentials/revoke
{
  "agentId": 1,
  "secretHash": "..."
}

# Get agent credentials
GET /external/:agentId/credentials?orgId=1
POST /external/:agentId/credentials`

const sessionsCode = `# List sessions
GET /sessions?orgId=1

# Create session with ZK proof
POST /sessions
{
  "agentId": 1,
  "sessionId": "session_0x...",
  "sessionKey": "0x...",
  "maxValue": "1000000000000000000",
  "expiry": 1715624400,
  "proof": { ... },
  "publicSignals": [...]
}`

const walletsCode = `# List wallets
GET /wallets?agentId=1

# Create ERC-4337 wallet
POST /wallets
{
  "ownerAddress": "0x...",
  "agentId": 1
}

# Response
{
  "success": true,
  "txHash": "0x...",
  "walletAddress": "0x...",
  "ownerAddress": "0x...",
  "sessionManagerAddress": "0x...",
  "implementationAddress": "0x...",
  "entryPointAddress": "0x...",
  "walletKind": "erc4337"
}

# Whitelist management
GET /wallets/:address/whitelist
POST /wallets/:address/whitelist
DELETE /wallets/:address/whitelist/:party`

const eventsCode = `# List blockchain events
GET /events?orgId=1&contractName=SessionManager&limit=50

# Sync events from blockchain
POST /events/sync`

const errorCode = `# Error response format
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}

# Common error codes:
# validation_error   - Invalid request parameters
# not_found          - Resource not found
# unauthorized       - Missing or invalid signature
# forbidden          - Insufficient permissions
# conflict           - Resource already exists
# rate_limited       - Too many requests
# internal_error     - Server error

# Example error
{
  "error": "orgId must be an integer",
  "code": "validation_error"
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
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-400/10">
          <Icon className="h-5 w-5 text-blue-400" />
        </div>
        <h2 className="text-2xl font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function EndpointCard({ method, path, description }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; description: string }) {
  const methodColors = {
    GET: 'text-emerald-400 bg-emerald-400/10',
    POST: 'text-blue-400 bg-blue-400/10',
    PATCH: 'text-orange-400 bg-orange-400/10',
    DELETE: 'text-red-400 bg-red-400/10',
  }

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg border border-zinc-800 bg-zinc-900/30">
      <span className={`px-2 py-1 rounded text-xs font-mono font-medium ${methodColors[method]}`}>{method}</span>
      <code className="text-sm font-mono text-zinc-300">{path}</code>
      <span className="text-sm text-zinc-500 ml-auto">{description}</span>
    </div>
  )
}

export default function APIDocsPage() {
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
            <span className="text-zinc-100">API Reference</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/docs/sdk" className="text-zinc-400 hover:text-zinc-200">SDK Reference</Link>
            <Link href="/docs/mcp" className="text-zinc-400 hover:text-zinc-200">MCP Server</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Hero */}
        <div className="max-w-3xl mb-12">
          <div className="flex items-center gap-2 mb-4">
            <span className="rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-400">REST API</span>
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">v1.0.0</span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">API Reference</h1>
          <p className="mt-4 text-lg text-zinc-400">
            Complete REST API documentation for Agentix Protocol. All endpoints return JSON with consistent error handling.
          </p>
          <div className="mt-4 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <div className="text-xs text-zinc-500 mb-1">Base URL</div>
            <code className="text-sm font-mono text-zinc-300">{baseUrl}</code>
          </div>
        </div>

        {/* Quick Navigation */}
        <div className="grid gap-3 sm:grid-cols-4 mb-16">
          {[
            { label: 'Authentication', id: 'auth' },
            { label: 'Organizations', id: 'orgs' },
            { label: 'Agents', id: 'agents' },
            { label: 'Executions', id: 'executions' },
          ].map(({ label, id }) => (
            <a key={id} href={`#${id}`} className="text-sm text-zinc-400 hover:text-zinc-200 text-center py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              {label}
            </a>
          ))}
        </div>

        {/* Authentication */}
        <Section id="auth" title="Authentication" icon={Key}>
          <p className="text-zinc-400 mb-6">
            All mutating operations require wallet signatures using EIP-191 personal_sign. This ensures only the wallet owner can perform actions on their behalf.
          </p>
          <CodeBlock code={authCode} />
        </Section>

        {/* Organizations */}
        <Section id="orgs" title="Organizations" icon={Users}>
          <p className="text-zinc-400 mb-6">
            Organizations group agents, credentials, wallets, and sessions under a single entity.
          </p>
          <CodeBlock code={orgsCode} />

          <h3 className="text-lg font-medium mb-4 mt-8">Endpoints</h3>
          <div className="grid gap-2">
            <EndpointCard method="GET" path="/orgs" description="List all organizations" />
            <EndpointCard method="POST" path="/orgs" description="Create organization (signed)" />
            <EndpointCard method="GET" path="/orgs/:orgId/state" description="Get org with all related data" />
          </div>
        </Section>

        {/* Agents */}
        <Section id="agents" title="Agents" icon={Bot}>
          <p className="text-zinc-400 mb-6">
            Protocol-native agents with ZK credentials. Use the provision endpoint to auto-create org and agent.
          </p>
          <CodeBlock code={agentsCode} />

          <h3 className="text-lg font-medium mb-4 mt-8">Endpoints</h3>
          <div className="grid gap-2">
            <EndpointCard method="GET" path="/agents?orgId=:id" description="List agents for org" />
            <EndpointCard method="GET" path="/agents/:agentId" description="Get single agent" />
            <EndpointCard method="POST" path="/v1/agents/provision" description="Provision new agent" />
          </div>
        </Section>

        {/* External Agents */}
        <Section id="external" title="External Agents" icon={Server}>
          <p className="text-zinc-400 mb-6">
            External AI runtimes (OpenClaude, LangChain, etc.) registered with Agentix. These map to protocol-native agents via `linked_agent_id`.
          </p>
          <CodeBlock code={externalCode} />

          <h3 className="text-lg font-medium mb-4 mt-8">Supported Agent Types</h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {['openclaude', 'langchain', 'claude_code', 'crewai', 'llama_index', 'autogen', 'smolagents', 'custom'].map(type => (
              <div key={type} className="p-2 rounded border border-zinc-800 bg-zinc-900/30 text-center text-sm font-mono">
                {type}
              </div>
            ))}
          </div>

          <h3 className="text-lg font-medium mb-4 mt-8">Endpoints</h3>
          <div className="grid gap-2">
            <EndpointCard method="GET" path="/external?orgId=:id" description="List external agents" />
            <EndpointCard method="POST" path="/external" description="Create external agent (signed)" />
            <EndpointCard method="GET" path="/external/:agentId" description="Get single agent" />
            <EndpointCard method="PATCH" path="/external/:agentId" description="Update agent" />
          </div>
        </Section>

        {/* Executions */}
        <Section id="executions" title="Executions" icon={Terminal}>
          <p className="text-zinc-400 mb-6">
            Execute actions on external agents and monitor execution history.
          </p>
          <CodeBlock code={executionCode} />

          <h3 className="text-lg font-medium mb-4 mt-8">Action Types</h3>
          <div className="grid gap-2">
            {[
              { action: 'read_file', params: '{ path: string }', desc: 'Read file contents' },
              { action: 'write_file', params: '{ path, content }', desc: 'Write file contents' },
              { action: 'execute_command', params: '{ command, args?, cwd? }', desc: 'Run shell command' },
              { action: 'query', params: '{ query, params? }', desc: 'Database query' },
              { action: 'api_call', params: '{ url, method?, headers?, body? }', desc: 'HTTP API call' },
              { action: 'sign_transaction', params: '{ to, value, data? }', desc: 'Sign blockchain tx' },
              { action: 'deploy_contract', params: '{ bytecode, abi, constructorArgs? }', desc: 'Deploy contract' },
              { action: 'custom', params: '{ customType, ... }', desc: 'Custom action' },
            ].map(({ action, params, desc }) => (
              <div key={action} className="flex items-center gap-4 p-3 rounded-lg border border-zinc-800 bg-zinc-900/30">
                <code className="text-sm font-mono text-blue-400">{action}</code>
                <code className="text-xs font-mono text-zinc-500">{params}</code>
                <span className="text-sm text-zinc-400 ml-auto">{desc}</span>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-medium mb-4 mt-8">Endpoints</h3>
          <div className="grid gap-2">
            <EndpointCard method="POST" path="/external/:agentId/execute" description="Execute action (signed)" />
            <EndpointCard method="GET" path="/external/:agentId/executions" description="Get execution history" />
            <EndpointCard method="GET" path="/external/:agentId/executions/stats" description="Get execution stats" />
          </div>
        </Section>

        {/* Credentials */}
        <Section id="credentials" title="Credentials" icon={Shield}>
          <p className="text-zinc-400 mb-6">
            ZK-backed credentials authorize agents to perform specific actions. Each credential has permission bitmasks and expiry.
          </p>
          <CodeBlock code={credentialsCode} />
        </Section>

        {/* Sessions */}
        <Section id="sessions" title="Sessions" icon={Layers}>
          <p className="text-zinc-400 mb-6">
            On-chain sessions with ZK proofs for time-limited authorizations. Sessions allow agents to transact on behalf of wallets.
          </p>
          <CodeBlock code={sessionsCode} />
        </Section>

        {/* Wallets */}
        <Section id="wallets" title="Wallets" icon={Wallet}>
          <p className="text-zinc-400 mb-6">
            ERC-4337 compliant smart contract wallets deployed for agents. Includes whitelist management for allowed contracts.
          </p>
          <CodeBlock code={walletsCode} />
        </Section>

        {/* Events */}
        <Section id="events" title="Events" icon={FileJson}>
          <p className="text-zinc-400 mb-6">
            Indexed blockchain events for session management, credentials, and wallet operations.
          </p>
          <CodeBlock code={eventsCode} />
        </Section>

        {/* Error Handling */}
        <Section id="errors" title="Error Handling" icon={Key}>
          <p className="text-zinc-400 mb-6">
            All errors follow a consistent JSON format with error code and message.
          </p>
          <CodeBlock code={errorCode} />
        </Section>

        {/* Rate Limits */}
        <Section id="rate-limits" title="Rate Limits" icon={Shield}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
              <div className="text-sm text-zinc-500 mb-1">Production</div>
              <div className="text-2xl font-semibold">100</div>
              <div className="text-sm text-zinc-500">requests / 15 min</div>
            </div>
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
              <div className="text-sm text-zinc-500 mb-1">Development</div>
              <div className="text-2xl font-semibold">1000</div>
              <div className="text-sm text-zinc-500">requests / 15 min</div>
            </div>
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
              <div className="text-sm text-zinc-500 mb-1">Auth Endpoints</div>
              <div className="text-2xl font-semibold">10</div>
              <div className="text-sm text-zinc-500">requests / 1 min</div>
            </div>
          </div>
        </Section>

        {/* Next Steps */}
        <div className="mt-16 rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <h3 className="text-xl font-semibold mb-4">Next Steps</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link href="/docs/sdk" className="flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              <Terminal className="h-5 w-5 text-emerald-400" />
              <div>
                <div className="font-medium">SDK Reference</div>
                <div className="text-sm text-zinc-500">TypeScript SDK</div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 ml-auto" />
            </Link>
            <Link href="/docs/mcp" className="flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              <Server className="h-5 w-5 text-pink-400" />
              <div>
                <div className="font-medium">MCP Server</div>
                <div className="text-sm text-zinc-500">Model Context Protocol</div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 ml-auto" />
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-800 mt-20">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center">
          Agentix Protocol • MIT License • <Link href="https://github.com/SRIVISHNUGV-DEV/AGENTIX" className="hover:text-zinc-300">GitHub</Link>
        </div>
      </footer>
    </div>
  )
}
