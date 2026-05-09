'use client'

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { StatusBadge } from '@/components/status-badge'
import { formatDate, truncateAddress } from '@/lib/utils'
import { WorkspaceControls } from '@/components/platform/workspace-controls'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, Filter, ArrowUpDown, X } from 'lucide-react'
import type { Event } from '@/lib/types'

interface EventsPageClientProps {
  initialEvents: Event[]
  organizations: { id: string; name: string }[]
  currentOrgId: string | null
}

type EventFilterType = 
  | 'all'
  | 'session_created'
  | 'session_expired'
  | 'credential_issued'
  | 'credential_revoked'
  | 'wallet_added'
  | 'transaction_signed'
  | 'unknown'

const EVENT_TYPES: { value: EventFilterType; label: string }[] = [
  { value: 'all', label: 'All events' },
  { value: 'session_created', label: 'Session Created' },
  { value: 'session_expired', label: 'Session Expired' },
  { value: 'credential_issued', label: 'Credential Issued' },
  { value: 'credential_revoked', label: 'Credential Revoked' },
  { value: 'wallet_added', label: 'Wallet Added' },
  { value: 'transaction_signed', label: 'Transaction Signed' },
]

export function EventsPageClient({
  initialEvents,
  organizations,
  currentOrgId,
}: EventsPageClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<EventFilterType>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearchQuery(value)
  }, 300)

  const filteredEvents = useMemo(() => {
    let filtered = [...initialEvents]

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (event) =>
          event.description.toLowerCase().includes(query) ||
          event.contractName.toLowerCase().includes(query) ||
          event.txHash.toLowerCase().includes(query) ||
          event.agentId.includes(query)
      )
    }

    if (filterType !== 'all') {
      filtered = filtered.filter((event) => event.type === filterType)
    }

    filtered.sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime()
      const dateB = new Date(b.timestamp).getTime()
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB
    })

    return filtered
  }, [initialEvents, searchQuery, filterType, sortOrder])

  const clearFilters = () => {
    setSearchQuery('')
    setFilterType('all')
    setSortOrder('newest')
  }

  const hasActiveFilters = searchQuery || filterType !== 'all' || sortOrder !== 'newest'

  const refresh = () => {
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 shell py-16 sm:py-20">
        <div className="mb-10">
          <span className="section-kicker">Contract telemetry</span>
          <h1 className="section-title">Indexed event history</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-foreground/65">
            This view is backed by the event listener in the backend and gives operators a readable audit trail
            for session creation, wallet deployment, and contract state changes.
          </p>
        </div>

        <div className="mb-8">
          <WorkspaceControls organizations={organizations} currentOrgId={currentOrgId} />
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/45" />
            <Input
              placeholder="Search events by description, contract, transaction..."
              className="border-white/10 bg-card pl-10"
              onChange={(e) => debouncedSearch(e.target.value)}
              defaultValue={searchQuery}
            />
          </div>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as EventFilterType)}>
            <SelectTrigger className="border-white/10 bg-card">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="border-white/10 bg-card"
            onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
          >
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
          </Button>
        </div>

        {hasActiveFilters && (
          <div className="mb-6 flex items-center gap-2">
            <span className="text-sm text-foreground/60">
              Showing {filteredEvents.length} of {initialEvents.length} events
            </span>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-auto p-1 text-xs">
              <X className="mr-1 h-3 w-3" />
              Clear filters
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {filteredEvents.length === 0 ? (
            <SpotlightCard className="p-8 text-center">
              <p className="text-foreground/60">
                {hasActiveFilters
                  ? 'No events match your filters. Try adjusting your search criteria.'
                  : 'No events indexed yet. Create sessions or deploy wallets to see activity here.'}
              </p>
            </SpotlightCard>
          ) : (
            filteredEvents.map((event) => (
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
                      {event.agentId && <span>Agent #{event.agentId}</span>}
                    </div>
                  </div>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${event.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-foreground/55 hover:text-foreground"
                  >
                    {truncateAddress(event.txHash)}
                  </a>
                </div>
              </SpotlightCard>
            ))
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}

export default function EventsPage() {
  return <EventsPageClient initialEvents={[]} organizations={[]} currentOrgId={null} />
}