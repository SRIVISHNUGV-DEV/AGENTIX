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
  /**
   * Initialize the plugin (optional lifecycle hook, called once after registration).
   * Why: plugins that need async setup (connections, caches) do it here, not in the constructor.
   * @returns Resolves when ready; a rejection means the plugin cannot run and registration should be treated as failed.
   * Maps to: internal — PluginRegistry.register (lifecycle).
   */
  initialize?(): Promise<void>;
  /**
   * Shut the plugin down (optional lifecycle hook, called on unregister/clear).
   * Why: lets plugins release connections and timers instead of leaking them across reloads.
   * @returns Resolves when cleanup is done.
   * Maps to: internal — PluginRegistry.unregister / clear.
   */
  shutdown?(): Promise<void>;
}

export interface CapabilityPlugin extends CompilerPlugin {
  type: 'capability';
  /**
   * Resolve the capabilities an agent holds in an organization.
   * Why: the capability resolver merges every plugin's grants into one graph — this is the plugin's contribution to "what may this agent do".
   * @param agent - acting agent identity and wallet.
   * @param org - organization context (id, active flag).
   * @returns Promise of the granted capabilities (id, action hash/name, grantor, constraints, expiry). An empty list means "no grants from this plugin".
   * @throws Plugin failures are caught by the resolver and skipped — a throwing plugin only loses its own grants.
   * Maps to: contract CredentialRegistry / CapabilityRegistry (on-chain grants mirrored locally).
   */
  resolveCapabilities(agent: { identityId: number; walletAddress: string }, org: { id: string; active: boolean }): Promise<{
    capabilities: { capabilityId: string; actionHash: string; action: string; grantor: string; constraints: Record<string, unknown>; expiresAt: number }[];
  }>;
}

export interface ProtocolPlugin extends CompilerPlugin {
  type: 'protocol';
  protocolId: string;
  /**
   * Encode one execution step into calldata for this protocol.
   * Why: protocol plugins own the wire format — the executor asks the protocol, not the core, how a step is serialized.
   * @param step - function name plus raw args.
   * @returns Encoded calldata hex string.
   * Maps to: internal — execution node call data.
   */
  encodeStep(step: { function: string; args: unknown[] }): string;
  /**
   * Decode a transaction receipt into a structured record for this protocol.
   * Why: completion reporting needs protocol-specific fields (events, status) that a raw receipt does not expose uniformly.
   * @param receipt - raw receipt as returned by the provider.
   * @returns Decoded fields as a plain record.
   * Maps to: internal — ExecutionPlanGenerator.complete (tx receipt handling).
   */
  decodeReceipt(receipt: unknown): Record<string, unknown>;
}

export interface ChainPlugin extends CompilerPlugin {
  type: 'chain';
  chainId: number;
  /**
   * Return this chain's contract addresses by contract name.
   * Why: contract resolution consults chain plugins for deployment-specific addresses instead of hard-coding them.
   * @returns Map of contract name → deployed address.
   * Maps to: contract address book for the chain (see ContractResolver).
   */
  getContractAddresses(): Record<string, string>;
  /**
   * Return this chain's gas configuration.
   * Why: fee defaults differ per chain — the executor reads them from the chain plugin rather than assuming mainnet values.
   * @returns Max fee and max priority fee, both as decimal wei strings.
   * Maps to: internal — execution gas estimation.
   */
  getGasConfig(): { maxFeePerGas: string; maxPriorityFeePerGas: string };
  /**
   * Return how many confirmations this chain requires before a transaction counts as final.
   * Why: finality depth is chain-specific — completion should not be declared after 1 block on a chain that reorgs deeper.
   * @returns Confirmation block count (non-negative integer).
   * Maps to: internal — ExecutionPlanGenerator.complete (finality gate).
   */
  getConfirmationBlocks(): number;
}

export interface IntentTypePlugin extends CompilerPlugin {
  type: 'intent-type';
  intentAction: string;
  /**
   * Parse raw arguments into a structured intent for this intent type.
   * Why: intent-type plugins extend what the parser understands — each new action shape plugs in here.
   * @param args - raw argument bag.
   * @returns Parsed intent params as a plain record.
   * Maps to: internal — IntentParser.parse (stage 1 extension point).
   */
  parse(args: Record<string, unknown>): Record<string, unknown>;
  /**
   * Return the zod schema validating this intent type's params.
   * Why: stage-2 validation is schema-driven — a new intent type is only valid once its schema exists here.
   * @returns The zod schema for this intent type's params.
   * Maps to: internal — validateIntent (stage-2 schema lookup).
   */
  getSchema(): ZodSchema;
}

export interface PolicyRulePlugin extends CompilerPlugin {
  type: 'policy-rule';
  /**
   * Generate policy rules for an intent.
   * Why: policy-rule plugins extend the rule set beyond the built-in defaults — the generator merges their rules (capped by maxPolicyRules) with the core ones.
   * @param intent - parsed intent as a plain record.
   * @param context - compilation context (wallet, session, org).
   * @returns Promise of generated rules (id, type, source, precedence, optional limit/constraint). An empty list means "no rules from this plugin".
   * @throws Plugin failures are caught by the generator and skipped.
   * Maps to: policy rule spend-cap (plugin-contributed limits).
   */
  generateRules(intent: Record<string, unknown>, context: Record<string, unknown>): Promise<{
    rules: { id: string; type: string; source: string; precedence: number; limit?: Record<string, unknown>; constraint?: Record<string, unknown> }[];
  }>;
}

export interface RiskRulePlugin extends CompilerPlugin {
  type: 'risk-rule';
  /**
   * Assess extra risk factors for an intent.
   * Why: risk-rule plugins extend the risk model — their factors become ordinary 'policy'-dimension signals in the engine.
   * @param intent - parsed intent as a plain record.
   * @param context - assessment context (targets, valueWei, notionalUsd).
   * @returns Promise of factors (name, weight, score 0–100, reason); scores are clamped by the engine.
   * @throws Plugin failures are caught by the engine and skipped.
   * Maps to: internal — RiskEngineCore.runPlugins.
   */
  assessRisk(intent: Record<string, unknown>, context: Record<string, unknown>): Promise<{
    factors: { name: string; weight: number; score: number; reason: string }[];
  }>;
}

export interface SimulationRulePlugin extends CompilerPlugin {
  type: 'simulation-rule';
  /**
   * Return the pre/post-step simulation hooks for this plugin.
   * Why: simulation-rule plugins observe or adjust each simulated step — hooks are the only extension point the simulator offers.
   * @returns Hooks object; preStep runs before a node's eth_call, postStep after it (both receive plain records and may return modified ones).
   * Maps to: internal — Simulator.simulate / _simulateNode.
   */
  getSimulationHooks(): {
    preStep?: (step: Record<string, unknown>) => Promise<Record<string, unknown>>;
    postStep?: (step: Record<string, unknown>, result: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}
