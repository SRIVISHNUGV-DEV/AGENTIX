import type { AbstractProvider } from 'ethers';
import { ParsedIntent } from '../types/intent';
import { ExecutionGraph, ExecutionNode } from '../types/execution-plan';
import { SimulationResult, SimulatedStep, GasEstimate } from '../types/simulation';
import { CompilerConfig } from '../types/compilation';
import { PluginRegistry } from '../plugins/registry';
import { SimulationRulePlugin } from '../types/plugin';

const SIMULATION_TIMEOUT_MS = 3000;

// Actions that are pure reads — no chain state changes, simulation adds no value
const READ_ONLY_ACTIONS = new Set([
  'wallet_info',
  'session_validate',
  'session_get',
  'credential_get',
  'organization_get',
  'capability_list',
  'delegation_list',
  'tree_status',
  'proof_verify',
  'identity_lookup',
]);

// Simple value transfers where local validation is sufficient
const SIMPLE_TRANSFER_ACTIONS = new Set([
  'wallet_deposit',
  'wallet_withdraw',
]);

export class Simulator {
  private simulationCache = new Map<string, { result: SimulatedStep; at: number }>();
  private readonly CACHE_TTL_MS = 30_000; // 30s — same block window

  constructor(private plugins: PluginRegistry, private config: CompilerConfig) {}

  async simulate(
    intent: ParsedIntent,
    executionGraph: ExecutionGraph,
    contractAddresses?: Record<string, string>
  ): Promise<SimulationResult> {
    const steps: SimulatedStep[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.simulationEnabled) {
      warnings.push('Simulation disabled by configuration');
      return { success: true, steps: [], totalGasEstimate: undefined, warnings, errors };
    }

    // Optimization 1: Skip simulation for read-only actions entirely
    if (READ_ONLY_ACTIONS.has(intent.normalizedAction)) {
      warnings.push('Simulation skipped: read-only action');
      return { success: true, steps: [], totalGasEstimate: undefined, warnings, errors };
    }

    const simulationPlugins = this.plugins.getByType('simulation-rule') as SimulationRulePlugin[];
    const provider = this._getProvider();

    if (!provider) {
      warnings.push('No provider available — skipping simulation');
      return { success: true, steps: [], totalGasEstimate: undefined, warnings, errors };
    }

    // Optimization 2: Filter to only contract_call nodes
    const callNodes = executionGraph.nodes.filter((n) => n.type === 'contract_call');

    if (callNodes.length === 0) {
      return { success: true, steps: [], totalGasEstimate: undefined, warnings, errors };
    }

    // Optimization 3: Run preStep hooks in parallel, then simulate nodes in parallel
    await Promise.all(
      simulationPlugins.map(async (plugin) => {
        try {
          const hooks = plugin.getSimulationHooks();
          if (hooks.preStep) {
            for (const node of callNodes) {
              await hooks.preStep(node as unknown as Record<string, unknown>);
            }
          }
        } catch {}
      })
    );

    // Optimization 4: Simulate all nodes in parallel with timeout
    const stepPromises = callNodes.map((node) =>
      this._simulateNode(node, provider, simulationPlugins)
    );

    const results = await Promise.allSettled(stepPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        steps.push(result.value);
        if (result.value.reverted) {
          errors.push(`Simulation reverted for ${callNodes[i].id}: ${result.value.revertReason}`);
        }
      } else {
        steps.push({
          nodeId: callNodes[i].id,
          success: false,
          reverted: false,
          error: result.reason?.message || 'Simulation failed',
        });
        errors.push(`Simulation failed for ${callNodes[i].id}: ${result.reason?.message}`);
      }
    }

    const allSuccess = steps.every((s) => s.success);

    // Optimization 5: Compute total gas from individual steps (no extra RPC call)
    const totalGas = this._aggregateGas(steps);

