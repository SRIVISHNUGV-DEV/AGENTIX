'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  Filter,
  X,
  Activity,
  Users,
  CalendarDays,
  Zap,
  Clock,
  FileText,
  Shield,
  AlertTriangle,
  Wallet,
  Key,
  UserPlus,
  UserX,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, truncateHash } from '@/lib/utils'
import { getAuditLogs, getAuditStats, exportAuditLogs } from '@/lib/mock-api'
import Header from '@/components/header'
import type { AuditLog, AuditStats } from '@/lib/types'

interface AuditTrailPageProps {
  initialOrgId: string | null
  organizations: { id: string; name: string; slug: string }[]
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  'org.create': <Shield className="h-4 w-4" />,
  'org.delete': <AlertTriangle className="h-4 w-4" />,
  'org.fund': <Wallet className="h-4 w-4" />,
  'org.deploy_contracts': <FileText className="h-4 w-4" />,
  'agent.create': <UserPlus className="h-4 w-4" />,
  'agent.delete': <UserX className="h-4 w-4" />,
  'credential.issue': <Key className="h-4 w-4" />,
  'credential.revoke': <AlertTriangle className="h-4 w-4" />,
  'session.create': <Zap className="h-4 w-4" />,
  'session.terminate': <X className="h-4 w-4" />,
  'session.revoke': <X className="h-4 w-4" />,
  'session.unlock': <Key className="h-4 w-4" />,
  'wallet.create': <Wallet className="h-4 w-4" />,
  'wallet.whitelist_add': <UserPlus className="h-4 w-4" />,
  'wallet.whitelist_remove': <UserX className="h-4 w-4" />,
  'wallet.deposit_gas': <Wallet className="h-4 w-4" />,
  'wallet.userop_prepare': <FileText className="h-4 w-4" />,
  'wallet.userop_submit': <Zap className="h-4 w-4" />,
  'external_agent.connect': <UserPlus className="h-4 w-4" />,
  'external_agent.disconnect': <UserX className="h-4 w-4" />,
  'external_agent.execute': <Zap className="h-4 w-4" />,
  'external_agent.audit': <Shield className="h-4 w-4" />,
}

const ACTION_COLORS: Record<string, string> = {
  'org.create': 'border-emerald-500/30 bg-emerald-500/10',
  'org.delete': 'border-red-500/30 bg-red-500/10',
  'org.fund': 'border-amber-500/30 bg-amber-500/10',
  'agent.create': 'border-emerald-500/30 bg-emerald-500/10',
  'agent.delete': 'border-red-500/30 bg-red-500/10',
  'credential.issue': 'border-blue-500/30 bg-blue-500/10',
  'credential.revoke': 'border-orange-500/30 bg-orange-500/10',
  'session.create': 'border-purple-500/30 bg-purple-500/10',
  'session.terminate': 'border-red-500/30 bg-red-500/10',
  'wallet.create': 'border-cyan-500/30 bg-cyan-500/10',
  'wallet.whitelist_add': 'border-teal-500/30 bg-teal-500/10',
  'wallet.deposit_gas': 'border-amber-500/30 bg-amber-500/10',
  'external_agent.connect': 'border-emerald-500/30 bg-emerald-500/10',
  'external_agent.disconnect': 'border-red-500/30 bg-red-500/10',
  'external_agent.execute': 'border-purple-500/30 bg-purple-500/10',
  'external_agent.audit': 'border-blue-500/30 bg-blue-500/10',
}

function getActionLabel(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\./g, ' — ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function getActionGroup(action: string): string {
  return action.split('.')[0] ?? action
}

function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000)
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

function relativeTime(unix: number): string {
  const diff = Date.now() - unix * 1000
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(new Date(unix * 1000).toISOString())
}

function ComplianceCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-800/50 text-zinc-400">
          {icon}
        </div>
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  )
}

