import { ParsedIntent } from '../types/intent';
import { ResolvedCapabilities } from '../types/capability';
import { RiskAssessment, RiskFactor, RiskCategory, RISK_THRESHOLDS } from '../types/risk';
import { PluginRegistry } from '../plugins/registry';
import { RiskRulePlugin } from '../types/plugin';
import { CompilerConfig } from '../types/compilation';

export class RiskEngine {
  constructor(private plugins: PluginRegistry, private config: CompilerConfig) {}

  async assess(
    intent: ParsedIntent,
    capabilities: ResolvedCapabilities
  ): Promise<RiskAssessment> {
    const factors: RiskFactor[] = [];

    factors.push(this._assessValue(intent));
    factors.push(this._assessTarget(intent));
    factors.push(this._assessAction(intent));
    factors.push(this._assessCapabilities(capabilities));
    factors.push(this._assessIntentAge(intent));

    const riskPlugins = this.plugins.getByType('risk-rule') as RiskRulePlugin[];
    for (const plugin of riskPlugins) {
      try {
        const result = await plugin.assessRisk(intent as unknown as Record<string, unknown>, {});
        for (const f of result.factors) {
          factors.push({
            name: `plugin:${plugin.name}:${f.name}`,
            weight: f.weight,
            score: f.score,
            reason: f.reason,
          });
        }
      } catch {}
    }

    const score = this._computeScore(factors);
    const category = this._categorize(score);
    const warnings = this._generateWarnings(factors, category);
    const suggestions = this._generateSuggestions(factors, category);

    return {
      score,
      category,
      factors,
      warnings,
      suggestions,
      requiresApproval: score >= this.config.riskThreshold,
    };
  }

  private _assessValue(intent: ParsedIntent): RiskFactor {
    const value = intent.params.value as string;
    let score = 0;
    let reason = 'No value transfer';

    if (value) {
      try {
        const wei = BigInt(value);
        const oneEth = BigInt('1000000000000000000');
        if (wei > oneEth * BigInt(100)) {
          score = 100;
          reason = 'Very high value transfer (>100 ETH)';
        } else if (wei > oneEth * BigInt(10)) {
          score = 75;
          reason = 'High value transfer (>10 ETH)';
        } else if (wei > oneEth) {
          score = 50;
          reason = 'Moderate value transfer (>1 ETH)';
        } else if (wei > BigInt(0)) {
          score = 25;
          reason = 'Low value transfer (<1 ETH)';
        }
      } catch {
        score = 25;
        reason = 'Value transfer present (could not parse amount)';
      }
    }

    return { name: 'value_transfer', weight: 0.30, score, reason };
  }

  private _assessTarget(intent: ParsedIntent): RiskFactor {
    const targets = intent.targets || [];
    const targetParam = intent.params.target as string | undefined;
    const allTargets = [...targets, targetParam].filter(Boolean);

    if (allTargets.length === 0) {
      return { name: 'target_trust', weight: 0.20, score: 10, reason: 'No explicit target' };
    }

    const knownContracts = [
      '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
      '0xaC0A72FaAF2596DD55A20049F0ab7584b58b3DEE',
    ];

    const unknownCount = allTargets.filter((t): t is string => t !== undefined && !knownContracts.includes(t.toLowerCase())).length;
    if (unknownCount > 0) {
      return { name: 'target_trust', weight: 0.20, score: 60, reason: `${unknownCount} unknown target(s)` };
    }

    return { name: 'target_trust', weight: 0.20, score: 20, reason: 'Known contract target(s)' };
  }

  private _assessAction(intent: ParsedIntent): RiskFactor {
    const highRiskActions = ['wallet_execute', 'wallet_execute_batch', 'credential_revoke', 'organization_deactivate'];
    const mediumRiskActions = ['session_create', 'session_create_lightweight', 'credential_issue', 'delegation_create', 'capability_register'];
    const lowRiskActions = ['wallet_create', 'wallet_deposit', 'session_revoke', 'identity_update_metadata'];

    if (highRiskActions.includes(intent.normalizedAction)) {
      return { name: 'action_sensitivity', weight: 0.25, score: 75, reason: `High-sensitivity action: ${intent.action}` };
    }
    if (mediumRiskActions.includes(intent.normalizedAction)) {
      return { name: 'action_sensitivity', weight: 0.25, score: 40, reason: `Medium-sensitivity action: ${intent.action}` };
    }
    if (lowRiskActions.includes(intent.normalizedAction)) {
      return { name: 'action_sensitivity', weight: 0.25, score: 15, reason: `Low-sensitivity action: ${intent.action}` };
    }
    return { name: 'action_sensitivity', weight: 0.25, score: 30, reason: `Unknown sensitivity: ${intent.action}` };
  }

