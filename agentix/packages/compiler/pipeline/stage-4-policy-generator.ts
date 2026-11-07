import { ParsedIntent } from '../types/intent';
import { PolicyGraph, PolicyRule, EffectiveLimits } from '../types/policy';
import { PluginRegistry } from '../plugins/registry';
import { PolicyRulePlugin } from '../types/plugin';
import { generateId } from '@agentix/utils';
import { CompilerConfig } from '../types/compilation';

export class PolicyGenerator {
  /**
   * Build the policy generator.
   * Why: rule generation needs the plugin registry (policy-rule plugins) and the maxPolicyRules cap from config.
   * @param plugins - registry consulted for 'policy-rule' plugins.
   * @param config - compiler config; maxPolicyRules bounds the emitted rule set.
   * Maps to: internal — PipelineOrchestrator constructor.
   */
  constructor(private plugins: PluginRegistry, private config: CompilerConfig) {}

  /**
   * Generate the policy graph for an intent: default, limit and constraint rules plus plugin rules, sorted by precedence.
   * Why: stage 4 turns intent limits into enforceable rules before optimization — the policy graph is what the risk engine and the executor both read.
   * @param intent - parsed intent.
   * @returns PolicyGraph capped at maxPolicyRules, rules sorted highest-precedence first, root set to the first rule's id ('empty' when no rules exist).
   * @throws Never; failing policy plugins are skipped.
   * Maps to: policy rule spend-cap (value limit), time limit, target allowlist.
   */
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

  /**
   * Emit the always-on baseline rules: intent expiry as a time limit, session intents barred from batch execution, and a system constraint pinning the normalized action.
   * Why: these hold even when the intent carries no explicit limits — an unbounded session or a batch inside a session must never slip through.
   * @param intent - parsed intent.
   * @returns Default rules (possibly empty when the intent carries no expiry/session); the system mustHave rule is always present.
   * Maps to: policy rule spend-cap (time limit) and constraint mustHave.
   */
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

  /**
   * Emit numeric limit rules from the intent: maxValue, maxGas, target allowlist, plus the system-wide batch cap of 20.
   * Why: limits are the quantitative half of policy — they become the effectiveLimits the risk engine scores against.
   * @param intent - parsed intent.
   * @returns Limit rules; the count<=20 system rule is always present.
   * Maps to: policy rule spend-cap (value/gas/target/batch limits).
   */
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

  /**
   * Emit constraint/requirement rules from org membership and agent identity.
   * Why: org-scoped and identity-bound intents carry requirements (credential version, permissions) that pure limits cannot express.
   * @param intent - parsed intent.
   * @returns Constraint/requirement rules; empty when the intent has neither organizationId nor identityId.
   * Maps to: policy rule requirement (credential version / permissions).
   */
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

  /**
   * Fold the rule list into one EffectiveLimits record (first rule per field wins, rules are precedence-sorted).
   * Why: downstream stages need a single number per limit, not a rule list — the risk engine compares value against maxValue here.
   * @param rules - precedence-sorted rules; only limit-type rules with a known field contribute.
   * @returns EffectiveLimits; defaults are maxValue/maxGas '0', expiry now+3600s, empty allowlist, maxBatchSize 20.
   * Maps to: internal — PolicyGenerator.generate.
   */
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
