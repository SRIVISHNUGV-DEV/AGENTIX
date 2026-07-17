import { ParsedIntent } from './intent';
import { ExecutionPlan } from './execution-plan';
import type { RiskDimension } from './risk';

export interface CompilerContext {
  agentIdentityId?: number;
  walletAddress?: string;
  organizationId?: string;
  sessionId?: string;
  sessionKey?: string;
}

export interface CompilationResult {
  plan: ExecutionPlan;
  warnings: string[];
  errors: string[];
  cacheHit: boolean;
  durationMs: number;
}

export interface CompilationCacheEntry {
  contentHash: string;
  intentJson: string;
  planJson: string;
  createdAt: number;
  ttl: number;
}

export interface RiskEngineConfig {
  /** Aggregate score at/above which a plan requires approval. */
  approvalThreshold: number;
  /** Aggregate score at/above which a plan is denied outright. */
  denyThreshold: number;
  /** Per-dimension weights (partial overrides of the defaults). */
  weights: Partial<Record<RiskDimension, number>>;
  /** Enable behavioral history lookups (velocity/anomaly) against the local DB. */
  behavioralEnabled: boolean;
  /** Enable USD notional enrichment via the price oracle. */
  notionalEnabled: boolean;
  /** Extra addresses the operator explicitly trusts (lowercased). */
  trustedAddresses: string[];
  /** Addresses that must be denied (sanctions / blocklist, lowercased). */
  blockedAddresses: string[];
}

export interface CompilerConfig {
  pluginDirs: string[];
  defaultChainId: number;
  simulationEnabled: boolean;
  naturalLanguageEnabled: boolean;
  riskThreshold: number;
  cacheTtl: number;
  maxPolicyRules: number;
  /** Optional risk-engine tuning. When absent the engine uses safe defaults. */
  risk?: RiskEngineConfig;
}
