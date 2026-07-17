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

  getPlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.get(planId);
  }

  approvePlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.approve(planId);
  }

  rejectPlan(planId: string, reason: string): ExecutionPlan | null {
    return this.planGenerator.reject(planId, reason);
  }

  executePlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.execute(planId);
  }

  completePlan(planId: string, txHash: string): ExecutionPlan | null {
    return this.planGenerator.complete(planId, txHash);
  }

  failPlan(planId: string, error: string): ExecutionPlan | null {
    return this.planGenerator.fail(planId, error);
  }

  archivePlan(planId: string): ExecutionPlan | null {
    return this.planGenerator.archive(planId);
  }

  listPlans(status?: string, limit: number = 50): ExecutionPlan[] {
    const planStore = new PlanStore();
    if (status) {
      return planStore.listByStatus(status as ExecutionPlan['status'], limit);
    }
    return planStore.listRecent(limit);
  }

  pruneCache(): number {
    return this.cache.prune();
  }

  clearCache(): void {
    this.cache.clear();
  }

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
