import { PolicyGraph, PolicyRule, OptimizedPolicy } from '../types/policy';

export class PolicyOptimizer {
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

  private _isCompatible(a: PolicyRule, b: PolicyRule): boolean {
    return (
      a.type === b.type &&
      a.source === b.source &&
      a.limit?.field === b.limit?.field &&
      a.limit?.operator === b.limit?.operator
    );
  }

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
