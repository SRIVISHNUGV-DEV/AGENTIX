import type { AbstractProvider } from 'ethers';
import { ParsedIntent } from '../types/intent';
import { ExecutionGraph, ExecutionNode } from '../types/execution-plan';
import { SimulationResult, SimulatedStep, GasEstimate } from '../types/simulation';
import { CompilerConfig } from '../types/compilation';
import { PluginRegistry } from '../plugins/registry';
import { SimulationRulePlugin } from '../types/plugin';

export class Simulator {
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

    const simulationPlugins = this.plugins.getByType('simulation-rule') as SimulationRulePlugin[];

    for (const node of executionGraph.nodes) {
      if (node.type !== 'contract_call') continue;

      const step: SimulatedStep = {
        nodeId: node.id,
        success: false,
        reverted: false,
      };

      try {
        const provider = this._getProvider();
        if (!provider) {
          warnings.push(`No provider available for simulation of ${node.id}`);
          steps.push({ ...step, error: 'No provider' });
          continue;
        }

        for (const plugin of simulationPlugins) {
          try {
            const hooks = plugin.getSimulationHooks();
            if (hooks.preStep) {
              await hooks.preStep(node as unknown as Record<string, unknown>);
            }
          } catch {}
        }

        try {
          const gasEstimate = await this._estimateGas(node, provider);
          step.gasEstimate = gasEstimate;
        } catch (gasErr: unknown) {
          warnings.push(`Gas estimation failed for ${node.id}: ${(gasErr as Error).message}`);
        }

        try {
          await this._simulateCall(node, provider);
          step.success = true;
          step.reverted = false;
        } catch (simErr: unknown) {
          const msg = (simErr as Error).message;
          step.reverted = true;
          step.revertReason = msg;
          step.error = msg;
          errors.push(`Simulation reverted for ${node.id}: ${msg}`);
        }

        for (const plugin of simulationPlugins) {
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
      } catch (err: unknown) {
        step.error = (err as Error).message;
        errors.push(`Simulation failed for ${node.id}: ${(err as Error).message}`);
      }

      steps.push(step);
    }

    const allSuccess = steps.every((s) => s.success);

    const totalGas: GasEstimate | undefined = steps.length > 0
      ? {
          gasLimit: '0',
          gasPrice: '0',
          estimatedCostWei: '0',
          estimatedCostEth: '0',
        }
      : undefined;

    return { success: allSuccess, steps, totalGasEstimate: totalGas, warnings, errors };
  }

  private async _estimateGas(node: ExecutionNode, provider: unknown): Promise<GasEstimate> {
    const { parseUnits, formatEther } = require('ethers');
    if (!node.call) throw new Error('No call data');

    const gasLimit = BigInt(node.call.gasLimit || '500000');
    const feeData = await (provider as AbstractProvider).getFeeData();
    const gasPrice = feeData.gasPrice || parseUnits('1', 'gwei');
    const costWei = gasLimit * gasPrice;

    return {
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      estimatedCostWei: costWei.toString(),
      estimatedCostEth: formatEther(costWei),
    };
  }

  private async _simulateCall(node: ExecutionNode, provider: unknown): Promise<void> {
    if (!node.call) throw new Error('No call data');
    const { toUtf8Bytes, parseEther } = require('ethers');

    await (provider as AbstractProvider).call({
      to: node.call.address,
      data: toUtf8Bytes(JSON.stringify(node.call.args)),
      value: parseEther(node.call.value || '0'),
    });
  }

  private _getProvider(): unknown | null {
    try {
      const { getProvider } = require('../../core/provider');
      return getProvider();
    } catch {
      return null;
    }
  }
}
