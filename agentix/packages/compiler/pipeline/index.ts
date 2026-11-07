import { ParsedIntent, StructuredIntent, IntentIR } from '../types/intent';
import { ExecutionPlan } from '../types/execution-plan';
import { CompilationResult, CompilerContext, CompilerConfig } from '../types/compilation';
import { IntentParser } from './stage-1-intent-parser';
import { IntentValidator } from './stage-2-validator';
import { CapabilityResolver } from './stage-3-capability-resolver';
import { PolicyGenerator } from './stage-4-policy-generator';
import { PolicyOptimizer } from './stage-5-policy-optimizer';
import { ContractResolver } from './stage-6-contract-resolver';
import { Simulator } from './stage-7-simulator';
import { RiskEngine } from './stage-8-risk-engine';
import { ExplanationGenerator } from './stage-9-explanation-generator';
import { ExecutionPlanGenerator } from './stage-10-plan-generator';
import { PluginRegistry } from '../plugins/registry';
import { CompilationCacheStore } from '../storage/compilation-cache';
import { PlanStore } from '../storage/plan-store';
import { loadCompilerConfig } from '../storage/toml-config';
import { checksum } from '@agentix/utils';

export class PipelineOrchestrator {
  public readonly parser: IntentParser;
  public readonly validator: IntentValidator;
  public readonly capabilityResolver: CapabilityResolver;
  public readonly policyGenerator: PolicyGenerator;
  public readonly policyOptimizer: PolicyOptimizer;
  public readonly contractResolver: ContractResolver;
  public readonly simulator: Simulator;
  public readonly riskEngine: RiskEngine;
  public readonly explanationGenerator: ExplanationGenerator;
  public readonly planGenerator: ExecutionPlanGenerator;

  private cache: CompilationCacheStore;

    /**
     * Wire the 10 pipeline stages and their stores from one registry and config.
     * Why: the orchestrator owns stage construction so stages never construct each other.
     * @param plugins - registry consulted by capability/policy/simulation/risk stages; empty registry means no plugins run.
     * @param config - compiler config; defaults to compiler.toml via loadCompilerConfig().
     * Maps to: internal — Compiler constructor.
     */
  constructor(
    public readonly plugins: PluginRegistry,
    public readonly config: CompilerConfig = loadCompilerConfig()
  ) {
    this.cache = new CompilationCacheStore();
    const planStore = new PlanStore();

    this.parser = new IntentParser(config);
    this.validator = new IntentValidator();
    this.capabilityResolver = new CapabilityResolver(plugins);
    this.policyGenerator = new PolicyGenerator(plugins, config);
    this.policyOptimizer = new PolicyOptimizer();
    this.contractResolver = new ContractResolver();
    this.simulator = new Simulator(plugins, config);
    this.riskEngine = new RiskEngine(plugins, config);
    this.explanationGenerator = new ExplanationGenerator();
    this.planGenerator = new ExecutionPlanGenerator(planStore);
  }

    /**
     * Run the full 10-stage compile: parse → validate → capabilities → policy →
     * optimize → contracts → simulate → risk → explain → plan, with a content-hash cache.
     * Why: this is the one place the stage order lives — simulation runs before risk
     * because the risk engine consumes the dry-run outcome; caching sits after parse
     * so identical intents skip the whole pipeline.
     * @param input - structured intent or free text (free text needs naturalLanguageEnabled).
     * @param context - optional wallet/session/org context; part of the cache key.
     * @param contractAddresses - optional address overrides; anchor actions ignore these.
     * @returns CompilationResult; on parse/validation/contract errors the plan is an empty REJECTED plan with errors listed — never a throw. Simulation failures are warnings, not errors.
     * @throws Only on unexpected internal failures; stage failures are returned as errors/warnings.
     * Side effects: writes the successful plan to the compilation cache and the plan store.
     * Maps to: contract SessionManager.createSession et al. via the resolved execution nodes.
     */
  async compile(
    input: StructuredIntent | string,
    context?: CompilerContext,
    contractAddresses?: Record<string, string>
  ): Promise<CompilationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const startTime = Date.now();

    // Stage 1: Parse
    const intent = this.parser.parse(input);
    if (intent.validationErrors.length > 0) {
      errors.push(...intent.validationErrors);
      return {
        plan: this._emptyPlan(intent),
        warnings,
        errors,
        cacheHit: false,
        durationMs: Date.now() - startTime,
      };
    }

