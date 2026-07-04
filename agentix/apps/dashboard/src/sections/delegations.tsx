'use client';

import { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, Shield, ShieldOff, ExternalLink } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Skeleton } from '@/components/ui';
import { fetchJSON, truncate, explorerAddress } from '@/lib/api';

export function DelegationsPage() {
  const [delegations, setDelegations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDelegations = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/delegations');
      setDelegations(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchDelegations(); }, []);

  const columns = [
    { key: 'delegator', header: 'Delegator', render: (d: any) => (
      <a href={explorerAddress(d.delegator)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
        {truncate(d.delegator, 8)} <ExternalLink className="w-3 h-3 opacity-40" />
      </a>
    ) },
    { key: 'delegate', header: 'Delegate', render: (d: any) => <span className="font-mono text-xs">{truncate(d.delegatee || d.delegate, 8)}</span> },
    { key: 'scope', header: 'Scope', render: (d: any) => <span className="text-xs">{d.scope || d.scopeHash || '—'}</span> },
    { key: 'status', header: 'Status', render: (d: any) => <Badge variant={d.active === false ? 'danger' : 'success'}>{d.active === false ? 'Inactive' : 'Active'}</Badge> },
    { key: 'expires', header: 'Expires', render: (d: any) => <span className="text-xs text-muted-foreground">{d.expiry ? new Date(d.expiry * 1000).toLocaleDateString() : '—'}</span> },
  ];

  return (
    <div>
      <PageHeader title="Delegations" description="Credential delegation chains"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchDelegations} />}
      />

      {loading ? <Skeleton className="h-48" /> : delegations.length === 0 ? (
        <EmptyState icon={<GitBranch className="w-8 h-8" />} title="No Delegations" description="Delegations allow agents to act on behalf of other agents within defined scopes." />
      ) : (
        <Card>
          <Table columns={columns} data={delegations} emptyMessage="No delegations found" />
        </Card>
      )}
    </div>
  );
}
