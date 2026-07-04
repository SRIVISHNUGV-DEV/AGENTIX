'use client';

import { useState, useEffect } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { PageHeader, StatCard, Button, Card, CardHeader, Skeleton } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

export function AnalyticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/stats');
      setStats(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadStats(); }, []);

  return (
    <div>
      <PageHeader title="Analytics" description="Protocol usage and performance metrics"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={loadStats} disabled={loading} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Organizations" value={loading ? '...' : (stats?.organizations ?? 0)} icon={<BarChart3 className="w-4 h-4" />} />
        <StatCard label="Wallets" value={loading ? '...' : (stats?.wallets ?? 0)} icon={<BarChart3 className="w-4 h-4" />} />
        <StatCard label="Sessions" value={loading ? '...' : (stats?.sessions ?? 0)} icon={<BarChart3 className="w-4 h-4" />} />
        <StatCard label="Credentials" value={loading ? '...' : (stats?.credentials ?? 0)} icon={<BarChart3 className="w-4 h-4" />} />
      </div>

      <Card>
        <CardHeader title="Network" />
        <div className="space-y-2.5">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Chain</span><span className="font-mono">{stats?.network || '—'}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Chain ID</span><span className="font-mono">{stats?.chainId || '—'}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Proofs</span><span className="font-mono">{stats?.proofs ?? 0}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Organizations</span><span className="font-mono">{stats?.organizations ?? 0}</span></div>
        </div>
      </Card>
    </div>
  );
}
