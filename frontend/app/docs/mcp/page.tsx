import Link from 'next/link'
import { ArrowLeft, Copy, Server, Cpu, Key, Bot, Shield, Layers, Zap, Package, ArrowRight, CheckCircle, Terminal, Globe } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const metadata = {
  title: 'MCP Server Reference - Agentix',
  description: 'Model Context Protocol server documentation for Agentix.',
}

const quickStartCode = `# Register agent via MCP
curl -X POST http://127.0.0.1:3001/mcp/call \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "register_agent",
    "arguments": {
      "orgId": 1,
      "agentType": "openclaude",
      "name": "My Agent",
      "endpoint": "http://localhost:8080"
    }
  }'

# Response
{
  "content": [{
    "type": "text",
    "text": "{\\"success\\":true,\\"agent\\":{\\"id\\":1,...}}"
  }]
}`

const transportCode = `# HTTP Direct Call (simplest)
POST /mcp/call
Content-Type: application/json

{
  "name": "register_agent",
  "arguments": { ... }
}

# Server-Sent Events (full MCP transport)
GET /mcp/sse
Accept: text/event-stream

# Stdio (for CLI integration)
# Configure in MCP client settings`

const allToolsCode = `# List all available MCP tools
GET /mcp/tools

# Response
{
  "tools": [
    { "name": "register_agent", "description": "Register a new external AI agent" },
    { "name": "execute_action", "description": "Execute an action on an agent" },
    ...
  ],
  "serverInfo": {
    "name": "agentix",
    "version": "1.0.0"
  }
}`

const registerAgentCode = `# register_agent - Register a new external AI agent
POST /mcp/call
{
  "name": "register_agent",
  "arguments": {
    "orgId": 1,                  // Required: Organization ID
    "agentType": "openclaude",   // Required: Agent provider type
    "name": "Treasury Manager",  // Required: Human-readable name
    "endpoint": "http://...",    // Optional: Agent endpoint URL
    "metadata": { ... }          // Optional: Additional metadata
  }
}

# Supported agent types
# openclaude, langchain, claude_code, crewai,
# llama_index, autogen, smolagents, custom`

const executeActionCode = `# execute_action - Execute an action on a registered agent
POST /mcp/call
{
  "name": "execute_action",
  "arguments": {
    "agentId": 1,                // Required: Agent ID
    "orgId": 1,                  // Required: Organization ID
    "action": "read_file",       // Required: Action type
    "params": { "path": "..." }, // Required: Action parameters
    "timeout": 30000,            // Optional: Timeout in ms
    "credentialProof": { ... }   // Optional: ZK proof
  }
}

# Action types:
# read_file | write_file | execute_command | query
# api_call | sign_transaction | deploy_contract | custom`

const getAgentStateCode = `# get_agent_state - Get full agent state
POST /mcp/call
{
  "name": "get_agent_state",
  "arguments": {
    "agentId": 1,
    "orgId": 1
  }
}

# Response includes:
# - Agent details (name, type, endpoint, status)
# - Linked protocol agent
# - Credentials
# - Active sessions
# - Wallets`

const createSessionCode = `# create_session - Create on-chain session with ZK proof
POST /mcp/call
{
  "name": "create_session",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "maxValue": "1000000000000000000",  // Optional: Max tx value
    "expirySeconds": 7200               // Optional: Duration (default 3600)
  }
}

# Response
{
  "session": {
    "sessionId": "session_0x...",
    "sessionKey": "0x...",
    "expiresAt": 1715624400
  },
  "zkProof": { ... }
}`

const listAgentsCode = `# list_agents - List all agents for organization
POST /mcp/call
{
  "name": "list_agents",
  "arguments": {
    "orgId": 1,
    "status": "active",   // Optional: Filter by status
    "limit": 50,           // Optional: Max results
    "offset": 0            // Optional: Pagination offset
  }
}

# Status values: disconnected | connecting | connected | running | paused | error`

