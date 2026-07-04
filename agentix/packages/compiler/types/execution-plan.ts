import { ParsedIntent } from './intent';
import { OptimizedPolicy } from './policy';
import { ResolvedCapabilities } from './capability';
import { RiskAssessment } from './risk';
import { SimulationResult } from './simulation';

export type PlanStatus = 'DRAFT' | 'COMPILED' | 'SIMULATED' | 'APPROVAL_REQUIRED' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'ARCHIVED';

export const PLAN_LIFECYCLE: { from: PlanStatus; to: PlanStatus[] }[] = [
  { from: 'DRAFT', to: ['COMPILED'] },
  { from: 'COMPILED', to: ['SIMULATED', 'REJECTED'] },
  { from: 'SIMULATED', to: ['APPROVAL_REQUIRED', 'APPROVED', 'REJECTED'] },
  { from: 'APPROVAL_REQUIRED', to: ['APPROVED', 'REJECTED'] },
  { from: 'APPROVED', to: ['EXECUTING', 'REJECTED'] },
  { from: 'EXECUTING', to: ['COMPLETED', 'FAILED'] },
  { from: 'FAILED', to: ['APPROVED', 'REJECTED'] },
  { from: 'COMPLETED', to: ['ARCHIVED'] },
  { from: 'REJECTED', to: [] },
  { from: 'ARCHIVED', to: [] },
];

export interface ExecutionNode {
  id: string;
  type: 'contract_call' | 'wait_confirmation' | 'read_event' | 'db_write' | 'merkle_update' | 'signature_request' | 'conditional';
  call?: {
    contractName: string;
    address: string;
    function: string;
    args: unknown[];
    value: string;
    gasLimit: string;
  };
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
  timeout?: number;
  rollbackNodeIds: string[];
  dependsOn: string[];
  allowsParallel: boolean;
  condition?: {
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt';
    value: unknown;
    onTrue: string;
    onFalse: string;
  };
}

export interface ExecutionEdge {
  from: string;
  to: string;
  type: 'depends_on' | 'rollback' | 'conditional_true' | 'conditional_false';
}

export interface ExecutionGraph {
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  entryPoints: string[];
  exitPoints: string[];
  criticalPath: string[];
  parallelBatches: string[][];
}

export interface RequiredSignature {
  type: 'owner' | 'session' | 'delegation';
  address: string;
  signed: boolean;
  signature?: string;
}

export interface ExecutionPlan {
  planId: string;
  contentHash: string;
  version: 1;
  intent: ParsedIntent;
  capabilityGraph: ResolvedCapabilities;
  policyGraph: OptimizedPolicy;
  executionGraph: ExecutionGraph;
  simulation: SimulationResult;
  risk: RiskAssessment;
  explanation: string;
  requiredSignatures: RequiredSignature[];
  status: PlanStatus;
  createdAt: number;
  expiresAt: number;
  executedAt?: number;
  completedAt?: number;
  txHash?: string;
  rejectionReason?: string;
}