  private _assessCapabilities(capabilities: ResolvedCapabilities): RiskFactor {
    if (capabilities.canExecute && capabilities.missingExplicit.length === 0) {
      return { name: 'capability_coverage', weight: 0.15, score: 10, reason: 'All capabilities satisfied' };
    }
    if (capabilities.missingExplicit.length > 0) {
      return { name: 'capability_coverage', weight: 0.15, score: 50, reason: `Missing capabilities: ${capabilities.missingExplicit.join(', ')}` };
    }
    return { name: 'capability_coverage', weight: 0.15, score: 30, reason: 'Partial capability coverage' };
  }

  private _assessIntentAge(intent: ParsedIntent): RiskFactor {
    const age = Math.floor(Date.now() / 1000) - intent.requestedAt;
    if (age > 300) {
      return { name: 'intent_age', weight: 0.10, score: 40, reason: `Intent is ${age}s old` };
    }
    return { name: 'intent_age', weight: 0.10, score: 5, reason: 'Fresh intent' };
  }

  private _computeScore(factors: RiskFactor[]): number {
    let totalWeight = 0;
    let weightedScore = 0;
    for (const f of factors) {
      weightedScore += f.score * f.weight;
      totalWeight += f.weight;
    }
    if (totalWeight === 0) return 0;
    return Math.round(weightedScore / totalWeight);
  }

  private _categorize(score: number): RiskCategory {
    if (score <= RISK_THRESHOLDS.LOW_MAX) return 'LOW';
    if (score <= RISK_THRESHOLDS.MEDIUM_MAX) return 'MEDIUM';
    if (score <= RISK_THRESHOLDS.HIGH_MAX) return 'HIGH';
    return 'AUTHORITY';
  }

  private _generateWarnings(factors: RiskFactor[], category: RiskCategory) {
    const warnings: { code: string; message: string; severity: 'info' | 'warning' | 'critical' }[] = [];

    if (category === 'HIGH' || category === 'AUTHORITY') {
      warnings.push({
        code: 'HIGH_RISK_ACTION',
        message: `This action is classified as ${category} risk and requires careful review`,
        severity: 'critical',
      });
    }

    const valueFactor = factors.find((f) => f.name === 'value_transfer');
    if (valueFactor && valueFactor.score > 50) {
      warnings.push({
        code: 'HIGH_VALUE',
        message: valueFactor.reason,
        severity: 'warning',
      });
    }

    const targetFactor = factors.find((f) => f.name === 'target_trust');
    if (targetFactor && targetFactor.score > 40) {
      warnings.push({
        code: 'UNKNOWN_TARGET',
        message: 'Transaction targets include unknown addresses',
        severity: 'warning',
      });
    }

    return warnings;
  }

  private _generateSuggestions(factors: RiskFactor[], category: RiskCategory) {
    const suggestions: { code: string; message: string; mitigation: string }[] = [];

    if (category === 'AUTHORITY') {
      suggestions.push({
        code: 'REQUIRE_APPROVAL',
        message: 'This plan requires explicit approval before execution',
        mitigation: 'Review and approve from the dashboard or via wallet signature',
      });
    }

    const valueFactor = factors.find((f) => f.name === 'value_transfer');
    if (valueFactor && valueFactor.score > 50) {
      suggestions.push({
        code: 'REDUCE_VALUE',
        message: 'Consider reducing the transfer value',
        mitigation: 'Split into multiple smaller transactions over time',
      });
    }

    const ageFactor = factors.find((f) => f.name === 'intent_age');
    if (ageFactor && ageFactor.score > 30) {
      suggestions.push({
        code: 'REFRESH_INTENT',
        message: 'Intent may be stale',
        mitigation: 'Re-compile with fresh data and current blockchain state',
      });
    }

    return suggestions;
  }
}
