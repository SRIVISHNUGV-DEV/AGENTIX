'use client';

import { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Shield } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, StatusDot } from '@/components/ui';
import { fetchJSON, postJSON } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  COMPILED: 'bg-blue-500/10 text-blue-500',
  SIMULATED: 'bg-purple-500/10 text-purple-500',
  APPROVAL_REQUIRED: 'bg-amber-500/10 text-amber-500',
  APPROVED: 'bg-green-500/10 text-green-500',
  REJECTED: 'bg-red-500/10 text-red-500',
  EXECUTING: 'bg-blue-500/10 text-blue-500',
  COMPLETED: 'bg-green-500/10 text-green-500',
  FAILED: 'bg-red-500/10 text-red-500',
  ARCHIVED: 'bg-muted text-muted-foreground',
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'bg-green-500/10 text-green-500',
  MEDIUM: 'bg-amber-500/10 text-amber-500',
  HIGH: 'bg-red-500/10 text-red-500',
  AUTHORITY: 'bg-red-600/10 text-red-600',
};

interface RiskControl { code: string; type: string; description: string }
interface ExecutionPlan {
  planId: string;
  status: string;
  intent?: { action: string; params: Record<string, unknown> };
  risk?: {
    score: number;
    category: string;
    decision?: string;
    confidence?: number;
    topDrivers?: string[];
    controls?: RiskControl[];
    notionalUsd?: number;
    dimensionScores?: Record<string, number>;
  };
  explanation?: string;
  createdAt: number;
  expiresAt: number;
  txHash?: string;
}

const DECISION_COLORS: Record<string, string> = {
  ALLOW: 'bg-green-500/10 text-green-500',
  ALLOW_WITH_CONTROLS: 'bg-teal-500/10 text-teal-500',
  REVIEW: 'bg-amber-500/10 text-amber-500',
  CHALLENGE: 'bg-orange-500/10 text-orange-500',
  DENY: 'bg-red-600/10 text-red-600',
};

export function PlansPage() {
  const [plans, setPlans] = useState<ExecutionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const url = filter ? `/api/plans?status=${filter}` : '/api/plans';
      const data = await fetchJSON<any>(url);
      setPlans(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchPlans(); }, [filter]);

  const handleApprove = async (planId: string) => {
    try {
      await postJSON('/api/plans/approve', { planId });
      fetchPlans();
    } catch (e) { console.error(e); }
  };

  return (
    <div>
      <PageHeader
        title="Execution Plans"
        description="Compiler pipeline output — every intent becomes a plan with risk score, policy check, and explanation"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchPlans} disabled={loading} />}
      />

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {['', 'APPROVAL_REQUIRED', 'EXECUTING', 'COMPLETED', 'FAILED'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              filter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-1">
          {[1, 2, 3].map(i => <div key={i} className="glass p-3 animate-pulse"><div className="h-3 bg-[hsl(var(--skeleton))] rounded w-2/3" /></div>)}
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="w-8 h-8" />}
          title="No Execution Plans"
          description="Plans are created when agents execute actions through the compiler pipeline."
        />
      ) : (
        <div className="space-y-1">
          {plans.map((plan: ExecutionPlan, i: number) => {
            const action = plan.intent?.action || 'unknown';
            const risk = plan.risk?.category || 'UNKNOWN';
            const score = plan.risk?.score || 0;
            const decision = plan.risk?.decision;
            const confidence = plan.risk?.confidence;
            const drivers = plan.risk?.topDrivers || [];
            const controls = plan.risk?.controls || [];
            const status = plan.status;

            return (
              <div
                key={plan.planId}
                className="glass p-4"
                style={{ animationDelay: `${i * 30}ms`, animation: 'slide-up 0.2s ease-out both' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={status === 'COMPLETED' ? 'online' : status === 'FAILED' ? 'error' : 'warning'} />
                    <span className="text-xs font-mono font-medium">{action}</span>
                    <span className="text-[10px] text-muted-foreground/40">#{plan.planId.slice(0, 8)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {decision && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${DECISION_COLORS[decision] || 'bg-muted text-muted-foreground'}`}>
                        {decision.replace(/_/g, ' ')}
                      </span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${RISK_COLORS[risk] || ''}`}>
                      {risk} ({score})
                      {typeof confidence === 'number' && (
                        <span className="opacity-60"> · {Math.round(confidence * 100)}%</span>
                      )}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[status] || ''}`}>
                      {status}
                    </span>
                  </div>
                </div>

                {plan.explanation && (
                  <div className="text-[11px] text-muted-foreground/70 mb-2 line-clamp-2">
                    {(() => {
                      try {
                        const exp = typeof plan.explanation === 'string' ? JSON.parse(plan.explanation) : plan.explanation;
                        return exp.detailed || exp.plain || plan.explanation;
                      } catch { return plan.explanation; }
                    })()}
                  </div>
                )}

                {(drivers.length > 0 || controls.length > 0) && (
                  <div className="mb-2 space-y-1">
                    {drivers.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {drivers.slice(0, 4).map((d, di) => (
                          <span key={di} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[9px] font-medium">
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                    {controls.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Shield className="w-3 h-3 text-amber-500/70" />
                        {controls.map((c, ci) => (
                          <span key={ci} title={c.description} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[9px] font-medium">
                            {c.type.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
                    <span>{plan.createdAt ? new Date(plan.createdAt * 1000).toLocaleString() : '—'}</span>
                    {plan.txHash && (
                      <span className="font-mono text-green-500/70">tx: {plan.txHash.slice(0, 10)}...</span>
                    )}
                  </div>

                  {status === 'APPROVAL_REQUIRED' && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleApprove(plan.planId)}
                        className="px-2 py-0.5 rounded bg-green-500/10 text-green-500 text-[10px] font-medium hover:bg-green-500/20"
                      >
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
