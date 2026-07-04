export interface PolicyRule {
  id: string;
  type: 'limit' | 'constraint' | 'requirement' | 'delegation';
  source: string;
  precedence: number;
  limit?: {
    field: 'value' | 'gas' | 'time' | 'count' | 'target';
    operator: 'lte' | 'gte' | 'eq' | 'in' | 'not_in';
    value: unknown;
  };
  constraint?: {
    mustHave: string[];
    mustNotHave: string[];
    mustDelegate: boolean;
  };
  requirement?: {
    credentialVersion: number;
    requiredPermissions: number;
    zkProofRequired: boolean;
  };
}

export interface PolicyEdge {
  from: string;
  to: string;
  relationship: 'implies' | 'conflicts' | 'overrides';
}

export interface EffectiveLimits {
  maxValue: string;
  maxGas: string;
  expiry: number;
  allowedTargets: string[];
  maxBatchSize: number;
}

export interface PolicyConflict {
  ruleA: string;
  ruleB: string;
  reason: string;
  resolution: 'keep_a' | 'keep_b' | 'merge';
}

export interface PolicyGraph {
  rules: PolicyRule[];
  edges: PolicyEdge[];
  root: string;
  effectiveLimits: EffectiveLimits;
  conflicts: PolicyConflict[];
}

export type OptimizedPolicy = PolicyGraph;
