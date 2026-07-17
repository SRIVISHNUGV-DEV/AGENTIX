// ─────────────────────────────────────────────────────────────────────────────
// Scoring & decisioning
//
// Turns raw signals into: per-dimension factors, an aggregate score, a category,
// a decision, controls, warnings and suggestions.
//
// Aggregation model (why it's not a naive weighted average):
//   • Within a dimension, signals combine as: max + damped-sum-of-rest, capped at
//     the dimension cap. One critical signal dominates; corroborating signals add
//     a shrinking bonus. This avoids both "one flag = max" and "many small flags
//     average away the one big flag".
//   • Across dimensions, we take a weighted mean AND a dominance term (the single
//     highest dimension score). The aggregate is a blend biased toward the worst
//     dimension, because in security the worst axis usually is the risk.
//   • Hard overrides (sanctioned counterparty, simulation revert, policy value
//     breach) can force the decision to DENY/REVIEW regardless of the blended score.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RiskSignal, RiskFactor, RiskCategory, RiskDecision, RiskDimension,
  RiskWarning, RiskSuggestion, RiskControl,
  RISK_DIMENSIONS, RISK_THRESHOLDS, DECISION_BANDS,
  DEFAULT_DIMENSION_WEIGHTS, DIMENSION_CAPS,
} from '../types/risk';

/** Combine signals within a single dimension → 0–100 dimension score. */
export function combineSignals(signals: RiskSignal[], cap: number): { score: number; capped: boolean } {
  if (signals.length === 0) return { score: 0, capped: false };
  const scores = signals.map((s) => s.score).sort((a, b) => b - a);
  const top = scores[0];
  // Damped contribution from the remaining signals: each subsequent signal adds
  // a geometrically shrinking fraction of its score.
  let bonus = 0;
  for (let i = 1; i < scores.length; i++) {
    bonus += scores[i] * Math.pow(0.4, i);
  }
  const raw = top + bonus;
  const capped = raw > cap;
  return { score: Math.round(Math.min(cap, raw)), capped };
}

export interface ScoreResult {
  score: number;
  category: RiskCategory;
  decision: RiskDecision;
  factors: RiskFactor[];
  dimensionScores: Partial<Record<RiskDimension, number>>;
  signals: RiskSignal[];
  warnings: RiskWarning[];
  suggestions: RiskSuggestion[];
  controls: RiskControl[];
  topDrivers: string[];
}

