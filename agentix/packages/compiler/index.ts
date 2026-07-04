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

  constructor(config?: CompilerConfig) {
    this.plugins = new PluginRegistry();
    this.pipeline = new PipelineOrchestrator(this.plugins, config || loadCompilerConfig());
  }

  async compile(
    input: StructuredIntent | string,
    context?: CompilerContext,
    contractAddresses?: Record<string, string>
  ): Promise<CompilationResult> {
    return this.pipeline.compile(input, context, contractAddresses);
  }

  compileIntent(
    action: string,
    params: Record<string, unknown>,
    source: IntentIR['source'] = 'sdk',
    context?: CompilerContext,
    contractAddresses?: Record<string, string>
  ): Promise<CompilationResult> {
    return this.pipeline.compileIntent(action, params, source, context, contractAddresses);
  }

  getPlan(planId: string): ExecutionPlan | null {
    return this.pipeline.getPlan(planId);
  }

  approvePlan(planId: string): ExecutionPlan | null {
    return this.pipeline.approvePlan(planId);
  }

  rejectPlan(planId: string, reason: string): ExecutionPlan | null {
    return this.pipeline.rejectPlan(planId, reason);
  }

  executePlan(planId: string): ExecutionPlan | null {
    return this.pipeline.executePlan(planId);
  }

  completePlan(planId: string, txHash: string): ExecutionPlan | null {
    return this.pipeline.completePlan(planId, txHash);
  }

  failPlan(planId: string, error: string): ExecutionPlan | null {
    return this.pipeline.failPlan(planId, error);
  }

  archivePlan(planId: string): ExecutionPlan | null {
    return this.pipeline.archivePlan(planId);
  }

  listPlans(status?: string, limit?: number): ExecutionPlan[] {
    return this.pipeline.listPlans(status, limit);
  }

  pruneCache(): number {
    return this.pipeline.pruneCache();
  }

  clearCache(): void {
    this.pipeline.clearCache();
  }

  static getInstance(config?: CompilerConfig): Compiler {
    if (!_instance) {
      _instance = new Compiler(config);
    }
    return _instance;
  }

  static resetInstance(): void {
    _instance = null;
  }
}

export function getCompiler(config?: CompilerConfig): Compiler {
  return Compiler.getInstance(config);
}

export { COMPILER_SCHEMA } from './storage/schema';
export * from './types';