const updateAgentCode = `# update_agent - Update agent configuration
POST /mcp/call
{
  "name": "update_agent",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "name": "New Name",           // Optional
    "endpoint": "http://...",     // Optional
    "apiKey": "...",              // Optional
    "apiSecret": "...",           // Optional
    "isActive": true,             // Optional
    "metadata": { ... }           // Optional
  }
}`

const permissionsCode = `# get_permissions - Get agent permission bitmask
POST /mcp/call
{
  "name": "get_permissions",
  "arguments": {
    "agentId": 1,
    "orgId": 1
  }
}

# Response
{
  "permissions": 255,
  "capabilities": [
    "read_file", "write_file", "execute_command",
    "query", "api_call", "sign_transaction",
    "deploy_contract", "custom"
  ]
}`

const heartbeatCode = `# heartbeat - Update agent status
POST /mcp/call
{
  "name": "heartbeat",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "status": "running",    // connected | running | paused | error
    "metadata": { ... }     // Optional: Additional info
  }
}`

const whitelistCode = `# add_whitelist - Add contract to agent's whitelist
POST /mcp/call
{
  "name": "add_whitelist",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "address": "0xContractAddress...",
    "name": "USDC",              // Optional: Contract name
    "abi": "[{...}]"             // Optional: Contract ABI JSON
  }
}

# list_whitelist - List whitelisted contracts
POST /mcp/call
{
  "name": "list_whitelist",
  "arguments": {
    "agentId": 1,
    "orgId": 1
  }
}`

const proofCode = `# generate_proof - Generate ZK authorization proof
POST /mcp/call
{
  "name": "generate_proof",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "action": "read_file",
    "expirySeconds": 3600
  }
}

# verify_proof - Verify a ZK proof
POST /mcp/call
{
  "name": "verify_proof",
  "arguments": {
    "agentId": 1,
    "orgId": 1,
    "proof": { ... },
    "action": "read_file"
  }
}`

