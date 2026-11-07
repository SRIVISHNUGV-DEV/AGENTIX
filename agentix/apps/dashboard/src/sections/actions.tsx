'use client';

import { useState, useEffect } from 'react';
import { Terminal, RefreshCw, ExternalLink } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, StatusDot } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

/**
 * Agent Actions page: the complete audit trail of agent activity (tool, intent, risk level, time, success).
 * @returns The actions list; a loading skeleton while fetching, an empty state when nothing is logged.
 * Maps to: REST GET /api/actions; Maps to: component Table (not used — custom rows here).
 */
export function ActionsPage() {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Reloads the action audit trail from /api/actions (accepts either `data.value` or a bare array).
   * @returns void; on failure logs the error and leaves the previous list in place.
   * @throws Never — fetch errors are caught and logged.
   * Maps to: REST GET /api/actions.
   * Side effects: sets actions/loading state.
   */
  const fetchActions = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/actions');
      setActions(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchActions(); }, []);

  return (
    <div>
      <PageHeader title="Agent Actions" description="Complete audit trail of all agent activity"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchActions} disabled={loading} />}
      />

      {loading ? (
        <div className="space-y-1">
          {[1, 2, 3].map(i => <div key={i} className="glass p-3 animate-pulse"><div className="h-3 bg-[hsl(var(--skeleton))] rounded w-2/3" /></div>)}
        </div>
      ) : actions.length === 0 ? (
        <EmptyState icon={<Terminal className="w-8 h-8" />} title="No Actions Logged" description="Every agent action will be logged here with full context." />
      ) : (
        <div className="space-y-1">
          {actions.map((a: any, i: number) => (
            <div key={a.id || i} className="glass flex items-center justify-between py-2.5 px-4"
              style={{ animationDelay: `${i * 30}ms`, animation: 'slide-up 0.2s ease-out both' }}>
              <div className="flex items-center gap-3">
                <StatusDot status={a.success ? 'online' : 'error'} />
                <div>
                  <div className="text-xs font-mono">{a.tool}</div>
                  <div className="text-[10px] text-muted-foreground/60">{a.intent}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={a.risk_level === 'HIGH' || a.risk_level === 'AUTHORITY' ? 'danger' : 'default'}>{a.risk_level}</Badge>
                <span className="text-[10px] text-muted-foreground/40 font-mono">{a.timestamp ? new Date(a.timestamp * 1000).toLocaleTimeString() : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
