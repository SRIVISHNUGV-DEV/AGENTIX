import { ExecutionPlan, PlanStatus } from '../types/execution-plan';
import { RiskCategory, RiskAssessment } from '../types/risk';
import { runQuery, runSingle, runExecute } from '@agentix/database';

export class PlanStore {
  /**
   * Persist an execution plan (insert or replace by plan id), serializing its sub-graphs to JSON columns.
   * Why: plans are the durable approval artifact — every lifecycle step reads back what was saved here.
   * @param plan - execution plan to store.
   * @param compiledBy - optional wallet address of the compiler, stored for audit; null when omitted.
   * Side effects: one INSERT OR REPLACE into execution_plans.
   * Maps to: internal — ExecutionPlanGenerator.generate.
   */
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

  /**
   * Fetch a plan by id.
   * Why: the read path for approval/execution flows.
   * @param planId - plan id.
   * @returns The deserialized plan, or null when unknown.
   * Maps to: internal — ExecutionPlanGenerator.get.
   */
  get(planId: string): ExecutionPlan | null {
    const row = runSingle(
      'SELECT * FROM execution_plans WHERE plan_id = ?',
      [planId]
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._deserialize(row);
  }

  /**
   * Fetch the newest plan with a given content hash.
   * Why: content-hash lookup powers cache/dedup — an identical recompile finds its predecessor here.
   * @param contentHash - plan content hash.
   * @returns The newest matching plan, or null when none exists.
   * Maps to: internal — ExecutionPlanGenerator.getByHash.
   */
  getByHash(contentHash: string): ExecutionPlan | null {
    const row = runSingle(
      'SELECT * FROM execution_plans WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1',
      [contentHash]
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._deserialize(row);
  }

  /**
   * List plans in one status, newest first.
   * Why: status queues (e.g. APPROVAL_REQUIRED) are how operators triage.
   * @param status - plan status filter.
   * @param limit - max rows; defaults to 50.
   * @returns Plans newest first; empty array when none match.
   * Maps to: internal — PipelineOrchestrator.listPlans.
   */
  listByStatus(status: PlanStatus, limit: number = 50): ExecutionPlan[] {
    const rows = runQuery(
      'SELECT * FROM execution_plans WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, limit]
    ) as Record<string, unknown>[];
    return rows.map((r) => this._deserialize(r));
  }

  /**
   * List all plans newest first.
   * Why: the history view with no status filter.
   * @param limit - max rows; defaults to 50.
   * @returns Plans newest first; empty array when the store is empty.
   * Maps to: internal — PipelineOrchestrator.listPlans.
   */
  listRecent(limit: number = 50): ExecutionPlan[] {
    const rows = runQuery(
      'SELECT * FROM execution_plans ORDER BY created_at DESC LIMIT ?',
      [limit]
    ) as Record<string, unknown>[];
    return rows.map((r) => this._deserialize(r));
  }

  /**
   * Update a plan's status plus optional tx hash / rejection reason.
   * Why: lifecycle transitions persist through here — the in-memory plan object and the row must agree.
   * @param planId - plan id; unknown ids update zero rows silently.
   * @param status - new status.
   * @param extra - optional txHash (on completion) and/or rejectionReason (on reject/fail); undefined fields are left untouched.
   * Side effects: one UPDATE on execution_plans.
   * Maps to: internal — ExecutionPlanGenerator lifecycle methods.
   */
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

  /**
   * Fail every non-terminal plan whose expiresAt has passed.
   * Why: expired plans must never become executable later — expiry is enforced by sweeping them to FAILED, not by hoping callers check.
   * @returns Number of rows updated (0 when nothing expired, or when the driver does not report a count).
   * Side effects: UPDATEs execution_plans rows in DRAFT/COMPILED/SIMULATED/APPROVED/APPROVAL_REQUIRED with expires_at in the past.
   * Maps to: internal — plan expiry sweep (no caller in the pipeline yet; run on a schedule).
   */
  expirePlans(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = runExecute(
      `UPDATE execution_plans SET status = 'FAILED' WHERE status IN ('DRAFT', 'COMPILED', 'SIMULATED', 'APPROVED', 'APPROVAL_REQUIRED') AND expires_at < ? AND expires_at IS NOT NULL`,
      [now]
    );
    return typeof result === 'number' ? result : 0;
  }

  /**
   * Rebuild an ExecutionPlan from a DB row, parsing the JSON columns.
   * Why: plans are stored shredded (JSON blobs + scalar risk columns) and must come back as one object — this is the single deserialization path.
   * @param row - raw execution_plans row.
   * @returns The plan; missing simulation JSON becomes a failed-simulation placeholder, missing explanation becomes '', requiredSignatures are always [] (they are not persisted).
   * @throws Propagates JSON.parse failures on corrupt rows — callers must not assume a stored row is well-formed.
   * Maps to: internal — PlanStore.get / getByHash / listByStatus / listRecent.
   */
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
   * Restore the full risk assessment from risk_json, falling back to legacy score/category columns.
   * Why: plans persisted before risk_json existed still render — the fallback keeps old rows readable without a migration.
   * @param row - raw execution_plans row.
   * @returns The parsed RiskAssessment when risk_json is present and well-formed with a numeric score, otherwise a minimal LOW assessment (score from risk_score, or 0) with empty factors/warnings/suggestions and requiresApproval false.
   * Maps to: internal — PlanStore._deserialize.
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
