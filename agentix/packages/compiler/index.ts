import { PipelineOrchestrator } from './pipeline';
import { PluginRegistry } from './plugins/registry';
import { CompilerConfig } from './types/compilation';
import { StructuredIntent, ParsedIntent, IntentIR } from './types/intent';
import { ExecutionPlan } from './types/execution-plan';
import { CompilationResult, CompilerContext } from './types/compilation';
import { loadCompilerConfig } from './storage/toml-config';
import { COMPILER_SCHEMA } from './storage/schema';

let _instance: Compiler | null = null;

export class Compiler {
  public readonly pipeline: PipelineOrchestrator;
  public readonly plugins: PluginRegistry;

  /**
   * Build a Compiler with a fresh plugin registry and pipeline.
   * Why: the Compiler is the public entry point — SDK/CLI/MCP callers construct it
   * once and reuse it for every compile; config defaults come from compiler.toml.
   * @param config - optional overrides; when omitted, loadCompilerConfig() reads ~/.agentix/compiler/compiler.toml.
   * Maps to: internal — Compiler.getInstance (singleton accessor).
   */
  constructor(config?: CompilerConfig) {
    this.plugins = new PluginRegistry();
    this.pipeline = new PipelineOrchestrator(this.plugins, config || loadCompilerConfig());
  }

  /**
   * Run an intent through the full 10-stage pipeline and return the execution plan.
   * Why: this is the single compile entry point — parse, validate, resolve, policy,
   * simulate, risk, explain, plan — so callers never invoke stages individually.
   * @param input - structured intent or free text (free text needs naturalLanguageEnabled).
   * @param context - optional caller context (wallet, session, org); feeds cache key and validation.
   * @param contractAddresses - optional per-contract address overrides; anchor actions ignore these.
   * @returns CompilationResult with the plan plus warnings/errors; on parse/validation failure the plan is an empty REJECTED plan, never a throw.
   * @throws Never for bad input (errors are returned); only unexpected internal failures propagate.
   * Maps to: contract SessionManager.createSession et al. via the resolved execution nodes.
   */
  async compile(
    input: StructuredIntent | string,
    context?: CompilerContext,
    contractAddresses?: Record<string, string>
  ): Promise<CompilationResult> {
    return this.pipeline.compile(input, context, contractAddresses);
  }

  /**
   * Compile from an already-classified action plus params, without a full intent object.
   * Why: the convenience path for SDK/MCP callers that classified the intent themselves.
   * @param action - canonical or aliased action name; normalized by stage 1.
   * @param params - raw action parameters (addresses, values in wei strings, expiry unix seconds).
   * @param source - where the intent came from; defaults to 'sdk'.
   * @returns Same CompilationResult contract as compile().
   * Maps to: MCP tool agentix_compile_intent.
   */
  compileIntent(
    action: string,
    params: Record<string, unknown>,
    source: IntentIR['source'] = 'sdk',
    context?: CompilerContext,
    contractAddresses?: Record<string, string>
  ): Promise<CompilationResult> {
    return this.pipeline.compileIntent(action, params, source, context, contractAddresses);
  }

  /**
   * Fetch a stored execution plan by id.
   * Why: plans are the approval artifact — the dashboard/CLI reads one back before asking an owner to sign.
   * @param planId - plan id returned by compile().
   * @returns The plan, or null when no plan with that id exists.
   * Maps to: internal — ExecutionPlanGenerator.get.
   */
  getPlan(planId: string): ExecutionPlan | null {
    return this.pipeline.getPlan(planId);
  }

  /**
   * Move a plan to APPROVED so it may be executed.
   * Why: approval is the human gate — high-risk plans start APPROVAL_REQUIRED and nothing executes until this runs.
   * @param planId - plan id.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — ExecutionPlanGenerator.approve.
   */
  approvePlan(planId: string): ExecutionPlan | null {
    return this.pipeline.approvePlan(planId);
  }

  /**
   * Reject a plan with a recorded reason.
   * Why: rejections are auditable — the reason is persisted with the plan instead of vanishing.
   * @param planId - plan id.
   * @param reason - human-readable rejection reason, stored on the plan.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — ExecutionPlanGenerator.reject.
   */
  rejectPlan(planId: string, reason: string): ExecutionPlan | null {
    return this.pipeline.rejectPlan(planId, reason);
  }

