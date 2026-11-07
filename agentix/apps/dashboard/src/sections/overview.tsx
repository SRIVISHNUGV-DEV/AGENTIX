'use client';

import { useState, useEffect, useMemo } from 'react';
import { Building2, CreditCard, Wallet, KeyRound, Activity, Shield, Clock, Network, ChevronRight } from 'lucide-react';
import { StatCard, PageHeader, Card, CardHeader, Badge, StatusDot, Skeleton, Timeline } from '@/components/ui';
import { ActivityChart, type ActivityPoint } from '@/components/activity-chart';
import { fetchJSON } from '@/lib/api';

// Navigate without prop-drilling — page.tsx listens for this custom event
// (see the 'agentix:navigate' handler in app/page.tsx) and swaps the section.
/**
 * Navigates to another dashboard page without prop-drilling, by dispatching the `agentix:navigate` custom event that DashboardInner listens for.
 * @param page - Page id (must be a key of PAGES in app/page.tsx; unknown ids are ignored by the listener).
 * @returns void.
 * Maps to: internal — DashboardInner (`agentix:navigate` handler in app/page.tsx).
 * Side effects: dispatches a window CustomEvent.
 */
function navigate(page: string) {
  window.dispatchEvent(new CustomEvent('agentix:navigate', { detail: page }));
}

const QUICK_ACTIONS: { page: string; icon: React.ComponentType<{ className?: string }>; title: string; description: string }[] = [
  { page: 'organizations', icon: Building2, title: 'Create Organization', description: 'Set up an org to issue credentials' },
  { page: 'wallets', icon: Wallet, title: 'Create Wallet', description: 'Deploy an ERC-4337 smart wallet' },
  { page: 'credentials', icon: CreditCard, title: 'Issue Credential', description: 'Create a ZK credential for an agent' },
  { page: 'sessions', icon: KeyRound, title: 'Create Session', description: 'Authorize agent actions with limits' },
];

// Event types that count toward each KPI's 7-day sparkline. Real data only:
// if the backend has no history, the series is flat and the sparkline hides.
const SERIES_TYPES: Record<string, string[]> = {
  organizations: ['OrganizationRegistered', 'OrganizationDeactivated', 'OrganizationReactivated'],
  credentials: ['CredentialIssued', 'CredentialRevoked', 'CredentialLinked'],
  wallets: ['WalletCreated', 'WalletInitialized', 'WalletLinked'],
  sessions: ['SessionCreated', 'SessionUsed', 'SessionRevoked', 'LightSessionCreated', 'LightSessionUsed', 'LightSessionRevoked'],
};

/**
 * Computes the 7-day window ending today: the start timestamp (midnight 6 days ago) and one short weekday/day label per day.
 * @returns `{ start, labels }` where `start` is the window start in ms and `labels` has 7 entries in chronological order.
 * Maps to: internal — OverviewPage (sparkline/activity buckets).
 */
function last7Days(): { start: number; labels: string[] } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime() - 6 * 86400000;
  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startMs + i * 86400000);
    labels.push(d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));
  }
  return { start: startMs, labels };
}

/**
 * Counts events into per-day buckets over a window starting at `startMs`.
 * @param events - Raw events with a `timestamp` in seconds and a `type`.
 * @param types - Event types to count, or null to count all types.
 * @param startMs - Window start in ms.
 * @param days - Number of daily buckets (default 7).
 * @returns An array of `days` counts; events without a timestamp or outside the window are ignored.
 * Maps to: internal — OverviewPage series/activity computation; event types come from the `SessionCreated`-style contract events.
 */
