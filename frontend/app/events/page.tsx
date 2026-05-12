import { EventsPageClient } from '@/components/events/events-page-client'
import { getEvents, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'

export const metadata = {
  title: 'Events - Agentix',
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

  return (
    <EventsPageClient
      initialEvents={eventsRes.data}
      organizations={orgListRes.data}
      currentOrgId={currentOrgId}
    />
  )
}
