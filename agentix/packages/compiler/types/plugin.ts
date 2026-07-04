import { ZodSchema } from 'zod';

export type PluginType = 'capability' | 'protocol' | 'chain' | 'intent-type' | 'policy-rule' | 'risk-rule' | 'simulation-rule';
export type PipelineStage =
  | 'intent-parser'
  | 'validator'
  | 'capability-resolver'
  | 'policy-generator'
  | 'policy-optimizer'
  | 'contract-resolver'
  | 'simulator'
  | 'risk-engine'
  | 'explanation-generator'
  | 'plan-generator';

export interface PluginManifest {
  name: string;
  version: string;
  type: PluginType;
  description: string;
  hooks: {
    pipeline_stages: PipelineStage[];
  };
}

export interface CompilerPlugin {
  name: string;
  version: string;
  type: PluginType;
  description: string;
  hooks: PipelineStage[];
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface CapabilityPlugin extends CompilerPlugin {
  type: 'capability';
  resolveCapabilities(agent: { identityId: number; walletAddress: string }, org: { id: string; active: boolean }): Promise<{
    capabilities: { capabilityId: string; actionHash: string; action: string; grantor: string; constraints: Record<string, unknown>; expiresAt: number }[];
  }>;
}

export interface ProtocolPlugin extends CompilerPlugin {
  type: 'protocol';
  protocolId: string;
  encodeStep(step: { function: string; args: unknown[] }): string;
  decodeReceipt(receipt: unknown): Record<string, unknown>;
}

export interface ChainPlugin extends CompilerPlugin {
  type: 'chain';
  chainId: number;
  getContractAddresses(): Record<string, string>;
  getGasConfig(): { maxFeePerGas: string; maxPriorityFeePerGas: string };
  getConfirmationBlocks(): number;
}

export interface IntentTypePlugin extends CompilerPlugin {
  type: 'intent-type';
  intentAction: string;
  parse(args: Record<string, unknown>): Record<string, unknown>;
  getSchema(): ZodSchema;
}

export interface PolicyRulePlugin extends CompilerPlugin {
  type: 'policy-rule';
  generateRules(intent: Record<string, unknown>, context: Record<string, unknown>): Promise<{
    rules: { id: string; type: string; source: string; precedence: number; limit?: Record<string, unknown>; constraint?: Record<string, unknown> }[];
  }>;
}

export interface RiskRulePlugin extends CompilerPlugin {
  type: 'risk-rule';
  assessRisk(intent: Record<string, unknown>, context: Record<string, unknown>): Promise<{
    factors: { name: string; weight: number; score: number; reason: string }[];
  }>;
}

export interface SimulationRulePlugin extends CompilerPlugin {
  type: 'simulation-rule';
  getSimulationHooks(): {
    preStep?: (step: Record<string, unknown>) => Promise<Record<string, unknown>>;
    postStep?: (step: Record<string, unknown>, result: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}
