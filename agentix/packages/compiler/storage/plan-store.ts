import { ExecutionPlan, PlanStatus } from '../types/execution-plan';
import { RiskCategory, RiskAssessment } from '../types/risk';
import { runQuery, runSingle, runExecute } from '@agentix/database';

export class PlanStore {
  save(plan: ExecutionPlan, compiledBy?: string): void {
    const now = Math.floor(Date.now() / 1000);
    runExecute(
      `INSERT OR REPLACE INTO execution_plans
       (plan_id, content_hash, intent_json, steps_json, policy_json, capability_graph_json, simulation_json, risk_score, risk_category, risk_json, explanation_json, status, compiled_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.planId,
        plan.contentHash,
        JSON.stringify(plan.intent),
        JSON.stringify(plan.executionGraph),
        JSON.stringify(plan.policyGraph),
        JSON.stringify(plan.capabilityGraph || {}),
        JSON.stringify(plan.simulation || {}),
        plan.risk.score,
        plan.risk.category,
        JSON.stringify(plan.risk),
        JSON.stringify(plan.explanation),
        plan.status,
        compiledBy || null,
        plan.createdAt,
        plan.expiresAt,
      ]
    );
  }

  get(planId: string): ExecutionPlan | null {
    const row = runSingle(
      'SELECT * FROM execution_plans WHERE plan_id = ?',
      [planId]
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._deserialize(row);
  }

  getByHash(contentHash: string): ExecutionPlan | null {
    const row = runSingle(
      'SELECT * FROM execution_plans WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1',
      [contentHash]
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._deserialize(row);
  }

  listByStatus(status: PlanStatus, limit: number = 50): ExecutionPlan[] {
    const rows = runQuery(
      'SELECT * FROM execution_plans WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, limit]
    ) as Record<string, unknown>[];
    return rows.map((r) => this._deserialize(r));
  }

  listRecent(limit: number = 50): ExecutionPlan[] {
    const rows = runQuery(
      'SELECT * FROM execution_plans ORDER BY created_at DESC LIMIT ?',
      [limit]
    ) as Record<string, unknown>[];
    return rows.map((r) => this._deserialize(r));
  }

  updateStatus(planId: string, status: PlanStatus, extra?: { txHash?: string; rejectionReason?: string }): void {
    const updates: string[] = ['status = ?'];
    const values: unknown[] = [status];

    if (extra?.txHash !== undefined) {
      updates.push('tx_hash = ?');
      values.push(extra.txHash);
    }
    if (extra?.rejectionReason !== undefined) {
      updates.push('rejection_reason = ?');
      values.push(extra.rejectionReason);
    }

    values.push(planId);
    runExecute(`UPDATE execution_plans SET ${updates.join(', ')} WHERE plan_id = ?`, values);
  }

  expirePlans(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = runExecute(
      `UPDATE execution_plans SET status = 'FAILED' WHERE status IN ('DRAFT', 'COMPILED', 'SIMULATED', 'APPROVED', 'APPROVAL_REQUIRED') AND expires_at < ? AND expires_at IS NOT NULL`,
      [now]
    );
    return typeof result === 'number' ? result : 0;
  }

  private _deserialize(row: Record<string, unknown>): ExecutionPlan {
    return {
      planId: row.plan_id as string,
      contentHash: row.content_hash as string,
      version: 1,
      intent: JSON.parse(row.intent_json as string),
      capabilityGraph: JSON.parse((row.capability_graph_json as string) || '{}'),
      policyGraph: JSON.parse(row.policy_json as string),
      executionGraph: JSON.parse(row.steps_json as string),
      simulation: (row as Record<string, unknown>).simulation_json
        ? JSON.parse((row as Record<string, unknown>).simulation_json as string)
        : { success: false, steps: [], warnings: [], errors: ['plan deserialized from storage - no simulation data'] },
      risk: this._deserializeRisk(row),
      explanation: (row.explanation_json as string) || '',
      requiredSignatures: [],
      status: row.status as PlanStatus,
      createdAt: row.created_at as number,
      expiresAt: (row.expires_at as number) || 0,
      executedAt: (row as Record<string, unknown>).executed_at as number | undefined,
      completedAt: (row as Record<string, unknown>).completed_at as number | undefined,
      txHash: (row as Record<string, unknown>).tx_hash as string | undefined,
    };
  }

  /**
   * Restore the full multi-dimensional risk assessment from `risk_json`. Falls
   * back to the legacy score/category columns for plans persisted before the
   * risk_json column existed, so old rows still render without crashing.
   */
  private _deserializeRisk(row: Record<string, unknown>): RiskAssessment {
    const raw = row.risk_json as string | undefined;
    if (raw && raw !== '{}') {
      try {
        const parsed = JSON.parse(raw) as RiskAssessment;
        if (parsed && typeof parsed.score === 'number' && parsed.category) return parsed;
      } catch {}
    }
    return {
      score: (row.risk_score as number) || 0,
      category: (row.risk_category as RiskCategory) || 'LOW',
      factors: [],
      warnings: [],
      suggestions: [],
      requiresApproval: false,
    };
  }
}
