import Link from 'next/link'
import { ArrowRight, KeyRound, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgents, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'

export const metadata = {
  title: 'Issue Credential - Agentix',
  description: 'Choose an agent and issue a credential from the signed action panel.',
}

export const dynamic = 'force-dynamic'

export default async function IssueCredentialPage() {
  const [organizationsRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])
  const currentOrgId =
    selectedOrgId?.toString() ??
    organizationsRes.data[organizationsRes.data.length - 1]?.id ??
    null
  const agentsRes = await getAgents(currentOrgId)
  const agents = agentsRes.data

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <Link href="/credentials" className="text-zinc-400 hover:text-zinc-200">Credentials</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">Issue</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800">
              <KeyRound className="h-5 w-5 text-zinc-300" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Issue credential</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Select an agent, then sign the action from the agent detail page. That is the working issuance flow.
              </p>
            </div>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <Shield className="mx-auto h-10 w-10 text-zinc-600" />
            <h2 className="mt-4 text-lg font-medium">No agents available</h2>
            <p className="mt-2 text-sm text-zinc-500">Create an agent first, then come back to issue a credential.</p>
            <div className="mt-6">
              <Link href="/agents/new">
                <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">Create agent</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-medium">{agent.name}</h2>
                    <p className="mt-2 text-sm text-zinc-500">{agent.description}</p>
                    <div className="mt-3 text-xs text-zinc-500">
                      Existing credentials: {agent.credentials.length}
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-zinc-500" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
