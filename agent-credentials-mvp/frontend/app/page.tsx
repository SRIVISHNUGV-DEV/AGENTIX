import Link from 'next/link'
import { ArrowRight, Shield, Key, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata = {
  title: 'Agentix - Private Credentials for AI Agents',
  description: 'Issue and verify private agent credentials with zero-knowledge proofs.',
}

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-zinc-400" />
            <span className="font-semibold tracking-tight">Agentix</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href="/docs" className="hover:text-zinc-200">Docs</Link>
            <Link href="/dashboard" className="hover:text-zinc-200">Dashboard</Link>
            <Link href="/login">
              <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                Sign In
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl leading-tight">
            Private credentials for autonomous agents
          </h1>
          <p className="mt-6 text-lg text-zinc-400 leading-relaxed max-w-2xl">
            Issue zero-knowledge credentials, manage agent sessions, and control on-chain wallets.
            Secrets stay private. Verification stays fast.
          </p>

          <div className="mt-10 flex gap-4">
            <Link href="/dashboard">
              <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200 px-6">
                Open Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/docs">
              <Button variant="outline" className="border-zinc-700 bg-transparent hover:bg-zinc-800 px-6">
                Documentation
              </Button>
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-20 grid gap-6 sm:grid-cols-3">
          {[
            {
              icon: Key,
              title: 'Private Credentials',
              description: 'Issue credentials with Poseidon commitments. Raw secrets never leave your infrastructure.',
            },
            {
              icon: Shield,
              title: 'ZK Verification',
              description: 'Prove credential possession without revealing the secret. Groth16 proofs verified on-chain.',
            },
            {
              icon: Wallet,
              title: 'Session Wallets',
              description: 'Deploy ERC-4337 wallets per agent. Bound sessions with permissions and expiry.',
            },
          ].map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
              <Icon className="h-5 w-5 text-zinc-500" />
              <h3 className="mt-4 font-medium">{title}</h3>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        {/* Protocol Stats */}
        <div className="mt-16 rounded-lg border border-zinc-800 p-6">
          <div className="grid gap-8 sm:grid-cols-4">
            {[
              { label: 'Zero Knowledge', value: 'Groth16' },
              { label: 'Hash Function', value: 'Poseidon' },
              { label: 'Wallet Standard', value: 'ERC-4337' },
              { label: 'Network', value: 'Sepolia' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider">{label}</div>
                <div className="mt-1 font-medium">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-20">
        <div className="mx-auto max-w-6xl px-6 py-8 flex items-center justify-between text-sm text-zinc-500">
          <span>Agentix Protocol</span>
          <div className="flex gap-6">
            <Link href="/docs" className="hover:text-zinc-300">Documentation</Link>
            <Link href="https://github.com" className="hover:text-zinc-300">GitHub</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