function bucketByDay(events: any[], types: string[] | null, startMs: number, days = 7): number[] {
  const out = new Array(days).fill(0);
  for (const e of events) {
    if (types && !types.includes(e.type)) continue;
    const t = e.timestamp ? e.timestamp * 1000 : null;
    if (!t) continue;
    const idx = Math.floor((t - startMs) / 86400000);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

/**
 * Overview dashboard: four KPI cards with 7-day sparklines, the 7-day activity chart, network status, recent events, and quick-action shortcuts.
 * Loads /api/stats and /api/events (limit 200) once on mount; either may fail independently (Promise.allSettled) and the page still renders with zeros/empty lists.
 * @returns The overview page; while loading the KPI cards show skeletons and the chart area shows a skeleton.
 * Maps to: REST GET /api/stats and GET /api/events?limit=200; Maps to: component StatCard, ActivityChart, Timeline.
 */
export function OverviewPage() {
  const [stats, setStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /**
     * WHAT: Loads the dashboard stats and the latest 200 events, each into its own state, then clears the loading spinner.
     * WHY: The overview is the landing view — stats and events load independently so one failed fetch does not blank the other.
     * @returns Nothing; sets stats/events only for the fetches that fulfilled.
     * @throws Never throws — Promise.allSettled; a rejected fetch simply leaves its state empty.
     * Maps to: REST GET /api/stats and GET /api/events?limit=200.
     * Side effects: setState on mount only.
     */
    async function load() {
      try {
        const [s, e] = await Promise.allSettled([
          fetchJSON<any>('/api/stats'),
          fetchJSON<any>('/api/events?limit=200'),
        ]);
        if (s.status === 'fulfilled') setStats(s.value);
        if (e.status === 'fulfilled') setEvents(Array.isArray(e.value) ? e.value : (e.value?.events || []));
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  const { start, labels } = useMemo(last7Days, []);
  const series = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const [key, types] of Object.entries(SERIES_TYPES)) out[key] = bucketByDay(events, types, start);
    return out;
  }, [events, start]);
  const activityPoints: ActivityPoint[] = useMemo(() => {
    const totals = bucketByDay(events, null, start);
    return labels.map((label, i) => ({ label, value: totals[i] }));
  }, [events, start, labels]);

  const timelineEvents = (events || []).slice(0, 6).map((e: any) => ({
    time: e.timestamp ? new Date(e.timestamp * 1000).toLocaleTimeString() : '—',
    title: e.type || e.eventName || 'Event',
    description: e.data?.walletAddress ? `${e.data.walletAddress.slice(0, 6)}...` : undefined,
    status: (e.type?.includes('Failed') || e.type?.includes('Error')) ? 'error' as const : 'info' as const,
  }));

  /**
   * Returns the 7-day series for a KPI key, or undefined when the series sums to zero — so a flat/no-history sparkline is hidden rather than faking data.
   * @param key - Series key (organizations | credentials | wallets | sessions).
   * @returns The number[] series, or undefined when it has no events.
   * Maps to: internal — OverviewPage StatCards.
   */
  const spark = (key: string) => {
    const s = series[key] || [];
    const sum = s.reduce((a, b) => a + b, 0);
    // Hide the sparkline when there is no history to draw — never fake data.
    return sum > 0 ? s : undefined;
  };

  return (
    <div>
      <PageHeader title="Overview" description="System status and live metrics" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard loading={loading} label="Organizations" value={stats?.organizations ?? 0} icon={<Building2 className="w-4 h-4" />} sparkline={spark('organizations')} />
        <StatCard loading={loading} label="Credentials" value={stats?.credentials ?? 0} icon={<CreditCard className="w-4 h-4" />} sparkline={spark('credentials')} />
        <StatCard loading={loading} label="Wallets" value={stats?.wallets ?? 0} icon={<Wallet className="w-4 h-4" />} sparkline={spark('wallets')} />
        <StatCard loading={loading} label="Sessions" value={stats?.sessions ?? 0} icon={<KeyRound className="w-4 h-4" />}
          trend={stats?.sessions ? `${stats.sessions} active` : undefined} trendDir={stats?.sessions ? 'up' : 'neutral'}
          sparkline={spark('sessions')} />
      </div>

      {/* Activity — real event volume, last 7 days. */}
      <Card className="mb-6">
        <CardHeader title="Activity" description="On-chain and system events per day, last 7 days" />
        {loading ? <Skeleton className="h-56" /> : <ActivityChart points={activityPoints} title="Events per day" />}
      </Card>

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
