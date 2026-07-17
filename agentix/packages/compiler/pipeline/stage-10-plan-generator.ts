import { ParsedIntent } from '../types/intent';
import { ExecutionPlan, ExecutionGraph, PLAN_LIFECYCLE, PlanStatus } from '../types/execution-plan';
import { ResolvedCapabilities } from '../types/capability';
import { OptimizedPolicy } from '../types/policy';
import { RiskAssessment } from '../types/risk';
import { SimulationResult } from '../types/simulation';
import { generateId, checksum } from '@agentix/utils';
import { PlanStore } from '../storage/plan-store';

export class ExecutionPlanGenerator {
  constructor(private planStore: PlanStore) {}

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

  get(planId: string): ExecutionPlan | null {
    return this.planStore.get(planId);
  }

  getByHash(contentHash: string): ExecutionPlan | null {
    return this.planStore.getByHash(contentHash);
  }

  approve(planId: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'APPROVED')) return plan;

    plan.status = 'APPROVED';
    this.planStore.updateStatus(planId, 'APPROVED');
    return plan;
  }

  reject(planId: string, reason: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'REJECTED')) return plan;

    plan.status = 'REJECTED';
    this.planStore.updateStatus(planId, 'REJECTED', { rejectionReason: reason });
    return plan;
  }

  execute(planId: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'EXECUTING')) return plan;

    plan.status = 'EXECUTING';
    plan.executedAt = Math.floor(Date.now() / 1000);
    this.planStore.updateStatus(planId, 'EXECUTING');
    return plan;
  }

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

  fail(planId: string, error: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (!this._canTransition(plan.status, 'FAILED')) return plan;

    plan.status = 'FAILED';
    this.planStore.updateStatus(planId, 'FAILED', { rejectionReason: error });
    return plan;
  }

  archive(planId: string): ExecutionPlan | null {
    const plan = this.planStore.get(planId);
    if (!plan) return null;
    if (plan.status !== 'COMPLETED') return plan;

    plan.status = 'ARCHIVED';
    this.planStore.updateStatus(planId, 'ARCHIVED');
    return plan;
  }

  private _canTransition(from: PlanStatus, to: PlanStatus): boolean {
    const rule = PLAN_LIFECYCLE.find((r) => r.from === from);
    return rule ? rule.to.includes(to) : false;
  }

  private _computeHash(intent: ParsedIntent, policy: OptimizedPolicy, graph: ExecutionGraph): string {
    return checksum(JSON.stringify({ intent: intent.id, policy: policy.root, graph: graph.criticalPath }));
  }

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
