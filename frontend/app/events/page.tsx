import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { getEvents, listOrganizations } from '@/lib/mock-api'
import { StatusBadge } from '@/components/common/status-badge'
import { formatDate, truncateAddress } from '@/lib/utils'
import { getSelectedOrgId } from '@/lib/org-session'
import { WorkspaceControls } from '@/components/platform/workspace-controls'

export const metadata = {
  title: 'Events - Agent Credentials',
  description: 'Indexed contract events across sessions, wallets, and credentials.',
}

export default async function EventsPage() {
  const [orgListRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])
  const currentOrgId =
    selectedOrgId?.toString() ??
    orgListRes.data[orgListRes.data.length - 1]?.id ??
    null
  const eventsRes = await getEvents(currentOrgId)
  const events = eventsRes.data

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 shell py-16 sm:py-20">
        <div className="mb-10">
          <span className="section-kicker">Contract telemetry</span>
          <h1 className="section-title">Indexed event history</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-foreground/65">
            This view is backed by the event listener in the backend and gives operators a readable audit trail for session creation, wallet deployment, and contract state changes.
          </p>
        </div>

        <div className="mb-8">
          <WorkspaceControls organizations={orgListRes.data} currentOrgId={currentOrgId} />
        </div>

        <div className="space-y-3">
          {events.map((event) => (
            <SpotlightCard key={event.id} className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-semibold">{event.description}</h2>
                    <StatusBadge status={event.type} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-foreground/50">
                    <span>{event.contractName}</span>
                    <span>Block {event.blockNumber}</span>
                    <span>{formatDate(event.timestamp)}</span>
                  </div>
                </div>
                <code className="text-xs text-foreground/55">{truncateAddress(event.txHash)}</code>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
