import Link from 'next/link'
import { ArrowRight, Code, Terminal, Shield, Wallet, Clock, Key } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata = {
  title: 'SDK & Self-host - Agentix',
  description: 'Use the Agentix SDK and self-hosted flow if you want to run the protocol in your own environment.',
}

const quickstart = `import { AgentClient } from "@agentix/sdk"

const client = new AgentClient("http://127.0.0.1:3000")
await client.init()

const registration = await client.registerAgent({
  orgName: "Acme Treasury",
  agentName: "Payout Agent",
  permissions: 7,
  expiry: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14
})

await client.createWallet({ agentId: registration.agentId })

const session = await client.createSession({ agentId: registration.agentId })
const state = await client.getAgentState(registration.agentId)

console.log({ registration, session, state })`

const endpoints = [
  { method: 'POST', path: '/v1/agents/provision', desc: 'Create an organization + agent in one call.' },
  { method: 'POST', path: '/credentials', desc: 'Register a credential commitment and update the active root.' },
  { method: 'GET', path: '/proofs/:agentId', desc: 'Get Merkle and revocation proof data.' },
  { method: 'POST', path: '/wallets', desc: 'Deploy an AgentWallet for the selected agent.' },
  { method: 'POST', path: '/sessions', desc: 'Submit the zk proof to create an on-chain session.' },
  { method: 'POST', path: '/credentials/revoke', desc: 'Revoke credential/session creation rights.' },
  { method: 'GET', path: '/events', desc: 'Read indexed contract events.' },
]

export default function SDKPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">SDK</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-200">Dashboard</Link>
            <Link href="/docs" className="text-zinc-400 hover:text-zinc-200">Docs</Link>
            <Link href="https://github.com" target="_blank" className="text-zinc-400 hover:text-zinc-200">GitHub</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Hero */}
        <div>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Self-host path</span>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight sm:text-5xl">
            SDK for teams that want to run the platform in their own stack.
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-zinc-400 leading-relaxed">
            The platform remains the default product framing. This page exists for infrastructure teams
            that want direct backend and SDK control, custom orchestration, or private deployments.
          </p>
        </div>

        {/* Two Column */}
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* Quickstart */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-zinc-500" />
              <h2 className="font-medium">Quickstart</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-500">One SDK flow to provision and operate</p>

            <div className="mt-6 rounded-lg bg-zinc-950 border border-zinc-800 p-4 overflow-x-auto">
              <pre className="text-sm font-mono text-zinc-300">
                <code>{quickstart}</code>
              </pre>
            </div>

            <div className="mt-4 flex gap-3">
              <Button size="sm" className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
                <Code className="mr-2 h-4 w-4" />
                npm install @agentix/sdk
              </Button>
            </div>
          </div>

          {/* Endpoints */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-zinc-500" />
              <h2 className="font-medium">Endpoints</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-500">What the SDK hits</p>

            <div className="mt-6 space-y-3">
              {endpoints.map(({ method, path, desc }) => (
                <div key={path} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-emerald-400">
                      {method}
                    </span>
                    <code className="text-sm font-mono text-zinc-300">{path}</code>
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mt-10 grid gap-4 sm:grid-cols-4">
          {[
            { icon: Code, label: 'Zero Dependencies', value: 'Lightweight SDK' },
            { icon: Terminal, label: 'TypeScript', value: 'Fully typed' },
            { icon: Shield, label: 'Security', value: 'ZK proofs on-chain' },
            { icon: Wallet, label: 'Wallet Standard', value: 'ERC-4337' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <Icon className="h-4 w-4 text-zinc-500" />
              <div className="mt-4">
                <div className="text-lg font-medium">{value}</div>
                <div className="text-sm text-zinc-500">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-20">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center">
          Agentix Protocol • Self-hosted SDK
        </div>
      </footer>
    </div>
  )
}