  /**
   * Mark a plan EXECUTING (records the execution start, does not itself send a transaction).
   * Why: separates the lifecycle bookkeeping from the actual on-chain execution done by the runtime.
   * @param planId - plan id; must be APPROVED.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — ExecutionPlanGenerator.execute.
   */
  executePlan(planId: string): ExecutionPlan | null {
    return this.pipeline.executePlan(planId);
  }

  /**
   * Mark a plan COMPLETED with the on-chain transaction hash.
   * Why: the tx hash is the proof the plan actually executed; without it a plan can never reach COMPLETED.
   * @param planId - plan id; must be EXECUTING.
   * @param txHash - transaction hash of the executed call.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — ExecutionPlanGenerator.complete.
   */
  completePlan(planId: string, txHash: string): ExecutionPlan | null {
    return this.pipeline.completePlan(planId, txHash);
  }

  /**
   * Mark a plan FAILED with the failure reason.
   * Why: failed plans stay visible for retry/audit instead of disappearing, and the error is persisted.
   * @param planId - plan id.
   * @param error - failure reason, stored as the plan's rejection reason.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids the transition.
   * Maps to: internal — ExecutionPlanGenerator.fail.
   */
  failPlan(planId: string, error: string): ExecutionPlan | null {
    return this.pipeline.failPlan(planId, error);
  }

  /**
   * Archive a completed plan.
   * Why: only COMPLETED plans archive — archiving is the terminal state and keeps the history queryable.
   * @param planId - plan id; must be COMPLETED, otherwise returned unchanged.
   * @returns The updated plan, null when unknown, or the unchanged plan when not COMPLETED.
   * Maps to: internal — ExecutionPlanGenerator.archive.
   */
  archivePlan(planId: string): ExecutionPlan | null {
    return this.pipeline.archivePlan(planId);
  }

  /**
   * List stored plans, newest first, optionally filtered by status.
   * Why: the dashboard/CLI history view reads through here; a fresh PlanStore is used per call.
   * @param status - optional plan status filter; an unknown status yields an empty list, not an error.
   * @param limit - max rows; the store defaults to 50 when omitted.
   * @returns Plans newest first; empty array when none match.
   * Maps to: internal — PlanStore.listByStatus / listRecent.
   */
  listPlans(status?: string, limit?: number): ExecutionPlan[] {
    return this.pipeline.listPlans(status, limit);
  }

  /**
   * Delete expired compilation-cache rows.
   * Why: cached plans go stale as chain state moves; pruning bounds the cache table.
   * @returns Number of rows deleted (0 when nothing was expired).
   * Maps to: internal — CompilationCacheStore.prune.
   */
  pruneCache(): number {
    return this.pipeline.pruneCache();
  }

  /**
   * Delete every compilation-cache row.
   * Why: the escape hatch when cached plans are suspected stale — e.g. after a config or contract change.
   * Side effects: wipes the whole compilation_cache table; plans in execution_plans are untouched.
   * Maps to: internal — CompilationCacheStore.clear.
   */
  clearCache(): void {
    this.pipeline.clearCache();
  }

  /**
   * Return the process-wide Compiler singleton, creating it on first call.
   * Why: the pipeline holds stores and registries that must not be duplicated per call.
   * @param config - only honoured on the first call; later calls ignore it (call resetInstance() first to reconfigure).
   * @returns The shared Compiler instance.
   * Maps to: internal — Compiler constructor.
   */
  static getInstance(config?: CompilerConfig): Compiler {
    if (!_instance) {
      _instance = new Compiler(config);
    }
    return _instance;
  }

  /**
   * Drop the process-wide Compiler singleton.
   * Why: tests and reconfiguration need a clean slate; production code never calls this mid-flight.
   * Side effects: the next getInstance() builds a new Compiler (new registry, pipeline, stores).
   * Maps to: internal — Compiler.getInstance.
   */
  static resetInstance(): void {
    _instance = null;
  }
}

/**
 * Return the shared Compiler instance (module-level shorthand for getInstance).
 * Why: most callers just need the singleton and should not touch the class.
 * @param config - only honoured on first creation; ignored afterwards.
 * @returns The shared Compiler instance.
 * Maps to: internal — Compiler.getInstance.
 */
export function getCompiler(config?: CompilerConfig): Compiler {
  return Compiler.getInstance(config);
}

export { COMPILER_SCHEMA } from './storage/schema';
export * from './types';
export { buildClassificationPrompt, getStructuredIntentSchema, validateExtractedParams, getActionSpec, ACTION_CATALOG } from './pipeline/nl-intent-parser';