    // Check cache
    const contentHash = checksum(JSON.stringify({
      action: intent.normalizedAction,
      params: intent.params,
      walletAddress: context?.walletAddress || '',
      sessionId: context?.sessionId || '',
      organizationId: context?.organizationId || '',
      contractAddresses: contractAddresses || {},
    }));
    const cached = this.cache.get(contentHash);
    if (cached) {
      try {
        const plan = JSON.parse(cached.planJson);
        return {
          plan,
          warnings: ['Returned from cache'],
          errors: [],
          cacheHit: true,
          durationMs: Date.now() - startTime,
        };
      } catch {
        this.cache.invalidate(contentHash);
      }
    }

    // Stage 2: Validate
    const validationResult = this.validator.validate(intent, {
      walletAddress: context?.walletAddress,
      sessionId: context?.sessionId,
    });
    if (!validationResult.valid) {
      errors.push(...validationResult.errors);
      return {
        plan: this._emptyPlan(intent),
        warnings,
        errors,
        cacheHit: false,
        durationMs: Date.now() - startTime,
      };
    }
    warnings.push(...validationResult.warnings);

    // Stage 3: Resolve Capabilities
    const capabilities = await this.capabilityResolver.resolve(intent);
    if (!capabilities.canExecute) {
      warnings.push(`Missing capabilities: ${capabilities.missingExplicit.join(', ')}`);
    }

    // Stage 4: Generate Policies
    const policyGraph = await this.policyGenerator.generate(intent);

    // Stage 5: Optimize Policies
    const optimizedPolicy = this.policyOptimizer.optimize(policyGraph);

    // Stage 6: Resolve Contracts
    const contractResolution = this.contractResolver.resolveExecutionNodes(intent, contractAddresses);
    if (contractResolution.errors.length > 0) {
      errors.push(...contractResolution.errors);
      return {
        plan: this._emptyPlan(intent),
        warnings,
        errors,
        cacheHit: false,
        durationMs: Date.now() - startTime,
      };
    }

    // Build execution graph
    const executionGraph = {
      nodes: contractResolution.nodes,
      edges: [],
      entryPoints: contractResolution.nodes.length > 0 ? [contractResolution.nodes[0].id] : [],
      exitPoints: contractResolution.nodes.length > 0
        ? [contractResolution.nodes[contractResolution.nodes.length - 1].id]
        : [],
      criticalPath: contractResolution.nodes.map((n) => n.id),
      parallelBatches: [contractResolution.nodes.map((n) => n.id)],
    };

    // Stage 7: Simulate first so the risk engine can consume the dry-run outcome
    // (revert prediction, gas anomaly). Simulation is independent of policy so it
    // could run in parallel, but risk depends on it — sequence sim → risk.
    const simulation = await this.simulator.simulate(intent, executionGraph, contractAddresses);

    warnings.push(...simulation.warnings);
    if (simulation.errors.length > 0) {
      warnings.push(`Simulation warnings: ${simulation.errors.join('; ')}`);
    }

    // Stage 8: Risk assessment — now policy- and simulation-aware.
    const risk = await this.riskEngine.assess(intent, capabilities, optimizedPolicy, simulation);

    warnings.push(...risk.warnings.map((w) => w.message));

    // Stage 9: Generate Explanation
    const explanation = this.explanationGenerator.generate(intent, risk, capabilities, optimizedPolicy);

    // Stage 10: Generate Execution Plan
    const plan = this.planGenerator.generate(
      intent,
      capabilities,
      optimizedPolicy,
      executionGraph,
      simulation,
      risk,
      explanation
    );

    // Cache result
    this.cache.set(contentHash, JSON.stringify(intent), JSON.stringify(plan), this.config.cacheTtl);