export function score(
  signals: RiskSignal[],
  weightOverrides: Partial<Record<RiskDimension, number>>,
  thresholds: { approval: number; deny: number }
): ScoreResult {
  const byDim = groupByDimension(signals);
  const weights = { ...DEFAULT_DIMENSION_WEIGHTS, ...weightOverrides };

  const factors: RiskFactor[] = [];
  const dimensionScores: Partial<Record<RiskDimension, number>> = {};

  for (const dim of RISK_DIMENSIONS) {
    const dimSignals = byDim.get(dim) || [];
    const { score: dimScore, capped } = combineSignals(dimSignals, DIMENSION_CAPS[dim]);
    dimensionScores[dim] = dimScore;
    const dominant = [...dimSignals].sort((a, b) => b.score - a.score)[0];
    factors.push({
      name: legacyName(dim),
      dimension: dim,
      weight: weights[dim],
      score: dimScore,
      reason: dominant ? dominant.reason : 'No signal',
      signals: dimSignals,
      capped,
    });
  }

  // ── aggregate: blend of weighted mean and dominance term ──────────────────
  let weightedSum = 0;
  let weightTotal = 0;
  let maxDim = 0;
  for (const dim of RISK_DIMENSIONS) {
    const w = weights[dim];
    weightedSum += (dimensionScores[dim] || 0) * w;
    weightTotal += w;
    if ((dimensionScores[dim] || 0) > maxDim) maxDim = dimensionScores[dim] || 0;
  }
  const weightedMean = weightTotal > 0 ? weightedSum / weightTotal : 0;
  // 55% dominance / 45% mean: security-biased toward the worst axis.
  let aggregate = Math.round(0.55 * maxDim + 0.45 * weightedMean);

  // ── hard overrides ────────────────────────────────────────────────────────
  const hasCode = (c: string) => signals.some((s) => s.code === c);
  let forcedDecision: RiskDecision | null = null;

  if (hasCode('COMP_BLOCKED')) { aggregate = 100; forcedDecision = 'DENY'; }
  if (hasCode('SIM_REVERT')) { aggregate = Math.max(aggregate, 90); forcedDecision = forcedDecision || 'DENY'; }
  if (hasCode('POLICY_VALUE_BREACH') || hasCode('POLICY_TARGET_OFFLIST')) {
    aggregate = Math.max(aggregate, 78);
    forcedDecision = forcedDecision || 'REVIEW';
  }

  aggregate = Math.max(0, Math.min(100, aggregate));

  const category = categorize(aggregate);
  const decision = forcedDecision
    ? mostSevere(forcedDecision, bandDecision(aggregate))
    : bandDecision(aggregate);

  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);
  const topDrivers = sortedSignals
    .filter((s) => s.score >= 30)
    .slice(0, 4)
    .map((s) => `${s.reason} (${s.dimension}:${s.score})`);

  return {
    score: aggregate,
    category,
    decision,
    factors,
    dimensionScores,
    signals: sortedSignals,
    warnings: buildWarnings(sortedSignals, category, decision),
    suggestions: buildSuggestions(sortedSignals, decision),
    controls: buildControls(sortedSignals, decision),
    topDrivers,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function groupByDimension(signals: RiskSignal[]): Map<RiskDimension, RiskSignal[]> {
  const m = new Map<RiskDimension, RiskSignal[]>();
  for (const s of signals) {
    const list = m.get(s.dimension) || [];
    list.push(s);
    m.set(s.dimension, list);
  }
  return m;
}

/** Legacy factor names so existing consumers/tests keep matching by name. */
function legacyName(dim: RiskDimension): string {
  switch (dim) {
    case 'value': return 'value_transfer';
    case 'counterparty': return 'target_trust';
    case 'authority': return 'action_sensitivity';
    case 'capability': return 'capability_coverage';
    case 'temporal': return 'intent_age';
    default: return dim;
  }
}

function categorize(s: number): RiskCategory {
  if (s <= RISK_THRESHOLDS.LOW_MAX) return 'LOW';
  if (s <= RISK_THRESHOLDS.MEDIUM_MAX) return 'MEDIUM';
  if (s <= RISK_THRESHOLDS.HIGH_MAX) return 'HIGH';
  return 'AUTHORITY';
}

function bandDecision(s: number): RiskDecision {
  for (const band of DECISION_BANDS) if (s <= band.max) return band.decision;
  return 'DENY';
}

const DECISION_SEVERITY: Record<RiskDecision, number> = {
  ALLOW: 0, ALLOW_WITH_CONTROLS: 1, REVIEW: 2, CHALLENGE: 3, DENY: 4,
};
function mostSevere(a: RiskDecision, b: RiskDecision): RiskDecision {
  return DECISION_SEVERITY[a] >= DECISION_SEVERITY[b] ? a : b;
}

function buildWarnings(signals: RiskSignal[], category: RiskCategory, decision: RiskDecision): RiskWarning[] {
  const w: RiskWarning[] = [];
  if (decision === 'DENY') {
    w.push({ code: 'DENY', message: 'This plan is recommended for denial.', severity: 'critical' });
  } else if (category === 'HIGH' || category === 'AUTHORITY') {
    w.push({ code: 'HIGH_RISK_ACTION',
      message: `This action is classified as ${category} risk and requires careful review`,
      severity: 'critical' });
  }
  // Surface each critical/high signal once as a warning.
  for (const s of signals) {
    if (s.severity === 'critical') {
      w.push({ code: s.code, message: s.reason, severity: 'critical' });
    } else if (s.severity === 'high') {
      w.push({ code: s.code, message: s.reason, severity: 'warning' });
    }
  }
  return dedupeWarnings(w);
}

function dedupeWarnings(w: RiskWarning[]): RiskWarning[] {
  const seen = new Set<string>();
  return w.filter((x) => (seen.has(x.code) ? false : (seen.add(x.code), true)));
}

function buildSuggestions(signals: RiskSignal[], decision: RiskDecision): RiskSuggestion[] {
  const s: RiskSuggestion[] = [];
  const has = (c: string) => signals.some((x) => x.code === c);

  if (decision === 'REVIEW' || decision === 'CHALLENGE' || decision === 'DENY') {
    s.push({ code: 'REQUIRE_APPROVAL', message: 'This plan requires explicit approval before execution',
      mitigation: 'Review and approve from the dashboard or via an owner signature' });
  }
  if (has('VALUE_NOTIONAL') || has('VALUE_ETH')) {
    s.push({ code: 'REDUCE_VALUE', message: 'Consider reducing the transfer value',
      mitigation: 'Split into smaller transactions or lower the amount below policy ceilings' });
  }
  if (has('CP_UNKNOWN') || has('CP_KNOWN') || has('BEHAV_NEW_COUNTERPARTY')) {
    s.push({ code: 'VERIFY_COUNTERPARTY', message: 'Counterparty is unfamiliar',
      mitigation: 'Verify the recipient address out-of-band and add it to the allowlist if trusted' });
  }
  if (has('TEMP_STALE') || has('TEMP_AGING')) {
    s.push({ code: 'REFRESH_INTENT', message: 'Intent may be stale',
      mitigation: 'Recompile against current blockchain state before executing' });
  }
  if (has('SIM_REVERT')) {
    s.push({ code: 'FIX_REVERT', message: 'Simulation predicts a revert',
      mitigation: 'Inspect the revert reason and correct calldata/state before resubmitting' });
  }
  if (has('CAP_MISSING')) {
    s.push({ code: 'GRANT_CAPABILITY', message: 'Required capability is missing',
      mitigation: 'Issue the capability/credential or route through a valid delegation' });
  }
  return s;
}

function buildControls(signals: RiskSignal[], decision: RiskDecision): RiskControl[] {
  const c: RiskControl[] = [];
  const has = (code: string) => signals.some((s) => s.code === code);

  if (decision === 'CHALLENGE') {
    c.push({ code: 'STEP_UP', type: 'require_signature',
      description: 'Require a fresh owner signature (step-up authentication) before execution' });
  }
  if (has('AUTH_ACTION') && signals.some((s) => s.code === 'AUTH_ACTION' && s.severity === 'critical')) {
    c.push({ code: 'TIMELOCK', type: 'time_lock',
      description: 'Apply a time-lock so a control-plane change can be aborted before it takes effect',
      params: { delaySeconds: 3600 } });
  }
  if (has('CP_FANOUT') || has('BEHAV_VELOCITY')) {
    c.push({ code: 'RATE_LIMIT', type: 'rate_limit',
      description: 'Throttle subsequent actions from this agent until behavior normalizes' });
  }
  if (has('VALUE_NOTIONAL') || has('VALUE_ETH')) {
    if (decision === 'ALLOW_WITH_CONTROLS') {
      c.push({ code: 'VALUE_CAP', type: 'value_cap',
        description: 'Cap execution to the policy per-transaction limit' });
    }
  }
  if (has('CP_UNKNOWN') || has('CP_KNOWN')) {
    c.push({ code: 'MONITOR', type: 'monitor',
      description: 'Emit a monitoring event and watch the counterparty post-execution' });
  }
  return c;
}
