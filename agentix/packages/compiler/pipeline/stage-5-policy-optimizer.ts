import { PolicyGraph, PolicyRule, OptimizedPolicy } from '../types/policy';

export class PolicyOptimizer {
  /**
   * Optimize a policy graph: drop rules implied by a stricter kept rule, merge compatible rules, re-sort by precedence.
   * Why: stage 5 keeps the rule set small and non-redundant so enforcement and risk scoring stay cheap and auditable.
   * @param policyGraph - graph from stage 4; not mutated (rules are copied).
   * @returns OptimizedPolicy with the same shape and effectiveLimits; rule count never grows.
   * Maps to: policy rule spend-cap (merged/tightened limits).
   */
  optimize(policyGraph: PolicyGraph): OptimizedPolicy {
    let rules = [...policyGraph.rules];

    rules = this._removeRedundancies(rules);
    rules = this._mergeCompatible(rules);
    rules.sort((a, b) => b.precedence - a.precedence);

    return {
      ...policyGraph,
      rules,
    };
  }

  /**
   * Drop any rule already implied by an earlier kept rule.
   * Why: a looser rule adds nothing when a stricter rule of the same type is already kept — it only bloats enforcement.
   * @param rules - precedence-sorted rules.
   * @returns Rules with implied ones removed, order preserved.
   * Maps to: internal — PolicyOptimizer.optimize.
   */
  private _removeRedundancies(rules: PolicyRule[]): PolicyRule[] {
    const kept: PolicyRule[] = [];

    for (const rule of rules) {
      const isRedundant = kept.some((existing) => this._implies(existing, rule));
      if (!isRedundant) {
        kept.push(rule);
      }
    }

    return kept;
  }

  /**
   * Test whether rule `a` already covers rule `b` (same type/field/operator, `a` at least as strict).
   * Why: the redundancy predicate — only 'lte' numeric comparisons and 'in' set containment are decidable here; anything else is conservatively "not implied".
   * @param a - candidate covering rule.
   * @param b - candidate covered rule.
   * @returns True only for same-type rules where a's bound is tighter or equal; false on unparseable values instead of throwing.
   * Maps to: internal — PolicyOptimizer._removeRedundancies.
   */
  private _implies(a: PolicyRule, b: PolicyRule): boolean {
    if (a.type !== b.type) return false;

    if (a.limit && b.limit && a.limit.field === b.limit.field && a.limit.operator === b.limit.operator) {
      if (a.limit.operator === 'lte' && typeof a.limit.value === 'string' && typeof b.limit.value === 'string') {
        try {
          return BigInt(a.limit.value) <= BigInt(b.limit.value);
        } catch {
          return false;
        }
      }
      if (a.limit.operator === 'in' && Array.isArray(a.limit.value) && Array.isArray(b.limit.value)) {
        const bSet = new Set(b.limit.value);
        return (a.limit.value as string[]).every((v) => bSet.has(v));
      }
    }

    return false;
  }

  /**
   * Merge compatible rules into one per (type, source, field, operator) group, renaming merged ids with a `_merged` suffix.
   * Why: duplicate rules from different sources (intent + plugin) should enforce as one tightest rule, not two checks.
   * @param rules - precedence-sorted rules.
   * @returns Merged rules; every input rule is consumed exactly once.
   * Maps to: internal — PolicyOptimizer.optimize.
   */
  private _mergeCompatible(rules: PolicyRule[]): PolicyRule[] {
    const merged: PolicyRule[] = [];
    const used = new Set<string>();

    for (let i = 0; i < rules.length; i++) {
      if (used.has(rules[i].id)) continue;

      let current = { ...rules[i], id: `${rules[i].id}_merged` };
      used.add(rules[i].id);

      for (let j = i + 1; j < rules.length; j++) {
        if (used.has(rules[j].id)) continue;
        if (this._isCompatible(current, rules[j])) {
            current = this._doMerge(current, rules[j]);
          used.add(rules[j].id);
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /**
   * Test whether two rules may be merged: same type, source, limit field and operator.
   * Why: merging across sources or operators would silently change semantics — the guard keeps merges meaning-preserving.
   * @param a - first rule.
   * @param b - second rule.
   * @returns True when both rules share type, source, limit field and operator (undefined fields compare equal).
   * Maps to: internal — PolicyOptimizer._mergeCompatible.
   */
  private _isCompatible(a: PolicyRule, b: PolicyRule): boolean {
    return (
      a.type === b.type &&
      a.source === b.source &&
      a.limit?.field === b.limit?.field &&
      a.limit?.operator === b.limit?.operator
    );
  }

  /**
   * Merge two compatible limit rules into the tighter one: min for 'lte', intersection for 'in'.
   * Why: the merged rule must be at least as strict as both inputs — taking the min/intersection is the only safe combination.
   * @param a - accumulator rule (its id and precedence survive).
   * @param b - rule being folded in.
   * @returns The merged rule, or `a` unchanged when either rule lacks a limit or the values are unparseable.
   * Maps to: internal — PolicyOptimizer._mergeCompatible.
   */
  private _doMerge(a: PolicyRule, b: PolicyRule): PolicyRule {
    if (!a.limit || !b.limit) return a;
    const aLimit = a.limit;
    const bLimit = b.limit;

    if (aLimit.operator === 'lte' && typeof aLimit.value === 'string' && typeof bLimit.value === 'string') {
      try {
        const aVal = BigInt(aLimit.value);
        const bVal = BigInt(bLimit.value);
        return { ...a, limit: { ...aLimit, value: (aVal < bVal ? aVal : bVal).toString() } };
      } catch {
        return a;
      }
    }

    if (aLimit.operator === 'in' && Array.isArray(aLimit.value) && Array.isArray(bLimit.value)) {
      const intersection = (aLimit.value as string[]).filter((v) =>
        (bLimit.value as string[]).includes(v)
      );
      return { ...a, limit: { ...aLimit, value: intersection } };
    }

    return a;
  }
}
