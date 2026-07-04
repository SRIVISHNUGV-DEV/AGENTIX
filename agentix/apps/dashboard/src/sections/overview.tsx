'use client';

import { useState, useEffect } from 'react';
import { Building2, CreditCard, Wallet, KeyRound, Activity, Shield, Clock, Network } from 'lucide-react';
import { StatCard, PageHeader, Card, CardHeader, Badge, StatusDot, Skeleton, Timeline } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

export function OverviewPage() {
  const [stats, setStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, e] = await Promise.allSettled([
          fetchJSON<any>('/api/stats'),
          fetchJSON<any>('/api/events?limit=8'),
        ]);
        if (s.status === 'fulfilled') setStats(s.value);
        if (e.status === 'fulfilled') setEvents(e.value || []);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  const timelineEvents = (events || []).slice(0, 6).map((e: any) => ({
    time: e.timestamp ? new Date(e.timestamp * 1000).toLocaleTimeString() : '—',
    title: e.type || e.eventName || 'Event',
    description: e.data?.walletAddress ? `${e.data.walletAddress.slice(0, 6)}...` : undefined,
    status: (e.type?.includes('Failed') || e.type?.includes('Error')) ? 'error' as const : 'info' as const,
  }));

  return (
    <div>
      <PageHeader title="Overview" description="System status and live metrics" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Organizations" value={loading ? '...' : (stats?.organizations ?? 0)} icon={<Building2 className="w-4 h-4" />} />
        <StatCard label="Credentials" value={loading ? '...' : (stats?.credentials ?? 0)} icon={<CreditCard className="w-4 h-4" />} />
        <StatCard label="Wallets" value={loading ? '...' : (stats?.wallets ?? 0)} icon={<Wallet className="w-4 h-4" />} />
        <StatCard label="Sessions" value={loading ? '...' : (stats?.sessions ?? 0)} icon={<KeyRound className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Network Status */}
        <Card>
          <CardHeader title="Network" action={<StatusDot status={stats?.network ? 'online' : 'offline'} />} />
          <div className="space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Chain</span>
              <span className="font-mono text-muted-foreground">{stats?.network || '—'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Chain ID</span>
              <span className="font-mono text-muted-foreground">{stats?.chainId || '—'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">RPC</span>
              <Badge variant={stats?.network ? 'success' : 'warning'}>{stats?.network ? 'Connected' : 'Not configured'}</Badge>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Storage</span>
              <span className="font-mono text-muted-foreground">~/.agentix/</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Proofs</span>
              <span className="font-mono text-muted-foreground">{stats?.proofs ?? 0}</span>
            </div>
          </div>
        </Card>

        {/* Recent Events */}
        <Card>
          <CardHeader title="Recent Events" action={<Badge variant="default">{events.length}</Badge>} />
          {timelineEvents.length > 0 ? (
            <Timeline items={timelineEvents} />
          ) : (
            <div className="text-xs text-muted-foreground/50 text-center py-6">No events recorded yet</div>
          )}
        </Card>

        {/* Quick Actions / Activity */}
        <Card>
          <CardHeader title="Activity" />
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50">
              <div className="flex items-center gap-2.5">
                <Activity className="w-4 h-4 text-muted-foreground/40" />
                <div>
                  <div className="text-xs font-medium">Organizations</div>
                  <div className="text-[10px] text-muted-foreground/60">{stats?.organizations ?? 0} registered</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-muted-foreground/40" />
                <div>
                  <div className="text-xs font-medium">Credentials</div>
                  <div className="text-[10px] text-muted-foreground/60">{stats?.credentials ?? 0} issued</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50">
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-muted-foreground/40" />
                <div>
                  <div className="text-xs font-medium">Active Sessions</div>
                  <div className="text-[10px] text-muted-foreground/60">{stats?.sessions ?? 0} active</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50">
              <div className="flex items-center gap-2.5">
                <Network className="w-4 h-4 text-muted-foreground/40" />
                <div>
                  <div className="text-xs font-medium">Network</div>
                  <div className="text-[10px] text-muted-foreground/60">Base Sepolia</div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
