'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, RefreshCw, ExternalLink, Search, Database, Wifi, HardDrive, Filter } from 'lucide-react';
import { PageHeader, Badge, Button, Card, Select, StatusDot } from '@/components/ui';
import { StreamingTable, type Column } from '@/components/streaming-table';
import { fetchJSON, postJSON, truncate, explorerTx, explorerBlock, explorerAddress } from '@/lib/api';

const CONTRACT_NAMES = [
  'AgentWalletFactory', 'SessionManager', 'CredentialRegistry', 'AgentIdentity',
  'CapabilityRegistry', 'DelegationManager', 'OrganizationRegistry', 'OrganizationCredentialAnchor',
];

const EVENT_TYPES = [
  'WalletCreated', 'WalletInitialized', 'ExecutionPerformed', 'BatchExecutionPerformed',
  'SessionCreated', 'SessionUsed', 'SessionRevoked',
  'LightSessionCreated', 'LightSessionUsed', 'LightSessionRevoked',
  'ActiveRootUpdated', 'RevokedSecretRootUpdated',
  'IdentityRegistered', 'WalletLinked', 'CredentialLinked', 'MetadataUpdated',
  'IdentityDeactivated', 'IdentityReactivated',
  'CapabilityRegistered', 'CapabilityRevoked', 'GrantRootUpdated', 'GrantRevoked',
  'DelegationRootUpdated', 'DelegationRevoked', 'DelegatorRevoked', 'DelegatorReAuthorized', 'ScopeRegistered',
  'OrganizationRegistered', 'OrganizationDeactivated', 'OrganizationReactivated', 'CredentialAnchorUpdated',
  'UserOperationValidated', 'EntryPointDepositAdded',
  'CredentialIssued', 'CredentialRevoked', 'SessionCreated', 'SessionRevoked',
];

const SOURCE_ICONS: Record<string, any> = {
  onchain: Database,
  local: HardDrive,
  bus: Wifi,
};

const SOURCE_COLORS: Record<string, string> = {
  onchain: 'text-blue-400',
  local: 'text-amber-400',
  bus: 'text-green-400',
};

function eventRowId(e: any): string {
  if (e._id) return String(e._id);
  if (e.txHash) return `${e.txHash}:${e.logIndex ?? ''}`;
  return `${e.type || 'event'}:${e.timestamp ?? ''}:${e.blockNumber ?? ''}`;
}

