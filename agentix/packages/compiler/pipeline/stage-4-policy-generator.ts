import { ParsedIntent } from '../types/intent';
import { PolicyGraph, PolicyRule, EffectiveLimits } from '../types/policy';
import { PluginRegistry } from '../plugins/registry';
import { PolicyRulePlugin } from '../types/plugin';
import { generateId } from '@agentix/utils';
import { CompilerConfig } from '../types/compilation';

export class PolicyGenerator {
  constructor(private plugins: PluginRegistry, private config: CompilerConfig) {}

  async generate(intent: ParsedIntent): Promise<PolicyGraph> {
    const rules: PolicyRule[] = [];
    const maxRules = this.config.maxPolicyRules;

    rules.push(...this._generateDefaultRules(intent));
    rules.push(...this._generateLimitRules(intent));
    rules.push(...this._generateConstraintRules(intent));

    const policyPlugins = this.plugins.getByType('policy-rule') as PolicyRulePlugin[];
    for (const plugin of policyPlugins) {
      if (rules.length >= maxRules) break;
      try {
        const result = await plugin.generateRules(intent as unknown as Record<string, unknown>, {});
        for (const r of result.rules) {
          if (rules.length >= maxRules) break;
          rules.push({
            id: r.id || generateId(),
            type: (r.type as PolicyRule['type']) || 'limit',
            source: `plugin:${plugin.name}`,
            precedence: r.precedence || 50,
            limit: r.limit as PolicyRule['limit'],
            constraint: r.constraint as PolicyRule['constraint'],
          });
        }
      } catch {}
    }

    rules.sort((a, b) => b.precedence - a.precedence);

    const effectiveLimits = this._computeEffectiveLimits(rules);

    return {
      rules: rules.slice(0, maxRules),
      edges: [],
      root: rules[0]?.id || 'empty',
      effectiveLimits,
      conflicts: [],
    };
  }

  private _generateDefaultRules(intent: ParsedIntent): PolicyRule[] {
    const rules: PolicyRule[] = [];

    if (intent.limits?.expiry) {
      rules.push({
        id: generateId(),
        type: 'limit',
        source: 'intent',
        precedence: 100,
        limit: { field: 'time', operator: 'lte', value: intent.limits.expiry },
      });
    }

    if (intent.sessionId) {
      rules.push({
        id: generateId(),
        type: 'constraint',
        source: 'session',
        precedence: 90,
        constraint: { mustHave: [], mustNotHave: ['wallet_execute_batch'], mustDelegate: false },
      });
    }

    rules.push({
      id: generateId(),
      type: 'constraint',
      source: 'system',
      precedence: 10,
      constraint: { mustHave: [intent.normalizedAction], mustNotHave: [], mustDelegate: false },
    });

    return rules;
  }

  private _generateLimitRules(intent: ParsedIntent): PolicyRule[] {
    const rules: PolicyRule[] = [];

    if (intent.limits?.maxValue) {
      rules.push({
        id: generateId(),
        type: 'limit',
        source: 'intent',
        precedence: 100,
        limit: { field: 'value', operator: 'lte', value: intent.limits.maxValue },
      });
    }

    if (intent.limits?.maxGas) {
      rules.push({
        id: generateId(),
        type: 'limit',
        source: 'intent',
        precedence: 100,
        limit: { field: 'gas', operator: 'lte', value: intent.limits.maxGas },
      });
    }

    if (intent.targets && intent.targets.length > 0) {
      rules.push({
        id: generateId(),
        type: 'limit',
        source: 'intent',
        precedence: 95,
        limit: { field: 'target', operator: 'in', value: intent.targets },
      });
    }

    rules.push({
      id: generateId(),
      type: 'limit',
      source: 'system',
      precedence: 5,
      limit: { field: 'count', operator: 'lte', value: 20 },
    });

    return rules;
  }

  private _generateConstraintRules(intent: ParsedIntent): PolicyRule[] {
    const rules: PolicyRule[] = [];

    if (intent.organizationId) {
      rules.push({
        id: generateId(),
        type: 'constraint',
        source: 'organization',
        precedence: 80,
        constraint: { mustHave: [], mustNotHave: [], mustDelegate: false },
      });
    }

    if (intent.agent?.identityId) {
      rules.push({
        id: generateId(),
        type: 'requirement',
        source: 'identity',
        precedence: 85,
        requirement: {
          credentialVersion: 1,
          requiredPermissions: 1,
          zkProofRequired: false,
        },
      });
    }

    return rules;
  }

  private _computeEffectiveLimits(rules: PolicyRule[]): EffectiveLimits {
    const limits: EffectiveLimits = {
      maxValue: '0',
      maxGas: '0',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      allowedTargets: [],
      maxBatchSize: 20,
    };

    const seen = new Set<string>();

    for (const rule of rules) {
      if (!rule.limit) continue;
      if (seen.has(rule.limit.field)) continue;
      seen.add(rule.limit.field);

      switch (rule.limit.field) {
        case 'value':
          limits.maxValue = rule.limit.value as string;
          break;
        case 'gas':
          limits.maxGas = rule.limit.value as string;
          break;
        case 'time':
          limits.expiry = rule.limit.value as number;
          break;
        case 'target':
          if (rule.limit.operator === 'in' && Array.isArray(rule.limit.value)) {
            limits.allowedTargets = rule.limit.value as string[];
          }
          break;
        case 'count':
          limits.maxBatchSize = rule.limit.value as number;
          break;
      }
    }

    return limits;
  }
}