function DetailSheet({
  entry,
  onClose,
}: {
  entry: AuditLog | null
  onClose: () => void
}) {
  if (!entry) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l border-zinc-800 bg-zinc-950 shadow-2xl overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Event Detail</h2>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`rounded-md border px-2 py-0.5 text-xs ${ACTION_COLORS[entry.action] || 'border-zinc-700 bg-zinc-800/50 text-zinc-400'}`}>
              {getActionLabel(entry.action)}
            </span>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Event ID</dt>
              <dd className="text-zinc-300 font-mono text-xs">{entry.id}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Timestamp</dt>
              <dd className="text-zinc-300">{formatTimestamp(entry.created_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Resource</dt>
              <dd className="text-zinc-300">{entry.resource_type}{entry.resource_id ? `: ${truncateHash(entry.resource_id, 32)}` : ''}</dd>
            </div>
            {entry.user_id && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">User ID</dt>
                <dd className="text-zinc-300">#{entry.user_id}</dd>
              </div>
            )}
            {entry.ip_address && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">IP Address</dt>
                <dd className="text-zinc-300 font-mono text-xs">{entry.ip_address}</dd>
              </div>
            )}
            {entry.user_agent && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">User Agent</dt>
                <dd className="text-zinc-300 text-xs max-w-[60%] truncate" title={entry.user_agent}>{entry.user_agent}</dd>
              </div>
            )}
          </dl>
        </div>

        {entry.details && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-2">Event Details (JSON)</h3>
            <pre className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300 overflow-x-auto max-h-96">
              {(() => {
                try { return JSON.stringify(JSON.parse(entry.details!), null, 2) } catch { return entry.details }
              })()}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityBarChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-1 h-24">
      {data.slice(0, 14).reverse().map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-[10px] text-zinc-600">{d.count}</span>
          <div
            className="w-full rounded-t bg-emerald-500/50 hover:bg-emerald-500/70 transition-colors min-h-[2px]"
            style={{ height: `${(d.count / maxCount) * 100}%` }}
            title={`${d.date}: ${d.count} events`}
          />
        </div>
      ))}
    </div>
  )
}

