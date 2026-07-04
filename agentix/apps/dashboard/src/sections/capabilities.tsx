'use client';

import { useState, useEffect } from 'react';
import { Layers, RefreshCw, Shield, ShieldOff, ExternalLink } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Skeleton } from '@/components/ui';
import { fetchJSON, truncate } from '@/lib/api';

export function CapabilitiesPage() {
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCapabilities = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/capabilities');
      setCapabilities(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchCapabilities(); }, []);

  const columns = [
    { key: 'capabilityId', header: 'Capability', render: (c: any) => <span className="font-mono text-xs">{truncate(c.capability_id || c.capabilityId, 10)}</span> },
    { key: 'action', header: 'Action', render: (c: any) => <span className="text-xs">{c.name || c.action || '—'}</span> },
    { key: 'status', header: 'Status', render: (c: any) => <Badge variant={c.revoked ? 'danger' : 'success'}>{c.revoked ? 'Revoked' : 'Active'}</Badge> },
    { key: 'expires', header: 'Expires', render: (c: any) => <span className="text-xs text-muted-foreground">{c.expires_at || c.expiresAt ? new Date((c.expires_at || c.expiresAt) * 1000).toLocaleDateString() : '—'}</span> },
  ];

  return (
    <div>
      <PageHeader title="Capabilities" description="Registered on-chain capabilities"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchCapabilities} />}
      />

      {loading ? <Skeleton className="h-48" /> : capabilities.length === 0 ? (
        <EmptyState icon={<Layers className="w-8 h-8" />} title="No Capabilities" description="Capabilities are registered by the protocol owner. They define what actions agents can perform." />
      ) : (
        <Card>
          <Table columns={columns} data={capabilities} emptyMessage="No capabilities found" />
        </Card>
      )}
    </div>
  );
}
