import { ParsedIntent } from '../types/intent';
import { ExecutionPlan, ExecutionGraph, PLAN_LIFECYCLE, PlanStatus } from '../types/execution-plan';
import { ResolvedCapabilities } from '../types/capability';
import { OptimizedPolicy } from '../types/policy';
import { RiskAssessment } from '../types/risk';
import { SimulationResult } from '../types/simulation';
import { generateId, checksum } from '@agentix/utils';
import { PlanStore } from '../storage/plan-store';

export class ExecutionPlanGenerator {
  /**
   * Build the plan generator around a PlanStore.
   * Why: every generated plan is persisted immediately — the plan id is only meaningful if the store has it.
   * @param planStore - store used for save/get/status updates.
   * Maps to: internal — PipelineOrchestrator constructor.
   */
  constructor(private planStore: PlanStore) {}

    /**
     * Assemble and persist the final ExecutionPlan from all prior stages.
     * Why: stage 10 is the pipeline's output — it binds intent, capabilities, policy, graph, simulation, risk and explanation into one signed-approval artifact.
     * @param intent - parsed intent.
     * @param capabilities - resolved capabilities.
     * @param policy - optimized policy.
     * @param executionGraph - execution graph from contract resolution.
     * @param simulation - simulation result.
     * @param risk - risk assessment; requiresApproval decides APPROVAL_REQUIRED vs APPROVED status.
     * @param explanation - JSON explanation string from stage 9.
     * @returns The persisted ExecutionPlan; expiresAt comes from policy.effectiveLimits.expiry (default now+3600s).
     * Side effects: saves the plan to the PlanStore.
     * Maps to: internal — PipelineOrchestrator.compile (stage 10).
     */
  generate(
    intent: ParsedIntent,
    capabilities: ResolvedCapabilities,
    policy: OptimizedPolicy,
    executionGraph: ExecutionGraph,
    simulation: SimulationResult,
    risk: RiskAssessment,
    explanation: string
  ): ExecutionPlan {
    const planId = generateId();
    const now = Math.floor(Date.now() / 1000);
    const contentHash = this._computeHash(intent, policy, executionGraph);

    const plan: ExecutionPlan = {
      planId,
      contentHash,
      version: 1,
      intent,
      capabilityGraph: capabilities,
      policyGraph: policy,
      executionGraph,
      simulation,
      risk,
      explanation,
      requiredSignatures: this._determineRequiredSignatures(risk, intent),
      status: risk.requiresApproval ? 'APPROVAL_REQUIRED' : 'APPROVED',
      createdAt: now,
      expiresAt: policy.effectiveLimits?.expiry || now + 3600,
    };

    this.planStore.save(plan, intent.agent?.walletAddress);

    return plan;
  }

  /**
   * Fetch a plan by id.
   * Why: the read path for approval/execution flows.
   * @param planId - plan id.
   * @returns The plan, or null when unknown.
   * Maps to: internal — PlanStore.get.
   */
  get(planId: string): ExecutionPlan | null {
    return this.planStore.get(planId);
  }

  /**
   * Fetch the newest plan with a given content hash.
   * Why: content-hash lookup is how the cache/dedup path finds a prior identical plan.
   * @param contentHash - checksum of intent+policy+graph.
   * @returns The newest matching plan, or null when none exists.
   * Maps to: internal — PlanStore.getByHash.
   */
  getByHash(contentHash: string): ExecutionPlan | null {
    return this.planStore.getByHash(contentHash);
  }

