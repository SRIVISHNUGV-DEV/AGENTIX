import Link from 'next/link'
import { Search, Plus, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function AgentsPage() {
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
            <Link href="/agents" className="text-white">
              Agents
            </Link>
            <Link href="/docs" className="text-zinc-400 hover:text-white transition-colors">
              Docs
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Agents</h1>
            <p className="text-zinc-400 mt-1">Manage registered agent identities</p>
          </div>
          <Button className="bg-white text-black hover:bg-zinc-200 rounded-lg flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Register Agent
          </Button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search agents..."
              className="pl-10 bg-zinc-900 border-zinc-800 focus:border-zinc-600 rounded-lg"
            />
          </div>
        </div>

        {/* Empty State */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
          <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-zinc-500" />
          </div>
          <h3 className="text-lg font-medium mb-2">No agents registered</h3>
          <p className="text-zinc-400 mb-6 max-w-md mx-auto">
            Register your first agent to start issuing credentials and creating sessions.
          </p>
          <Button className="bg-white text-black hover:bg-zinc-200 rounded-lg">
            Register Your First Agent
          </Button>
        </div>
      </main>
    </div>
  )
}
