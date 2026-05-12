import Link from 'next/link'
import { ArrowRight, Clock3, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSessions, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'
import { formatDate, truncateAddress } from '@/lib/utils'
import Header from '@/components/header'

export const metadata = {
  title: 'Sessions - Agentix',
  description: 'Active and expired agent sessions for the selected organization.',
}

export const dynamic = 'force-dynamic'

export default async function SessionsPage() {
  const [organizationsRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])
  const currentOrgId =
    selectedOrgId?.toString() ??
    organizationsRes.data[organizationsRes.data.length - 1]?.id ??
    null
  const sessionsRes = await getSessions(currentOrgId)
  const sessions = sessionsRes.data

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Runtime sessions</span>
            <h1 className="mt-2 text-3xl font-semibold">Session activity</h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400">
              Sessions are created from the agent detail page after a credential exists and the owner wallet signs the request.
            </p>
          </div>
          <Link href="/agents">
            <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">Open agents</Button>
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <Clock3 className="mx-auto h-10 w-10 text-zinc-600" />
            <h2 className="mt-4 text-lg font-medium">No sessions found</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Create a credential first, then use the agent action panel to open a session.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800">
                      <Wallet className="h-5 w-5 text-zinc-300" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium">Agent #{session.agentId}</span>
                        <span className={session.status === 'active' ? 'text-emerald-400 text-sm' : 'text-zinc-500 text-sm'}>
                          {session.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-zinc-500">
                        Session key {truncateAddress(session.sessionKey, 16)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
                        <span>Created {formatDate(session.createdAt)}</span>
                        <span>Expires {formatDate(session.expiresAt)}</span>
                      </div>
                    </div>
                  </div>
                  <Link href={`/agents/${session.agentId}`}>
                    <Button variant="outline" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                      Open agent
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