export function EventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractFilter, setContractFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [indexerStatus, setIndexerStatus] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(true);
  const pageSize = 50;

  const fetchEvents = useCallback(async (isInitial = false) => {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      if (contractFilter) params.set('contract', contractFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);

      const data = await fetchJSON<any>(`/api/events?${params}`);
      const evts = data.events || (Array.isArray(data) ? data : []);
      setEvents(evts);
      setTotal(data.total || evts.length);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch events');
    }
    if (isInitial) setLoading(false);
  }, [contractFilter, typeFilter, page]);

  const fetchIndexerStatus = async () => {
    try {
      const data = await fetchJSON<any>('/api/events/indexer/status');
      setIndexerStatus(data);
    } catch {}
  };

  useEffect(() => { setLoading(true); fetchEvents(true); }, [fetchEvents]);
  useEffect(() => {
    const interval = setInterval(() => { fetchEvents(); fetchIndexerStatus(); }, 15000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const triggerIndex = async () => {
    try {
      await postJSON('/api/events/indexer/run', {});
      fetchEvents();
      fetchIndexerStatus();
    } catch {}
  };

  const triggerReindex = async () => {
    try {
      await postJSON('/api/events/indexer/reindex', { fromBlock: 43500000 });
      fetchEvents();
      fetchIndexerStatus();
    } catch {}
  };

  const triggerReproduce = async () => {
    try {
      await postJSON('/api/events/indexer/reproduce', {});
      fetchEvents();
      fetchIndexerStatus();
    } catch {}
  };

  // Client-side search filter
  const filteredEvents = search
    ? events.filter((e: any) => {
        const q = search.toLowerCase();
        return (
          (e.type || '').toLowerCase().includes(q) ||
          (e.contractName || '').toLowerCase().includes(q) ||
          (e.txHash || '').toLowerCase().includes(q) ||
          (e.args && JSON.stringify(e.args).toLowerCase().includes(q)) ||
          (e.data && JSON.stringify(e.data).toLowerCase().includes(q))
        );
      })
    : events;

  const eventExplorerLink = (e: any) => {
    if (e.txHash) return explorerTx(e.txHash);
    if (e.blockNumber) return explorerBlock(e.blockNumber);
    const wallet = e.args?.wallet || e.args?.walletAddress || e.data?.walletAddress;
    if (wallet) return explorerAddress(wallet);
    return null;
  };

  const formatArgs = (args: Record<string, any>) => {
    if (!args || Object.keys(args).length === 0) return null;
    return Object.entries(args).map(([key, val]) => (
      <div key={key} className="flex gap-2 text-[10px]">
        <span className="text-muted-foreground/50 min-w-[80px]">{key}</span>
        <span className="font-mono text-muted-foreground/80 break-all">
          {typeof val === 'string' && val.length > 66 ? truncate(val, 20) : String(val)}
        </span>
      </div>
    ));
  };

  const uniqueEventTypes = Array.from(new Set(events.map((e: any) => e.type).filter(Boolean))).sort();

  // Live table columns — stable across renders so the table's change
  // detection only fires on real data changes, not on re-renders.
  const eventColumns = useMemo<Column<any>[]>(() => [
    {
      key: 'event',
      header: 'Event',
      sortable: true,
      value: (e) => e.type || e.eventName || 'Event',
      render: (e) => {
        const SourceIcon = SOURCE_ICONS[e.source] || Activity;
        return (
          <span className="flex items-center gap-2 min-w-0">
            <SourceIcon className={`w-3.5 h-3.5 flex-shrink-0 ${SOURCE_COLORS[e.source] || 'text-muted-foreground/40'}`} />
            <span className="text-xs font-medium truncate">{e.type || e.eventName || 'Event'}</span>
            {e.contractName && <Badge variant="default" className="text-[9px] shrink-0">{e.contractName}</Badge>}
          </span>
        );
      },
    },
    {
      key: 'source',
      header: 'Source',
      value: (e) => e.source || '',
      render: (e) => (
        e.source ? (
          <span className={`text-[10px] uppercase tracking-wider ${SOURCE_COLORS[e.source] || 'text-muted-foreground/40'}`}>
            {e.source}
          </span>
        ) : (
          <span className="text-muted-foreground/30">—</span>
        )
      ),
    },
    {
      key: 'time',
      header: 'Time',
      align: 'end',
      sortable: true,
      value: (e) => e.timestamp ?? 0,
      render: (e) => (
        <span className="text-[10px] text-muted-foreground/60 font-mono whitespace-nowrap">
          {e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'block',
      header: 'Block',
      align: 'end',
      sortable: true,
      value: (e) => e.blockNumber ?? 0,
      render: (e) => (e.blockNumber ? <Badge variant="default">#{e.blockNumber}</Badge> : <span className="text-muted-foreground/30">—</span>),
    },
  ], []);

  const handleRowAction = (actionId: string, row: any) => {
    if (actionId === 'details') {
      const id = eventRowId(row);
      setExpandedEvent((cur) => (cur === id ? null : id));
      return;
    }
    if (actionId === 'explorer') {
      const link = eventExplorerLink(row);
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
    }
  };

  const expanded = expandedEvent ? events.find((e: any) => eventRowId(e) === expandedEvent) : null;

  return (
    <div>
      <PageHeader title="Events" description="On-chain and system events from all contracts"
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<Filter className="w-3.5 h-3.5" />}
              onClick={() => setShowFilters(!showFilters)}>
              {showFilters ? 'Hide' : 'Filters'}
            </Button>
            <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => { fetchEvents(); fetchIndexerStatus(); }} />
          </div>
        }
      />

      {/* Indexer Status Bar */}
      {indexerStatus && (
        <Card className="mb-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <StatusDot status={indexerStatus.running ? 'warning' : 'online'} />
                <span className="text-[10px] text-muted-foreground/60">
                  {indexerStatus.running ? 'Indexing...' : 'Indexer idle'}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground/40">
                {indexerStatus.total || 0} on-chain events indexed
              </span>
              {indexerStatus.lastRun > 0 && (
                <span className="text-[10px] text-muted-foreground/40">
                  Last: {new Date(indexerStatus.lastRun).toLocaleTimeString()}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={triggerIndex}>
              Index Now
            </Button>
            <Button variant="ghost" size="sm" onClick={triggerReindex}>
              Reindex All
            </Button>
            <Button variant="ghost" size="sm" onClick={triggerReproduce}>
              Reproduce State
            </Button>
          </div>
        </Card>
      )}

      {/* Filters */}
      {showFilters && (
        <Card className="mb-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search events by type, contract, tx hash, or args..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-secondary border border-input text-xs text-foreground placeholder:text-muted-foreground/40"
              />
            </div>

            <Select value={contractFilter} onChange={e => { setContractFilter(e.target.value); setPage(0); }} className="w-48">
              <option value="">All Contracts</option>
              {CONTRACT_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>

            <Select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }} className="w-44">
              <option value="all">All Event Types</option>
              {(uniqueEventTypes.length > 0 ? uniqueEventTypes : EVENT_TYPES).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>
        </Card>
      )}

      {error && !loading ? (
        <Card><div className="text-center py-8"><p className="text-xs text-destructive/60">{error}</p></div></Card>
      ) : (
        <>
          <div className="text-[10px] text-muted-foreground/40 mb-2">
            {total} events {search ? `(filtered from ${events.length})` : ''}
          </div>
          <StreamingTable
            rows={filteredEvents}
            columns={eventColumns}
            getRowId={eventRowId}
            defaultSort={{ key: 'time', dir: 'desc' }}
            state={loading ? 'loading' : 'idle'}
            onRetry={() => { fetchEvents(); fetchIndexerStatus(); }}
            caption="Protocol events"
            emptyContent={
              search || contractFilter || typeFilter !== 'all'
                ? 'No events match your filters. Try adjusting them.'
                : "Events appear here as the protocol processes actions on-chain. Click 'Index Now' to fetch historical events."
            }
            rowActions={(row: any) => {
              const actions: { id: string; label: string }[] = [{ id: 'details', label: expandedEvent === eventRowId(row) ? 'Hide' : 'Details' }];
              if (eventExplorerLink(row)) actions.push({ id: 'explorer', label: 'Explorer' });
              return actions;
            }}
            onRowAction={handleRowAction}
            renderMobileRow={(row: any, { actions }) => {
              const SourceIcon = SOURCE_ICONS[row.source] || Activity;
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <SourceIcon className={`w-3.5 h-3.5 flex-shrink-0 ${SOURCE_COLORS[row.source] || 'text-muted-foreground/40'}`} />
                    <span className="text-xs font-medium truncate">{row.type || row.eventName || 'Event'}</span>
                    {row.contractName && <Badge variant="default" className="text-[9px]">{row.contractName}</Badge>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/50 font-mono">
                      {row.timestamp ? new Date(row.timestamp * 1000).toLocaleString() : '—'}
                      {row.blockNumber ? ` — Block #${row.blockNumber}` : ''}
                    </span>
                    {actions}
                  </div>
                </div>
              );
            }}
          />

          {/* Expanded event details */}
          {expanded && (
            <Card className="mt-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium">{expanded.type || expanded.eventName || 'Event'}</span>
                  {expanded.contractName && <Badge variant="default" className="text-[9px]">{expanded.contractName}</Badge>}
                </div>
                {expanded.contractAddress && (
                  <div className="flex gap-2 text-[10px]">
                    <span className="text-muted-foreground/50 min-w-[80px]">Contract</span>
                    <a href={explorerAddress(expanded.contractAddress)} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:underline">
                      {expanded.contractAddress}
                    </a>
                  </div>
                )}
                {expanded.txHash && (
                  <div className="flex gap-2 text-[10px]">
                    <span className="text-muted-foreground/50 min-w-[80px]">Tx Hash</span>
                    <a href={explorerTx(expanded.txHash)} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:underline">
                      {expanded.txHash}
                    </a>
                  </div>
                )}
                {expanded.logIndex !== undefined && (
                  <div className="flex gap-2 text-[10px]">
                    <span className="text-muted-foreground/50 min-w-[80px]">Log Index</span>
                    <span className="font-mono text-muted-foreground/80">{expanded.logIndex}</span>
                  </div>
                )}
                {expanded.args && formatArgs(expanded.args)}
                {expanded.data && Object.keys(expanded.data).length > 0 && !expanded.args && formatArgs(expanded.data)}
              </div>
            </Card>
          )}

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-[10px] text-muted-foreground/40">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="ghost" size="sm" disabled={(page + 1) * pageSize >= total}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
