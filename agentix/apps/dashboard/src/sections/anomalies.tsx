'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Shield, ShieldOff, Clock, Zap, WifiOff } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Skeleton, StatusDot } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

const ICONS: Record<string, React.ReactNode> = {
  'Repeated reverts': <Zap className="w-4 h-4" />,
  'Expired session': <Clock className="w-4 h-4" />,
  'Wallet desync': <ShieldOff className="w-4 h-4" />,
  'RPC instability': <WifiOff className="w-4 h-4" />,
  'Credential mismatch': <Shield className="w-4 h-4" />,
};

export function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnomalies = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/anomalies');
      setAnomalies(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAnomalies(); }, []);

  const severityColor = (s: string) => {
    if (s === 'HIGH' || s === 'high') return 'danger' as const;
    if (s === 'MEDIUM' || s === 'medium') return 'warning' as const;
    return 'default' as const;
  };

  const columns = [
    { key: 'severity', header: '', render: (a: any) => (
      <div className="flex items-center gap-2">
        {ICONS[a.type] || <AlertTriangle className="w-4 h-4" />}
        <Badge variant={severityColor(a.severity)}>{a.severity || 'LOW'}</Badge>
      </div>
    )},
    { key: 'description', header: 'Anomaly', render: (a: any) => (
      <div>
        <div className="text-xs">{a.description || a.message || a.type}</div>
        {a.resolution && <div className="text-[10px] text-muted-foreground/60 mt-0.5">Fix: {a.resolution}</div>}
      </div>
    )},
    { key: 'resource', header: 'Resource', render: (a: any) => <span className="font-mono text-xs text-muted-foreground">{a.affected_resource || '—'}</span> },
    { key: 'time', header: 'Detected', render: (a: any) => <span className="text-xs text-muted-foreground/60">{a.detected_at ? new Date(a.detected_at * 1000).toLocaleString() : '—'}</span> },
    { key: 'status', header: '', render: (a: any) => a.resolved ? <Badge variant="success">Resolved</Badge> : <Badge variant="danger">Active</Badge>, className: 'text-right' },
  ];

  return (
    <div>
      <PageHeader title="Anomalies" description="Automated system anomaly detection"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchAnomalies} />}
      />

      {loading ? <Skeleton className="h-48" /> : anomalies.length === 0 ? (
        <EmptyState icon={<AlertTriangle className="w-8 h-8" />} title="No Anomalies" description="No system anomalies detected. The runtime will automatically flag issues here." />
      ) : (
        <Card><Table columns={columns} data={anomalies} emptyMessage="No anomalies detected" /></Card>
      )}
    </div>
  );
}
