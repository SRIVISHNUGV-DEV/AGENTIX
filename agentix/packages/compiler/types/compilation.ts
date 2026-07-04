import { ParsedIntent } from './intent';
import { ExecutionPlan } from './execution-plan';

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

export interface CompilerConfig {
  pluginDirs: string[];
  defaultChainId: number;
  simulationEnabled: boolean;
  naturalLanguageEnabled: boolean;
  riskThreshold: number;
  cacheTtl: number;
  maxPolicyRules: number;
}