const openclaudeConfig = `{
  "mcpServers": {
    "agentix": {
      "type": "sse",
      "url": "http://127.0.0.1:3001/mcp/sse"
    }
  }
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
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-400/10">
          <Icon className="h-5 w-5 text-pink-400" />
        </div>
        <h2 className="text-2xl font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function ToolCard({ name, description, args }: { name: string; description: string; args: { name: string; type: string; required: boolean; desc: string }[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
      <div className="flex items-center gap-3 mb-3">
        <code className="text-sm font-mono text-pink-400">{name}</code>
        <CheckCircle className="h-4 w-4 text-emerald-400" />
      </div>
      <p className="text-sm text-zinc-400 mb-4">{description}</p>
      {args.length > 0 && (
        <div className="border-t border-zinc-800 pt-3">
          <div className="text-xs text-zinc-500 mb-2">Arguments</div>
          <div className="space-y-2">
            {args.map(arg => (
              <div key={arg.name} className="flex items-center gap-2 text-xs">
                <code className="font-mono text-zinc-300">{arg.name}</code>
                <span className="text-zinc-600">:</span>
                <span className="text-blue-400">{arg.type}</span>
                {arg.required && <span className="text-red-400">*</span>}
                <span className="text-zinc-500 ml-auto">{arg.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function MCPDocsPage() {
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
            <span className="text-zinc-100">MCP Server</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/docs/sdk" className="text-zinc-400 hover:text-zinc-200">SDK Reference</Link>
            <Link href="/docs/api" className="text-zinc-400 hover:text-zinc-200">API Reference</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Hero */}
        <div className="max-w-3xl mb-12">
          <div className="flex items-center gap-2 mb-4">
            <span className="rounded-full bg-pink-400/10 px-3 py-1 text-xs font-medium text-pink-400">MCP</span>
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">v1.0.0</span>
            <span className="rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-400">15 Tools</span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">MCP Server Reference</h1>
          <p className="mt-4 text-lg text-zinc-400">
            Model Context Protocol server implementation for Agentix. Exposes agent management capabilities to AI providers like OpenClaude, LangChain, and other MCP-compatible runtimes.
          </p>
        </div>

        {/* Quick Navigation */}
        <div className="grid gap-3 sm:grid-cols-4 mb-16">
          {[
            { label: 'Quick Start', id: 'quickstart' },
            { label: 'Transport', id: 'transport' },
            { label: 'All Tools', id: 'tools' },
            { label: 'Integration', id: 'integration' },
          ].map(({ label, id }) => (
            <a key={id} href={`#${id}`} className="text-sm text-zinc-400 hover:text-zinc-200 text-center py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              {label}
            </a>
          ))}
        </div>

        {/* Quick Start */}
        <Section id="quickstart" title="Quick Start" icon={Zap}>
          <p className="text-zinc-400 mb-6">
            The simplest way to use MCP is via the HTTP direct call endpoint:
          </p>
          <CodeBlock code={quickStartCode} language="bash" />
        </Section>

        {/* Transport Modes */}
        <Section id="transport" title="Transport Modes" icon={Server}>
          <p className="text-zinc-400 mb-6">
            Agentix MCP supports three transport modes for different integration scenarios:
          </p>
          <CodeBlock code={transportCode} />

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { name: 'HTTP Direct', url: 'POST /mcp/call', desc: 'Simple REST endpoint' },
              { name: 'SSE', url: 'GET /mcp/sse', desc: 'Server-Sent Events' },
              { name: 'Stdio', url: 'Local CLI', desc: 'Standard I/O' },
            ].map(({ name, url, desc }) => (
              <div key={name} className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
                <div className="font-medium mb-1">{name}</div>
                <code className="text-xs font-mono text-pink-400">{url}</code>
                <p className="text-xs text-zinc-500 mt-2">{desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* All Tools */}
        <Section id="tools" title="Available Tools" icon={Cpu}>
          <CodeBlock code={allToolsCode} />

          <h3 className="text-lg font-medium my-8">Tool Details</h3>
          <div className="grid gap-6">
            <ToolCard
              name="register_agent"
              description="Register a new external AI agent in the system."
              args={[
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
                { name: 'agentType', type: 'string', required: true, desc: 'Agent provider type' },
                { name: 'name', type: 'string', required: true, desc: 'Human-readable name' },
                { name: 'endpoint', type: 'string', required: false, desc: 'Agent endpoint URL' },
                { name: 'metadata', type: 'object', required: false, desc: 'Additional metadata' },
              ]}
            />

            <ToolCard
              name="execute_action"
              description="Execute an action on a registered agent."
              args={[
                { name: 'agentId', type: 'number', required: true, desc: 'Agent ID' },
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
                { name: 'action', type: 'string', required: true, desc: 'Action type' },
                { name: 'params', type: 'object', required: true, desc: 'Action parameters' },
                { name: 'timeout', type: 'number', required: false, desc: 'Timeout in ms' },
              ]}
            />

            <ToolCard
              name="get_agent_state"
              description="Get full agent state including credentials, sessions, and wallets."
              args={[
                { name: 'agentId', type: 'number', required: true, desc: 'Agent ID' },
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
              ]}
            />

            <ToolCard
              name="create_session"
              description="Create an on-chain session with ZK proof."
              args={[
                { name: 'agentId', type: 'number', required: true, desc: 'Agent ID' },
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
                { name: 'maxValue', type: 'string', required: false, desc: 'Max tx value' },
                { name: 'expirySeconds', type: 'number', required: false, desc: 'Duration (default: 3600)' },
              ]}
            />

            <ToolCard
              name="list_agents"
              description="List all agents for an organization."
              args={[
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
                { name: 'status', type: 'string', required: false, desc: 'Filter by status' },
                { name: 'limit', type: 'number', required: false, desc: 'Max results (default: 50)' },
                { name: 'offset', type: 'number', required: false, desc: 'Pagination offset' },
              ]}
            />

            <ToolCard
              name="update_agent"
              description="Update agent configuration."
              args={[
                { name: 'agentId', type: 'number', required: true, desc: 'Agent ID' },
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
                { name: 'name', type: 'string', required: false, desc: 'New name' },
                { name: 'endpoint', type: 'string', required: false, desc: 'New endpoint' },
              ]}
            />

            <ToolCard
              name="get_permissions"
              description="Get agent permission bitmask and capabilities."
              args={[
                { name: 'agentId', type: 'number', required: true, desc: 'Agent ID' },
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
              ]}
            />

            <ToolCard
              name="heartbeat"
              description="Send heartbeat to update agent status."
              args={[
                { name: 'agentId', type: 'number', required: true, desc: 'Agent ID' },
                { name: 'orgId', type: 'number', required: true, desc: 'Organization ID' },
                { name: 'status', type: 'string', required: false, desc: 'Status value' },
              ]}
            />
          </div>
        </Section>

        {/* Execution Actions */}
        <Section id="execution" title="Execute Actions" icon={Terminal}>
          <p className="text-zinc-400 mb-6">
            Execute actions on registered agents with full parameter control:
          </p>
          <CodeBlock code={executeActionCode} />
        </Section>

        {/* Sessions */}
        <Section id="sessions" title="Session Management" icon={Layers}>
          <CodeBlock code={createSessionCode} />
        </Section>

        {/* Permissions */}
        <Section id="permissions" title="Permissions" icon={Key}>
          <CodeBlock code={permissionsCode} />
        </Section>

        {/* Whitelist */}
        <Section id="whitelist" title="Whitelist Management" icon={Shield}>
          <CodeBlock code={whitelistCode} />
        </Section>

        {/* Proofs */}
        <Section id="proofs" title="ZK Proofs" icon={Shield}>
          <CodeBlock code={proofCode} />
        </Section>

        {/* Heartbeat */}
        <Section id="heartbeat" title="Heartbeat" icon={Cpu}>
          <CodeBlock code={heartbeatCode} />
        </Section>

        {/* Integration */}
        <Section id="integration" title="Integration" icon={Package}>
          <h3 className="text-lg font-medium mb-4">OpenClaude CLI</h3>
          <p className="text-zinc-400 mb-4">
            Add this configuration to your MCP settings:
          </p>
          <CodeBlock code={openclaudeConfig} language="json" />

          <h3 className="text-lg font-medium mb-4 mt-8">Using curl</h3>
          <CodeBlock code={`# List available tools
curl http://127.0.0.1:3001/mcp/tools

# Register agent
curl -X POST http://127.0.0.1:3001/mcp/call \\
  -H "Content-Type: application/json" \\
  -d '{"name":"register_agent","arguments":{"orgId":1,"agentType":"openclaude","name":"My Agent"}}'

# Execute action
curl -X POST http://127.0.0.1:3001/mcp/call \\
  -H "Content-Type: application/json" \\
  -d '{"name":"execute_action","arguments":{"agentId":1,"orgId":1,"action":"read_file","params":{"path":"/data"}}}'`} language="bash" />

          <h3 className="text-lg font-medium mb-4 mt-8">JavaScript/TypeScript</h3>
          <CodeBlock code={`const response = await fetch('http://127.0.0.1:3001/mcp/call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'register_agent',
    arguments: {
      orgId: 1,
      agentType: 'openclaude',
      name: 'My Agent'
    }
  })
})

const result = await response.json()
console.log(result.content[0].text)`} />
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
            <Link href="/docs/api" className="flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              <Globe className="h-5 w-5 text-blue-400" />
              <div>
                <div className="font-medium">API Reference</div>
                <div className="text-sm text-zinc-500">REST endpoints</div>
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
