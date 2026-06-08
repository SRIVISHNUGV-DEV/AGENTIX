'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, Filter, ArrowUpDown, X, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { formatDate, truncateAddress } from '@/lib/utils'
import Header from '@/components/header'
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    session_created: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    session_expired: 'bg-zinc-800 text-zinc-500 border-zinc-700',
    credential_issued: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    credential_revoked: 'bg-red-500/10 text-red-400 border-red-500/20',
    wallet_added: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    transaction_signed: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs border ${colors[status] || colors.unknown}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export function EventsPageClient({
  initialEvents,
  organizations,
  currentOrgId,
}: EventsPageClientProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<EventFilterType>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Contract Telemetry</span>
            <h1 className="text-2xl font-semibold mt-1">Event History</h1>
            <p className="mt-2 text-sm text-zinc-500 max-w-2xl">
              Indexed events from contract interactions. Session creation, wallet deployment, and state changes.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search by description, contract, hash..."
              className="border-zinc-800 bg-zinc-900 pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as EventFilterType)}>
            <SelectTrigger className="border-zinc-800 bg-zinc-900">
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
            className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
          >
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
          </Button>
        </div>

        {hasActiveFilters && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-sm text-zinc-500">
              Showing {filteredEvents.length} of {initialEvents.length} events
            </span>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-auto p-1 text-xs text-zinc-400">
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
        )}

        {/* Events List */}
        <div className="mt-6 space-y-3">
          {filteredEvents.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
              <p className="text-zinc-500">
                {hasActiveFilters
                  ? 'No events match your filters. Try adjusting your search criteria.'
                  : 'No events indexed yet. Create sessions or deploy wallets to see activity here.'}
              </p>
            </div>
          ) : (
            filteredEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 hover:border-zinc-700 transition-colors">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-sm font-medium">{event.description}</h2>
                      <StatusBadge status={event.type} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                      <span>{event.contractName}</span>
                      <span>•</span>
                      <span>Block {event.blockNumber}</span>
                      <span>•</span>
                      <span>{formatDate(event.timestamp)}</span>
                      {event.agentId && (
                        <>
                          <span>•</span>
                          <Link href={`/agents/${event.agentId}`} className="text-zinc-400 hover:text-zinc-200">
                            Agent #{event.agentId}
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                  <a
                    href={`https://sepolia.basescan.org/tx/${event.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                  >
                    {truncateAddress(event.txHash)}
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  )
}

export default function EventsPage() {
  return <EventsPageClient initialEvents={[]} organizations={[]} currentOrgId={null} />
}
