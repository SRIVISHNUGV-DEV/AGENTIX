'use client';

import { useState, useEffect } from 'react';
import { Building2, CreditCard, Wallet, KeyRound, Activity, Shield, Clock, Network, ChevronRight } from 'lucide-react';
import { StatCard, PageHeader, Card, CardHeader, Badge, StatusDot, Skeleton, Timeline } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

// Navigate without prop-drilling — page.tsx listens for this custom event
// (see the 'agentix:navigate' handler in app/page.tsx) and swaps the section.
function navigate(page: string) {
  window.dispatchEvent(new CustomEvent('agentix:navigate', { detail: page }));
}

const QUICK_ACTIONS: { page: string; icon: React.ComponentType<{ className?: string }>; title: string; description: string }[] = [
  { page: 'organizations', icon: Building2, title: 'Create Organization', description: 'Set up an org to issue credentials' },
  { page: 'wallets', icon: Wallet, title: 'Create Wallet', description: 'Deploy an ERC-4337 smart wallet' },
  { page: 'credentials', icon: CreditCard, title: 'Issue Credential', description: 'Create a ZK credential for an agent' },
  { page: 'sessions', icon: KeyRound, title: 'Create Session', description: 'Authorize agent actions with limits' },
];

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
        if (e.status === 'fulfilled') setEvents(Array.isArray(e.value) ? e.value : (e.value?.events || []));
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
        <StatCard loading={loading} label="Organizations" value={stats?.organizations ?? 0} icon={<Building2 className="w-4 h-4" />} />
        <StatCard loading={loading} label="Credentials" value={stats?.credentials ?? 0} icon={<CreditCard className="w-4 h-4" />} />
        <StatCard loading={loading} label="Wallets" value={stats?.wallets ?? 0} icon={<Wallet className="w-4 h-4" />} />
        <StatCard loading={loading} label="Sessions" value={stats?.sessions ?? 0} icon={<KeyRound className="w-4 h-4" />}
          trend={stats?.sessions ? `${stats.sessions} active` : undefined} trendDir={stats?.sessions ? 'up' : 'neutral'} />
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

        {/* Quick Actions — navigate to the most common workflows. Replaces the
            old "Activity" card which just re-printed the four stat numbers
            already shown above it. */}
        <Card>
          <CardHeader title="Quick Actions" />
          <div className="space-y-2">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.page}
                onClick={() => navigate(action.page)}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 card-interactive text-left group"
              >
                <div className="flex items-center gap-2.5">
                  <action.icon className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  <div>
                    <div className="text-xs font-medium">{action.title}</div>
                    <div className="text-[10px] text-muted-foreground/60">{action.description}</div>
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
