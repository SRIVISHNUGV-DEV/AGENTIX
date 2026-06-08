import Link from 'next/link'
import { ArrowRight, Shield, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button'

export const metadata = {
  title: 'Connect Wallet - Agentix',
  description: 'Connect your wallet to access the platform and manage agent credentials, sessions, and treasury controls.',
}

export default function LoginPage() {
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
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-5xl grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Left */}
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Platform Access</span>
            <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
              Protocol for agent credentials and sessions
            </h1>
            <p className="mt-6 text-lg text-zinc-400 leading-relaxed max-w-xl">
              Connect your wallet to issue zero-knowledge credentials, deploy session wallets,
              and operate with on-chain proof verification. Secrets stay private. Verification stays fast.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/dashboard">
                <Button className="bg-white text-black hover:bg-zinc-200 rounded-lg px-6">
                  Open Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/docs">
                <Button variant="outline" className="border-zinc-800 bg-transparent hover:bg-zinc-900 hover:border-zinc-700 rounded-lg px-6">
                  Documentation
                </Button>
              </Link>
            </div>
          </div>

          {/* Right */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
            <div className="flex items-center justify-center">
              <div className="h-16 w-16 rounded-lg bg-zinc-800 flex items-center justify-center">
                <Shield className="h-8 w-8 text-zinc-400" />
              </div>
            </div>

            <div className="mt-6 text-center">
              <h2 className="text-xl font-medium">Connect Wallet</h2>
              <p className="mt-2 text-sm text-zinc-500">
                Use Base Sepolia testnet to interact with the protocol.
              </p>
            </div>

            <div className="mt-6 flex justify-center">
              <ConnectWalletButton />
            </div>

            <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-800/30 p-4 text-sm text-zinc-400">
              <p className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-zinc-500" />
                Connected wallet becomes your operator identity
              </p>
            </div>

            <Link href="/dashboard" className="mt-6 block">
              <Button className="w-full bg-white text-black hover:bg-zinc-200 rounded-lg">
                Enter Workspace
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-20">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center">
          Agentix Protocol • Base Sepolia Testnet • Zero-Knowledge Credentials
        </div>
      </footer>
    </div>
  )
}