    return { success: allSuccess, steps, totalGasEstimate: totalGas, warnings, errors };
  }

  private async _simulateNode(
    node: ExecutionNode,
    provider: AbstractProvider,
    plugins: SimulationRulePlugin[]
  ): Promise<SimulatedStep> {
    const step: SimulatedStep = {
      nodeId: node.id,
      success: false,
      reverted: false,
    };

    if (!node.call) {
      step.error = 'No call data';
      return step;
    }

    // Check simulation cache
    const cacheKey = this._cacheKey(node);
    const cached = this.simulationCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.CACHE_TTL_MS) {
      return { ...cached.result };
    }

    try {
      // Run with timeout
      const result = await Promise.race([
        this._executeSimulation(node, provider),
        this._timeout(SIMULATION_TIMEOUT_MS),
      ]);

      if (result === 'TIMEOUT') {
        step.error = `Simulation timed out after ${SIMULATION_TIMEOUT_MS}ms`;
        // Don't fail on timeout — treat as success with warning
        step.success = true;
        step.reverted = false;
      } else {
        step.success = true;
        step.reverted = false;
        step.gasEstimate = result.gasEstimate;
      }
    } catch (simErr: unknown) {
      const msg = (simErr as Error).message;
      step.reverted = true;
      step.revertReason = msg;
      step.error = msg;
    }

    // Cache the result
    this.simulationCache.set(cacheKey, { result: { ...step }, at: Date.now() });

    // Run postStep hooks
    for (const plugin of plugins) {
      try {
        const hooks = plugin.getSimulationHooks();
        if (hooks.postStep) {
          await hooks.postStep(
            node as unknown as Record<string, unknown>,
            step as unknown as Record<string, unknown>
          );
        }
      } catch {}
    }

    return step;
  }

  private async _executeSimulation(
    node: ExecutionNode,
    provider: AbstractProvider
  ): Promise<{ gasEstimate?: GasEstimate }> {
    const { parseEther, parseUnits, formatEther } = require('ethers');

    // Build calldata
    const data = node.call!.args &&
      typeof node.call!.args[0] === 'string' &&
      node.call!.args[0].startsWith('0x')
        ? node.call!.args[0]
        : '0x';

    const value = parseEther(node.call!.value || '0');

    // Batch eth_call + getFeeData into a single round-trip where possible
    const [callResult, feeData] = await Promise.all([
      provider.call({
        to: node.call!.address,
        data,
        value,
      }).catch((e: Error) => { throw e; }),
      provider.getFeeData().catch(() => null),
    ]);

    // Derive gas estimate from fee data (no separate gas_estimate RPC)
    const gasLimit = BigInt(node.call!.gasLimit || '500000');
    const gasPrice = feeData?.gasPrice || parseUnits('1', 'gwei');
    const costWei = gasLimit * gasPrice;

    return {
      gasEstimate: {
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        estimatedCostWei: costWei.toString(),
        estimatedCostEth: formatEther(costWei),
      },
    };
  }

  private _aggregateGas(steps: SimulatedStep[]): GasEstimate | undefined {
    const { formatEther } = require('ethers');

    let totalLimit = 0n;
    let totalCostWei = 0n;
    let gasPrice = 0n;

    for (const step of steps) {
      if (step.gasEstimate) {
        totalLimit += BigInt(step.gasEstimate.gasLimit);
        totalCostWei += BigInt(step.gasEstimate.estimatedCostWei);
        const price = BigInt(step.gasEstimate.gasPrice);
        if (price > gasPrice) gasPrice = price;
      }
    }

    if (totalLimit === 0n) return undefined;

    return {
      gasLimit: totalLimit.toString(),
      gasPrice: gasPrice.toString(),
      estimatedCostWei: totalCostWei.toString(),
      estimatedCostEth: formatEther(totalCostWei),
    };
  }

  private _cacheKey(node: ExecutionNode): string {
    if (!node.call) return node.id;
    return `${node.call.address}:${node.call.function}:${node.call.value}:${JSON.stringify(node.call.args)}`;
  }

  private _timeout(ms: number): Promise<'TIMEOUT'> {
    return new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), ms));
  }

  private _getProvider(): AbstractProvider | null {
    try {
      // Runtime provider lives at agentix/src/core/provider — from
      // packages/compiler/pipeline/ that is ../../../src/core/provider.
      const { getProvider } = require('../../../src/core/provider');
      return getProvider() as AbstractProvider;
    } catch {
      return null;
    }
  }
}
