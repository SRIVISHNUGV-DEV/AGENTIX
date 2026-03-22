import Header from '@/components/header'
import Footer from '@/components/footer'
import { notFound } from 'next/navigation'
import { getAgent, getEventsByAgent, getSessionsByAgent } from '@/lib/mock-api'
import { AgentIdentity } from '@/components/agent/agent-identity'
import { CredentialsList } from '@/components/agent/credentials-list'
import { WalletsList } from '@/components/agent/wallets-list'
import { SessionsList } from '@/components/agent/sessions-list'
import { EventsFeed } from '@/components/dashboard/events-feed'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { AgentActions } from '@/components/platform/agent-actions'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agentRes = await getAgent(id)
  if (!agentRes.data) {
    return {
      title: 'Agent Not Found',
    }
  }
  return {
    title: `${agentRes.data.name} - Agent Credentials`,
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
    <div className="relative min-h-screen overflow-hidden bg-background flex flex-col">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 flex-1">
        <div className="shell max-w-5xl py-12">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="mb-8 gap-2 text-foreground/60 hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>

          <div className="mb-12">
            <AgentIdentity agent={agent} />
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

          <div className="grid gap-8 md:grid-cols-2 mb-8">
            <CredentialsList credentials={agent.credentials} />
            <WalletsList wallets={agent.wallets} />
          </div>

          <div className="mb-8">
            <SessionsList sessions={sessions} />
          </div>

          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg">Activity Timeline</CardTitle>
              <CardDescription>Recent events related to this agent</CardDescription>
            </CardHeader>
            <CardContent>
              <EventsFeed events={events} />
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  )
}
