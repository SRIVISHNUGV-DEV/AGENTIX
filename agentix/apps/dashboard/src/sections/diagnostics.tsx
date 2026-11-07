'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { PageHeader, Badge, Button, Card, CardHeader, StatusDot, Skeleton } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

/**
 * Diagnostics page: system health checks from /api/diagnostics, summarized as passed/warning/error counts.
 * @returns The checks list with per-check status badges; a loading skeleton while fetching, an error card when the fetch fails.
 * Maps to: REST GET /api/diagnostics.
 */
export function DiagnosticsPage() {
  const [checks, setChecks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reloads diagnostics from /api/diagnostics (accepts `data.checks` or a bare array; non-arrays become []).
   * @returns void; on failure stores the error message for the error card (previous checks are left in place).
   * @throws Never — fetch errors are caught into `error` state.
   * Maps to: REST GET /api/diagnostics.
   * Side effects: sets checks/loading/error state.
   */
  const fetchDiagnostics = async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchJSON<any>('/api/diagnostics');
      const raw = data.checks || data || [];
      setChecks(Array.isArray(raw) ? raw : []);
    } catch (e: any) { setError(e.message || 'Failed to fetch diagnostics'); }
    setLoading(false);
  };

  useEffect(() => { fetchDiagnostics(); }, []);

  const passed = checks.filter(c => c.status === 'PASS').length;
  const warnings = checks.filter(c => c.status === 'WARNING').length;
  const errors = checks.filter(c => c.status === 'ERROR').length;

  /**
   * Status icon for one diagnostic check: check-circle for PASS, warning triangle for WARNING, X-circle for anything else (including ERROR/unknown).
   * @param status - The check status string ('PASS' | 'WARNING' | 'ERROR' | other).
   * @returns The icon element.
   * Maps to: internal — DiagnosticsPage rows.
   */
  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'PASS') return <CheckCircle2 className="w-4 h-4 text-success" />;
    if (status === 'WARNING') return <AlertTriangle className="w-4 h-4 text-warning" />;
    return <XCircle className="w-4 h-4 text-destructive" />;
  };

  return (
    <div>
      <PageHeader title="Diagnostics" description="System health and connectivity"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchDiagnostics} disabled={loading} />}
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card className="text-center p-6"><div className="text-2xl font-light">{passed}</div><div className="text-[10px] text-muted-foreground/60 tracking-wider uppercase mt-1">Passed</div></Card>
        <Card className="text-center p-6"><div className="text-2xl font-light text-warning">{warnings}</div><div className="text-[10px] text-muted-foreground/60 tracking-wider uppercase mt-1">Warnings</div></Card>
        <Card className="text-center p-6"><div className="text-2xl font-light text-destructive">{errors}</div><div className="text-[10px] text-muted-foreground/60 tracking-wider uppercase mt-1">Errors</div></Card>
      </div>

      {loading ? <Skeleton className="h-64" /> : error ? (
        <Card><div className="text-center py-8"><XCircle className="w-8 h-8 text-destructive/40 mx-auto mb-3" /><p className="text-xs text-destructive/60">{error}</p></div></Card>
      ) : (
        <div className="space-y-1">
          {checks.map((check: any, i: number) => (
            <div key={i} className="glass flex items-center justify-between py-3 px-4"
              style={{ animation: 'slide-up 0.2s ease-out both', animationDelay: `${i * 30}ms` }}>
              <div className="flex items-center gap-3">
                <StatusIcon status={check.status} />
                <div>
                  <div className="text-xs">{check.name}</div>
                  <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{check.value || check.message || check.detail || ''}</div>
                </div>
              </div>
              <Badge variant={check.status === 'PASS' ? 'success' : check.status === 'WARNING' ? 'warning' : 'danger'}>{check.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