  /**
   * Move a plan to APPROVED.
   * Why: the human gate for APPROVAL_REQUIRED plans; illegal transitions are no-ops, not errors.
   * @param planId - plan id.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — PlanStore.updateStatus.
   */
  approve(planId: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'APPROVED')) return plan;

    plan.status = 'APPROVED';
    this.planStore.updateStatus(planId, 'APPROVED');
    return plan;
  }

  /**
   * Reject a plan, persisting the reason.
   * Why: rejections are auditable state, not a deleted row.
   * @param planId - plan id.
   * @param reason - rejection reason stored with the plan.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — PlanStore.updateStatus.
   */
  reject(planId: string, reason: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'REJECTED')) return plan;

    plan.status = 'REJECTED';
    this.planStore.updateStatus(planId, 'REJECTED', { rejectionReason: reason });
    return plan;
  }

  /**
   * Mark a plan EXECUTING and stamp executedAt.
   * Why: lifecycle bookkeeping for the runtime that actually sends the transaction.
   * @param planId - plan id; must be APPROVED.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — PlanStore.updateStatus.
   */
  execute(planId: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'EXECUTING')) return plan;

    plan.status = 'EXECUTING';
    plan.executedAt = Math.floor(Date.now() / 1000);
    this.planStore.updateStatus(planId, 'EXECUTING');
    return plan;
  }

  /**
   * Mark a plan COMPLETED with its transaction hash and completedAt stamp.
   * Why: completion is only valid with on-chain proof (the tx hash).
   * @param planId - plan id; must be EXECUTING.
   * @param txHash - transaction hash of the executed call.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — PlanStore.updateStatus.
   */
  complete(planId: string, txHash: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'COMPLETED')) return plan;

    plan.status = 'COMPLETED';
    plan.completedAt = Math.floor(Date.now() / 1000);
    plan.txHash = txHash;
    this.planStore.updateStatus(planId, 'COMPLETED', { txHash });
    return plan;
  }

  /**
   * Mark a plan FAILED, persisting the error as its rejection reason.
   * Why: failed plans stay queryable for retry and audit.
   * @param planId - plan id.
   * @param error - failure reason stored on the plan.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — PlanStore.updateStatus.
   */
  fail(planId: string, error: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'FAILED')) return plan;

    plan.status = 'FAILED';
    this.planStore.updateStatus(planId, 'FAILED', { rejectionReason: error });
    return plan;
  }

  /**
   * Archive a plan; only COMPLETED plans may archive.
   * Why: ARCHIVED is terminal — it is a deliberate extra guard beyond the generic lifecycle table.
   * @param planId - plan id.
   * @returns The updated plan, null when unknown, or the unchanged plan when not COMPLETED.
   * Maps to: internal — PlanStore.updateStatus.
   */
  archive(planId: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (plan.status !== 'COMPLETED') return plan;

    plan.status = 'ARCHIVED';
    this.planStore.updateStatus(planId, 'ARCHIVED');
    return plan;
  }

  /**
   * Check the PLAN_LIFECYCLE table for whether a status transition is legal.
   * Why: every lifecycle method funnels through here — the table, not ad-hoc ifs, decides legality.
   * @param from - current status.
   * @param to - desired status.
   * @returns True when the table lists `to` as reachable from `from`; false for unknown `from` statuses.
   * Maps to: internal — ExecutionPlanGenerator lifecycle methods.
   */
  private _canTransition(from: PlanStatus, to: PlanStatus): boolean {
    const rule = PLAN_LIFECYCLE.find((r) => r.from === from);
    return rule ? rule.to.includes(to) : false;
  }

  /**
   * Compute the plan's content hash from intent id, policy root and graph critical path.
   * Why: the hash is the cache/dedup identity — identical intent+policy+graph must hash identically.
   * @param intent - parsed intent (only its id is hashed).
   * @param policy - optimized policy (only its root rule id is hashed).
   * @param graph - execution graph (only its critical path is hashed).
   * @returns Hex checksum string.
   * Maps to: internal — ExecutionPlanGenerator.generate.
   */
  private _computeHash(intent: ParsedIntent, policy: OptimizedPolicy, graph: ExecutionGraph): string {
    return checksum(JSON.stringify({ intent: intent.id, policy: policy.root, graph: graph.criticalPath }));
  }

  /**
   * Decide which signatures a plan needs: owner when approval is required, session when a session is attached.
   * Why: the plan must state its signature requirements up front so the executor knows what to collect before sending.
   * @param risk - risk assessment; requiresApproval adds an owner signature.
   * @param intent - parsed intent; a sessionId adds a session signature.
   * @returns Array of { type, address, signed:false } entries; empty when no signature is required. Delegation signatures are never added here.
   * Maps to: contract SessionManager.createSession (session signature) / AgentWallet owner signature.
   */
  private _determineRequiredSignatures(risk: RiskAssessment, intent: ParsedIntent) {
    const sigs: { type: 'owner' | 'session' | 'delegation'; address: string; signed: boolean }[] = [];

    if (risk.requiresApproval) {
      sigs.push({
        type: 'owner',
        address: intent.agent?.walletAddress || '',
        signed: false,
      });
    }

    if (intent.sessionId) {
      sigs.push({
        type: 'session',
        address: intent.agent?.walletAddress || '',
        signed: false,
      });
    }

    return sigs;
  }
}