export function AuditTrailPageClient({ initialOrgId, organizations }: AuditTrailPageProps) {
  const [orgId, setOrgId] = useState<string | null>(initialOrgId)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [selectedEntry, setSelectedEntry] = useState<AuditLog | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const limit = 50

  const uniqueActions = useMemo(() => {
    const actions = new Set(logs.map((l) => l.action))
    const groups = new Set(Array.from(actions).map(getActionGroup))
    return Array.from(groups).sort()
  }, [logs])

  const fetchLogs = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [logRes, statsRes] = await Promise.all([
        getAuditLogs(orgId, {
          search: search || undefined,
          action: actionFilter !== 'all' ? actionFilter : undefined,
          limit,
          offset,
        }),
        offset === 0 ? getAuditStats(orgId) : Promise.resolve(null),
      ])
      if (logRes.success) {
        setLogs(logRes.data.items)
        setTotal(logRes.data.total)
      } else {
        setError(logRes.error ?? 'Failed to fetch audit logs')
      }
      if (statsRes && statsRes.success) {
        setStats(statsRes.data)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, search, actionFilter, offset])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleExport = async (format: 'csv' | 'json') => {
    if (!orgId) return
    setExporting(true)
    try {
      const blob = await exportAuditLogs(orgId, format, {
        action: actionFilter !== 'all' ? actionFilter : undefined,
        search: search || undefined,
      })
      if (blob) {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `audit-log-org-${orgId}.${format}`
        link.click()
        URL.revokeObjectURL(link.href)
      }
    } finally {
      setExporting(false)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setActionFilter('all')
    setOffset(0)
  }

  const hasActiveFilters = search || actionFilter !== 'all'
  const totalPages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-7xl px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Compliance</span>
              {orgId && (
                <span className="text-xs text-zinc-600 bg-zinc-900 rounded-full px-2 py-0.5 border border-zinc-800">
                  Org #{orgId}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold mt-1">Audit Trail</h1>
            <p className="mt-2 text-sm text-zinc-500 max-w-3xl">
              Comprehensive compliance report of all agent operations, credential actions, and wallet interactions.
              Every action is cryptographically signed and immutably logged.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs"
              onClick={() => handleExport('csv')}
              disabled={exporting || total === 0}
            >
              {exporting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Download className="mr-1.5 h-3 w-3" />}
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs"
              onClick={() => handleExport('json')}
              disabled={exporting || total === 0}
            >
              {exporting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Download className="mr-1.5 h-3 w-3" />}
              JSON
            </Button>
          </div>
        </div>

        {/* Compliance Summary Cards */}
        {stats && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <ComplianceCard
              label="Total Events"
              value={stats.totalEvents.toLocaleString()}
              icon={<Activity className="h-4 w-4" />}
              sub={`${stats.recentActivity} in last 24h`}
            />
            <ComplianceCard
              label="Unique Users"
              value={stats.uniqueUsers}
              icon={<Users className="h-4 w-4" />}
            />
            <ComplianceCard
              label="Active Days"
              value={stats.activeDays}
              icon={<CalendarDays className="h-4 w-4" />}
              sub={stats.eventsByDay.length > 0 ? `Latest: ${stats.eventsByDay[0]?.date}` : undefined}
            />
            <ComplianceCard
              label="Resource Types"
              value={stats.uniqueResourceTypes}
              icon={<FileText className="h-4 w-4" />}
              sub={`${Object.keys(stats.eventsByAction).length} action types`}
            />
            <ComplianceCard
              label="24h Activity"
              value={stats.recentActivity}
              icon={<Clock className="h-4 w-4" />}
              sub={stats.recentActivity > 0 ? 'Events in last 24 hours' : 'No recent activity'}
            />
          </div>
        )}

        {/* Activity bar chart */}
        {stats && stats.eventsByDay.length > 0 && (
          <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">Activity (Last 14 Days)</h3>
            <ActivityBarChart data={stats.eventsByDay} />
          </div>
        )}

        {/* Filters */}
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search actions, resources, IPs, details..."
              className="border-zinc-800 bg-zinc-900 pl-10 text-sm"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOffset(0) }}
            />
          </div>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setOffset(0) }}>
            <SelectTrigger className="border-zinc-800 bg-zinc-900 text-sm">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by action group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map((group) => (
                <SelectItem key={group} value={group}>{group.replace(/^\w/, (c) => c.toUpperCase())}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">
              {total > 0 ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '0 events'}
            </span>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-zinc-500">
              {loading ? 'Searching...' : `Showing ${logs.length} of ${total} events`}
            </span>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-auto p-1 text-xs text-zinc-400">
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Event Timeline */}
        <div className="mt-6 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
              <Search className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
              <p className="text-zinc-500">
                {hasActiveFilters
                  ? 'No audit events match your filters.'
                  : 'No audit events recorded yet. Actions performed on the platform will appear here.'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              {/* Header row */}
              <div className="hidden md:grid md:grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 bg-zinc-900/60 border-b border-zinc-800 text-xs font-medium uppercase tracking-wider text-zinc-500">
                <span>Action / Resource</span>
                <span>Time</span>
                <span>IP</span>
                <span></span>
              </div>

              {logs.map((entry) => (
                <div key={entry.id}>
                  <button
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    className="w-full text-left md:grid md:grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3.5 border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors last:border-b-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${ACTION_COLORS[entry.action] || 'border-zinc-700 bg-zinc-800/50'}`}>
                        <span className="text-zinc-400">{ACTION_ICONS[entry.action] || <Activity className="h-3.5 w-3.5" />}</span>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ACTION_COLORS[entry.action] || 'border-zinc-700 bg-zinc-800/50 text-zinc-400'}`}>
                            {getActionLabel(entry.action)}
                          </span>
                          {entry.resource_type && (
                            <span className="text-xs text-zinc-500 truncate">
                              {entry.resource_type}{entry.resource_id ? `: ${truncateHash(entry.resource_id, 24)}` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400">
                      <span title={formatTimestamp(entry.created_at)}>{relativeTime(entry.created_at)}</span>
                    </div>

                    <div className="hidden md:flex items-center">
                      {entry.ip_address && (
                        <span className="text-xs text-zinc-600 font-mono">{entry.ip_address}</span>
                      )}
                    </div>

                    <div className="hidden md:flex items-center">
                      {expandedId === entry.id ? (
                        <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                      )}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {expandedId === entry.id && (
                    <div className="border-b border-zinc-800/50 bg-zinc-900/20 px-5 py-4 md:pl-16">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">Timestamp</h4>
                          <p className="text-sm text-zinc-300">{formatTimestamp(entry.created_at)}</p>
                        </div>
                        {entry.user_id && (
                          <div>
                            <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">User</h4>
                            <p className="text-sm text-zinc-300">#{entry.user_id}</p>
                          </div>
                        )}
                        {entry.ip_address && (
                          <div>
                            <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">IP Address</h4>
                            <p className="text-sm font-mono text-zinc-300">{entry.ip_address}</p>
                          </div>
                        )}
                        {entry.user_agent && (
                          <div className="md:col-span-3">
                            <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">User Agent</h4>
                            <p className="text-xs text-zinc-400 truncate">{entry.user_agent}</p>
                          </div>
                        )}
                        {entry.details && (
                          <div className="md:col-span-3">
                            <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">Details</h4>
                            <pre className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400 overflow-x-auto max-h-48">
                              {(() => {
                                try { return JSON.stringify(JSON.parse(entry.details!), null, 2) } catch { return entry.details }
                              })()}
                            </pre>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
                          onClick={(e) => { e.stopPropagation(); setSelectedEntry(entry) }}
                        >
                          <ExternalLink className="mr-1 h-3 w-3" />
                          View detail
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Detail Sheet */}
      <DetailSheet entry={selectedEntry} onClose={() => setSelectedEntry(null)} />

      {/* Overlay */}
      {selectedEntry && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setSelectedEntry(null)}
        />
      )}
    </div>
  )
}
