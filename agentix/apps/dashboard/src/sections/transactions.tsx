'use client';

import { useState, useEffect } from 'react';
import { ScrollText, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, Database } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Skeleton } from '@/components/ui';
import { fetchJSON, truncate, explorerTx, explorerAddress } from '@/lib/api';

export function TransactionsPage() {
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTxs = async () => {
    try {
      const data = await fetchJSON<any>('/api/transactions');
      setTxs(Array.isArray(data) ? data : data.value || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTxs();
    const interval = setInterval(fetchTxs, 15000);
    return () => clearInterval(interval);
  }, []);

  const statusIcon = (status: string) => {
    if (status === 'confirmed') return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
    if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-destructive" />;
    return <Clock className="w-3.5 h-3.5 text-warning" />;
  };

  const columns = [
    { key: 'event', header: 'Event', render: (t: any) => (
      <div>
        <div className="text-xs font-medium">{t.event_name || 'Transaction'}</div>
        {t.contract_name && <div className="text-[9px] text-muted-foreground/50 mt-0.5">{t.contract_name}</div>}
      </div>
    )},
    { key: 'hash', header: 'Tx Hash', render: (t: any) => t.tx_hash ? (
      <a href={explorerTx(t.tx_hash)} target="_blank" rel="noopener noreferrer"
        className="font-mono text-xs text-blue-400 hover:underline">{truncate(t.tx_hash, 10)}</a>
    ) : <span className="text-xs text-muted-foreground/40">—</span> },
    { key: 'contract', header: 'Contract', render: (t: any) => {
      const addr = t.contract_address || t.to_address;
      return addr ? (
        <a href={explorerAddress(addr)} target="_blank" rel="noopener noreferrer"
          className="font-mono text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          {truncate(addr, 8)} <ExternalLink className="w-2.5 h-2.5 opacity-40" />
        </a>
      ) : <span className="text-xs text-muted-foreground/40">—</span>;
    }},
    { key: 'block', header: 'Block', render: (t: any) => t.block_number ? (
      <span className="font-mono text-xs text-muted-foreground">#{t.block_number}</span>
    ) : <span className="text-xs text-muted-foreground/40">—</span> },
    { key: 'source', header: 'Source', render: (t: any) => t.source === 'onchain' ? (
      <Badge variant="default" className="text-[9px]"><Database className="w-2.5 h-2.5 mr-1" />Chain</Badge>
    ) : (
      <Badge variant="default" className="text-[9px] opacity-60">Local</Badge>
    )},
    { key: 'status', header: 'Status', render: (t: any) => (
      <div className="flex items-center gap-1.5">
        {statusIcon(t.status)}
        <span className="text-[10px]">{t.status || 'confirmed'}</span>
      </div>
    )},
    { key: 'time', header: 'Time', render: (t: any) => (
      <span className="text-[10px] text-muted-foreground/50">
        {t.created_at ? new Date(t.created_at * 1000).toLocaleString() : '—'}
      </span>
    )},
    { key: 'actions', header: '', render: (t: any) => (t.tx_hash || t.hash) ? (
      <a href={explorerTx(t.tx_hash || t.hash)} target="_blank" rel="noopener noreferrer"
        className="text-muted-foreground/40 hover:text-foreground transition-colors"><ExternalLink className="w-3.5 h-3.5" /></a>
    ) : null, className: 'text-right' },
  ];

  return (
    <div>
      <PageHeader title="Transactions" description="On-chain transaction history from indexed contract events"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchTxs} />}
      />

      {loading ? <Skeleton className="h-48" /> : error ? (
        <Card><div className="text-center py-8"><XCircle className="w-8 h-8 text-destructive/40 mx-auto mb-3" /><p className="text-xs text-destructive/60">{error}</p></div></Card>
      ) : txs.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-8 h-8" />} title="No Transactions" description="Transactions appear here when agents execute actions on-chain. Click 'Index Now' on the Events page to fetch historical data." />
      ) : (
        <Card><Table columns={columns} data={txs} emptyMessage="No transactions found" /></Card>
      )}
    </div>
  );
}
