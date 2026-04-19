import Header from '@/components/header'
import Footer from '@/components/footer'
import { notFound } from 'next/navigation'
import { getAgent, getEventsByAgent, getSessionsByAgent } from '@/lib/mock-api'
import { AgentIdentity } from '@/components/agent/agent-identity'
import { CredentialsList } from '@/components/agent/credentials-list'
import { WalletsList } from '@/components/agent/wallets-list'
import { SessionsList } from '@/components/agent/sessions-list'
import { EventsFeed } from '@/components/dashboard/events-feed'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { AgentActions } from '@/components/platform/agent-actions'
import { WalletUserOpPanel } from '@/components/platform/wallet-userop-panel'
import { StackMetrics } from '@/components/common/stack-metrics'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agentRes = await getAgent(id)
  if (!agentRes.data) {
    return {
      title: 'Agent Not Found',
    }
  }
  return {
    title: `${agentRes.data.name} - Agentix`,
    description: agentRes.data.description,
  }
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [agentRes, eventsRes, sessionsRes] = await Promise.all([
    getAgent(id),
    getEventsByAgent(id),
    getSessionsByAgent(id),
  ])

  if (!agentRes.data) {
    notFound()
  }

  const agent = agentRes.data
  const events = eventsRes.data
  const sessions = sessionsRes.data

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 flex-1">
        <div className="shell max-w-6xl py-12">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="mb-8 gap-2 text-foreground/60 hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>

          <div className="mb-8">
            <AgentIdentity agent={agent} />
          </div>

          <div className="mb-8">
            <StackMetrics
              items={[
                { label: 'Credentials', value: agent.credentials.length, detail: 'Issued for this agent' },
                { label: 'Wallets', value: agent.wallets.length, detail: 'Deployed through the platform' },
                { label: 'Sessions', value: sessions.length, detail: 'Indexed from the session manager' },
                { label: 'Events', value: events.length, detail: 'Visible in the activity timeline' },
              ]}
            />
          </div>

          <div className="mb-8">
            <AgentActions
              agentId={agent.id}
              orgId={agent.orgId}
              hasCredential={agent.credentials.length > 0}
              hasWallet={agent.wallets.length > 0}
              defaultExpiry={
                agent.credentials[0]
                  ? Math.floor(new Date(agent.credentials[0].expiresAt).getTime() / 1000)
                  : Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60
              }
              defaultPermissions={agent.credentials[0]?.permissions ?? 7}
            />
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <CredentialsList credentials={agent.credentials} />
            <WalletsList wallets={agent.wallets} />
          </div>

          <div className="mt-8">
            <SessionsList sessions={sessions} />
          </div>

          {agent.wallets[0] ? (
            <div className="mt-8">
              <WalletUserOpPanel walletAddress={agent.wallets[0].address} orgId={agent.orgId} />
            </div>
          ) : null}

          <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-card p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
            <div className="mb-4">
              <div className="micro-label">Activity timeline</div>
              <h2 className="mt-2 text-xl font-semibold">Indexed events for this agent</h2>
            </div>
            <EventsFeed events={events} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
