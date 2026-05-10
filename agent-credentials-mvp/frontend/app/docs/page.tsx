import Link from 'next/link'
import { Book, Code, Shield, Wallet, ArrowRight } from 'lucide-react'

export default function DocsPage() {
  const sections = [
    {
      icon: Book,
      title: 'Getting Started',
      description: 'Quick start guide and installation instructions',
      href: '/docs/getting-started',
    },
    {
      icon: Shield,
      title: 'Credentials',
      description: 'Issue and verify zero-knowledge credentials',
      href: '/docs/credentials',
    },
    {
      icon: Wallet,
      title: 'Sessions & Wallets',
      description: 'Create agent sessions and deploy wallets',
      href: '/docs/sessions',
    },
    {
      icon: Code,
      title: 'API Reference',
      description: 'Complete API documentation',
      href: '/docs/api',
    },
  ]

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <div className="w-5 h-5 bg-white rounded-sm flex items-center justify-center">
              <span className="text-black text-xs font-bold">A</span>
            </div>
            <span>Agentix</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-zinc-400 hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/agents" className="text-zinc-400 hover:text-white transition-colors">
              Agents
            </Link>
            <Link href="/docs" className="text-white">
              Docs
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-semibold mb-4">Documentation</h1>
          <p className="text-zinc-400 max-w-2xl mx-auto">
            Everything you need to integrate Agentix credentials into your agent infrastructure.
          </p>
        </div>

        {/* Documentation Grid */}
        <div className="grid gap-4 sm:grid-cols-2 mb-16">
          {sections.map(({ icon: Icon, title, description, href }) => (
            <Link
              key={title}
              href={href}
              className="group flex items-start gap-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-zinc-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1 flex items-center gap-2">
                  {title}
                  <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-white transition-colors" />
                </h3>
                <p className="text-sm text-zinc-400">{description}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Protocol Specs */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 overflow-hidden">
          <div className="p-6 border-b border-zinc-800">
            <h2 className="text-xl font-semibold">Protocol Specifications</h2>
          </div>
          <div className="p-6">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Proof System</h4>
                <div className="font-mono text-sm">Groth16 (BN254)</div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Hash Function</h4>
                <div className="font-mono text-sm">Poseidon</div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Circuit Language</h4>
                <div className="font-mono text-sm">Circom</div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Wallet Standard</h4>
                <div className="font-mono text-sm">ERC-4337</div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Network</h4>
                <div className="font-mono text-sm">Sepolia Testnet</div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">API Protocol</h4>
                <div className="font-mono text-sm">REST + WebSocket</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