    return {
      plan,
      warnings,
      errors,
      cacheHit: false,
      durationMs: Date.now() - startTime,
    };
  }

    /**
     * Compile from a classified action plus params (structured-intent shorthand).
     * Why: SDK/MCP callers that already classified the intent skip building a StructuredIntent.
     * @param action - canonical or aliased action name.
     * @param params - raw action parameters.
     * @param source - intent source; defaults to 'sdk'.
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
    return this.compile(
      { action, params, source },
      context,
      contractAddresses
    );
  }

  /**
   * Fetch a stored execution plan by id.
   * Why: approval flows read the plan back before signing.
   * @param planId - plan id.
   * @returns The plan, or null when unknown.
   * Maps to: internal — ExecutionPlanGenerator.get.
   */
  getPlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.get(planId);
  }

  /**
   * Move a plan to APPROVED.
   * Why: the human gate for APPROVAL_REQUIRED plans.
   * @param planId - plan id.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids it.
   * Maps to: internal — ExecutionPlanGenerator.approve.
   */
  approvePlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.approve(planId);
  }

  /**
   * Reject a plan with a recorded reason.
   * Why: rejections are persisted for audit, not dropped.
   * @param planId - plan id.
   * @param reason - rejection reason stored on the plan.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids it.
   * Maps to: internal — ExecutionPlanGenerator.reject.
   */
  rejectPlan(planId: string, reason: string): ExecutionPlan | null {
    return this.planGenerator.reject(planId, reason);
  }

  /**
   * Mark a plan EXECUTING (lifecycle bookkeeping only; does not send a transaction).
   * Why: separates plan state from on-chain execution.
   * @param planId - plan id; must be APPROVED.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids it.
   * Maps to: internal — ExecutionPlanGenerator.execute.
   */
  executePlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.execute(planId);
  }

  /**
   * Mark a plan COMPLETED with its transaction hash.
   * Why: the tx hash is the execution proof; a plan cannot complete without one.
   * @param planId - plan id; must be EXECUTING.
   * @param txHash - transaction hash of the executed call.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids it.
   * Maps to: internal — ExecutionPlanGenerator.complete.
   */
  completePlan(planId: string, txHash: string): ExecutionPlan | null {
    return this.planGenerator.complete(planId, txHash);
  }

  /**
   * Mark a plan FAILED with the failure reason.
   * Why: failures stay queryable for retry/audit.
   * @param planId - plan id.
   * @param error - failure reason stored on the plan.
   * @returns The updated plan, null when unknown, or the unchanged plan when the lifecycle forbids it.
   * Maps to: internal — ExecutionPlanGenerator.fail.
   */
  failPlan(planId: string, error: string): ExecutionPlan | null {
    return this.planGenerator.fail(planId, error);
  }

  /**
   * Archive a completed plan.
   * Why: ARCHIVED is terminal; only COMPLETED plans may enter it.
   * @param planId - plan id; must be COMPLETED.
   * @returns The updated plan, null when unknown, or the unchanged plan when not COMPLETED.
   * Maps to: internal — ExecutionPlanGenerator.archive.
   */
  archivePlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.archive(planId);
  }

  /**
   * List stored plans newest first, optionally filtered by status.
   * Why: history views read through here. Note it opens a fresh PlanStore per call.
   * @param status - optional status filter; unknown statuses yield an empty list.
   * @param limit - max rows; defaults to 50.
   * @returns Plans newest first; empty array when none match.
   * Maps to: internal — PlanStore.listByStatus / listRecent.
   */
  listPlans(status?: string, limit: number = 50): ExecutionPlan[] {
    const planStore = new PlanStore();
    if (status) {
      return planStore.listByStatus(status as ExecutionPlan['status'], limit);
    }
    return planStore.listRecent(limit);
  }

  /**
   * Delete expired compilation-cache rows.
   * Why: bounds the cache table as chain state moves on.
   * @returns Number of rows deleted (0 when nothing expired).
   * Maps to: internal — CompilationCacheStore.prune.
   */
  pruneCache(): number {
    return this.cache.prune();
  }

  /**
   * Delete every compilation-cache row.
   * Why: escape hatch for stale caches after config/contract changes.
   * Side effects: wipes compilation_cache; execution_plans untouched.
   * Maps to: internal — CompilationCacheStore.clear.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Build the REJECTED placeholder plan returned when compilation fails early.
   * Why: callers always get a well-formed plan object — even on failure — so
   * downstream code never null-checks the plan itself.
   * @param intent - the parsed (possibly errored) intent to embed.
   * @returns A REJECTED plan with empty graphs, risk score 100, and the intent's validation errors as the simulation errors.
   * Maps to: internal — PipelineOrchestrator.compile (early-return paths).
   */
  private _emptyPlan(intent: ParsedIntent): ExecutionPlan {
    return {
      planId: intent.id,
      contentHash: '',
      version: 1,
      intent,
      capabilityGraph: {
        agent: { identityId: 0, walletAddress: '' },
        organization: { id: '', active: false },
        capabilities: [],
        delegations: [],
        credentials: [],
        grantedActions: [],
        restrictedActions: [],
        missingActions: [],
        canExecute: false,
        missingExplicit: [],
        mustDelegate: [],
      },
      policyGraph: {
        rules: [],
        edges: [],
        root: '',
        effectiveLimits: { maxValue: '0', maxGas: '0', expiry: 0, allowedTargets: [], maxBatchSize: 20 },
        conflicts: [],
      },
      executionGraph: {
        nodes: [],
        edges: [],
        entryPoints: [],
        exitPoints: [],
        criticalPath: [],
        parallelBatches: [],
      },
      simulation: { success: false, steps: [], warnings: [], errors: intent.validationErrors },
      risk: { score: 100, category: 'AUTHORITY', factors: [], warnings: [], suggestions: [], requiresApproval: true },
      explanation: intent.validationErrors.join('; '),
      requiredSignatures: [],
      status: 'REJECTED',
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000),
    };
  }
}
