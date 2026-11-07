// ─────────────────────────────────────────────────────────────────────────────
// Dimension assessors
//
// Each assessor is a pure function (RiskInput, RiskContext) → RiskSignal[].
// A dimension's RiskFactor is built from its signals in scoring.ts. Keeping these
// pure and colocated makes the risk model auditable at a glance and unit-testable
// without any I/O.
//
// Scoring convention: every signal carries a 0–100 score representing its
// contribution *within its dimension*. The dimension score is the max signal
// score plus a damped sum of the rest (see scoring.combineSignals), so multiple
// corroborating signals escalate risk without trivially saturating it.
// ─────────────────────────────────────────────────────────────────────────────

import { RiskInput, RiskContext } from './context';
import { RiskSignal, RiskSeverity } from '../types/risk';

const ONE_ETH = 1_000_000_000_000_000_000n;

/**
 * Build one RiskSignal, clamping its score to 0–100.
 * Why: every assessor constructs signals through this one helper so the score invariant holds everywhere and no assessor can emit an out-of-range score.
 * @param code - signal code (e.g. 'VALUE_NOTIONAL'); downstream overrides and suggestions match on it.
 * @param dimension - risk dimension the signal belongs to.
 * @param severity - severity band.
 * @param score - 0–100 contribution within its dimension; clamped, never throws.
 * @param reason - human-readable explanation.
 * @param evidence - optional key/value evidence attached to the signal.
 * @returns The constructed RiskSignal.
 * Maps to: internal — all assess* functions in risk/signals.ts.
 */
function sig(
  code: string,
  dimension: RiskSignal['dimension'],
  severity: RiskSeverity,
  score: number,
  reason: string,
  evidence?: RiskSignal['evidence']
): RiskSignal {
  return { code, dimension, severity, score: Math.max(0, Math.min(100, score)), reason, evidence };
}

// ── 1. Value / economic magnitude ────────────────────────────────────────────

/**
 * Score the economic magnitude: USD-notional tiers when a price is known (≥$100k critical), ETH tiers otherwise (>$100 ETH critical), plus a batch-size bonus.
 * Why: value is the most direct proxy for blast radius — the same action at 0.01 ETH and 100 ETH must not score alike.
 * @param input - normalized risk input; only the economic view is read.
 * @returns Signals; VALUE_NONE (score 0) when no value moves. Never returns an empty array.
 * Maps to: policy rule spend-cap (value vs maxValue is scored separately in assessPolicy).
 */
export function assessValue(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const { valueWei, valueEth, notionalUsd, isBatch, batchSize } = input.economic;

  if (valueWei <= 0n) {
    out.push(sig('VALUE_NONE', 'value', 'info', 0, 'No native value transfer'));
    return out;
  }

  // Prefer USD notional when available; fall back to ETH tiers.
  if (notionalUsd > 0) {
    let score = 0;
    let sev: RiskSeverity = 'low';
    if (notionalUsd >= 100_000) { score = 100; sev = 'critical'; }
    else if (notionalUsd >= 25_000) { score = 85; sev = 'high'; }
    else if (notionalUsd >= 5_000) { score = 65; sev = 'high'; }
    else if (notionalUsd >= 1_000) { score = 45; sev = 'medium'; }
    else if (notionalUsd >= 100) { score = 25; sev = 'low'; }
    else { score = 12; sev = 'low'; }
    out.push(sig('VALUE_NOTIONAL', 'value', sev, score,
      `Transfer notional ≈ $${notionalUsd.toFixed(2)} (${valueEth.toFixed(4)} ETH)`,
      [{ key: 'usd', value: Math.round(notionalUsd) }, { key: 'eth', value: valueEth.toFixed(4) }]));
  } else {
    let score = 0;
    let sev: RiskSeverity = 'low';
    if (valueWei > ONE_ETH * 100n) { score = 100; sev = 'critical'; }
    else if (valueWei > ONE_ETH * 10n) { score = 78; sev = 'high'; }
    else if (valueWei > ONE_ETH) { score = 52; sev = 'medium'; }
    else if (valueWei > ONE_ETH / 10n) { score = 30; sev = 'low'; }
    else { score = 15; sev = 'low'; }
    out.push(sig('VALUE_ETH', 'value', sev, score,
      `Native transfer of ${valueEth.toFixed(4)} ETH (USD price unavailable)`,
      [{ key: 'eth', value: valueEth.toFixed(4) }]));
  }

  if (isBatch && batchSize > 1) {
    const score = Math.min(40, 8 * batchSize);
    out.push(sig('VALUE_BATCH', 'value', batchSize >= 5 ? 'medium' : 'low', score,
      `Batched execution moves value across ${batchSize} calls in one transaction`,
      [{ key: 'batchSize', value: batchSize }]));
  }

  return out;
}

// ── 2. Counterparty trust ────────────────────────────────────────────────────

/**
 * Score counterparty trust from per-target reputation tiers, plus a fan-out flag when ≥3 untrusted targets are paid at once.
 * Why: who receives the value matters as much as how much — a first-seen address and a drain-style fan-out are the classic exfiltration shapes.
 * @param input - normalized risk input; targets and reputation map are read.
 * @returns Signals; CP_NONE (score 8) when the intent names no counterparty. Targets missing from the reputation map are skipped.
 * Maps to: event COMP_BLOCKED (blocked tier is scored in assessCompliance, not here).
 */
export function assessCounterparty(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];

  if (input.targets.length === 0) {
    out.push(sig('CP_NONE', 'counterparty', 'info', 8, 'No explicit counterparty address'));
    return out;
  }

  for (const t of input.targets) {
    const rep = input.reputation.get(t);
    if (!rep) continue;
    let sev: RiskSeverity = 'low';
    if (rep.score >= 90) sev = 'critical';
    else if (rep.score >= 60) sev = 'high';
    else if (rep.score >= 40) sev = 'medium';
    else if (rep.score >= 20) sev = 'low';
    else sev = 'info';
    out.push(sig(`CP_${rep.tier.toUpperCase()}`, 'counterparty', sev, rep.score, rep.reason,
      [{ key: 'address', value: t }, { key: 'tier', value: rep.tier }, { key: 'labels', value: rep.labels.join(',') }]));
  }

  // Fan-out risk: sending to many distinct fresh addresses at once looks like a drain.
  const fresh = input.targets.filter((t) => {
    const r = input.reputation.get(t);
    return r && (r.tier === 'unknown' || r.tier === 'known');
  });
  if (fresh.length >= 3) {
    out.push(sig('CP_FANOUT', 'counterparty', 'high', 60 + Math.min(30, fresh.length * 5),
      `Transaction fans out to ${fresh.length} untrusted addresses at once`,
      [{ key: 'count', value: fresh.length }]));
  }

  return out;
}

// ── 3. Authority / control-plane changes ─────────────────────────────────────

const AUTHORITY_ACTIONS: Record<string, { score: number; reason: string }> = {
  wallet_transfer_ownership: { score: 100, reason: 'Transfers ownership of the agent wallet — full control handoff' },
  organization_deactivate:   { score: 92,  reason: 'Deactivates an organization — revokes all its agents at once' },
  credential_revoke:         { score: 78,  reason: 'Revokes an agent credential — removes on-chain authorization' },
  credential_accept_revoked_root: { score: 78, reason: 'Accepts a pending revoked-root proposal — completes a credential revocation' },
  credential_cancel_revoked_root: { score: 40, reason: 'Cancels a pending revoked-root proposal — no authorization change' },
  capability_revoke_grant:   { score: 70,  reason: 'Revokes a capability grant' },
  delegation_revoke:         { score: 62,  reason: 'Revokes a delegation edge' },
  wallet_execute_batch:      { score: 68,  reason: 'Batched arbitrary execution — broad blast radius' },
  wallet_execute:            { score: 55,  reason: 'Arbitrary contract execution from the agent wallet' },
  capability_register:       { score: 58,  reason: 'Registers a new capability — expands the action surface' },
  credential_issue:          { score: 50,  reason: 'Issues a credential — grants new on-chain authorization' },
  credential_accept_root:    { score: 50,  reason: 'Accepts a pending credential-root proposal — completes a credential issuance' },
  credential_cancel_root:    { score: 40,  reason: 'Cancels a pending credential-root proposal — no authorization change' },
  delegation_create:         { score: 48,  reason: 'Creates a delegation — extends authority to another party' },
  delegation_accept_root:    { score: 48,  reason: 'Accepts a pending delegation-root proposal — completes a delegation' },
  delegation_cancel_root:    { score: 40,  reason: 'Cancels a pending delegation-root proposal — no authorization change' },
  anchor_accept_root:        { score: 50,  reason: 'Accepts a pending organization-anchor-root proposal' },
  anchor_accept_revoked_root:{ score: 78,  reason: 'Accepts a pending organization-anchor revoked-root proposal' },
  anchor_cancel_root:        { score: 40,  reason: 'Cancels a pending organization-anchor-root proposal — no authorization change' },
  anchor_cancel_revoked_root:{ score: 40,  reason: 'Cancels a pending organization-anchor revoked-root proposal — no authorization change' },
  organization_register:     { score: 45,  reason: 'Registers a new organization (authority root)' },
  wallet_withdraw:           { score: 44,  reason: 'Withdraws gas deposit from the wallet' },
  session_create:            { score: 30,  reason: 'Creates a full session key' },
  session_create_lightweight:{ score: 24,  reason: 'Creates a lightweight session key' },
};

/**
 * Score the control-plane sensitivity of the action from the AUTHORITY_ACTIONS table (ownership transfer 100 down to lightweight session 24).
 * Why: some actions change who controls what — an ownership transfer is irreversible in a way a read never is, and the score must reflect that before value is even considered.
 * @param input - normalized risk input; only the normalized action and behavior (first-ever owner change) are read.
 * @returns Signals; AUTH_BENIGN (score 8) for actions absent from the table.
 * Maps to: contract SessionManager.createSession / AgentWallet.changeOwner (authority actions).
 */
export function assessAuthority(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const action = input.intent.normalizedAction;
  const entry = AUTHORITY_ACTIONS[action];

  if (entry) {
    let sev: RiskSeverity = 'medium';
    if (entry.score >= 90) sev = 'critical';
    else if (entry.score >= 60) sev = 'high';
    else if (entry.score >= 40) sev = 'medium';
    else sev = 'low';
    out.push(sig('AUTH_ACTION', 'authority', sev, entry.score, entry.reason,
      [{ key: 'action', value: action }]));
  } else {
    out.push(sig('AUTH_BENIGN', 'authority', 'info', 8,
      `Action "${action}" does not alter control or permissions`));
  }

  // First-ever ownership change for an agent that has a history is a red flag.
  if (action === 'wallet_transfer_ownership' && input.behavior.hasHistory && !input.behavior.everChangedOwner) {
    out.push(sig('AUTH_FIRST_OWNER_CHANGE', 'authority', 'critical', 40,
      'First-ever ownership change for an established agent'));
  }

  return out;
}

// ── 4. Behavioral deviation (velocity + anomaly) ─────────────────────────────

/**
 * Score deviation from the agent's own baseline: activity velocity (>3× daily average, ≥5 actions), value anomaly (>3× historical max, >5× mean), new counterparty for value, and failure clustering (≥3 failures/24h).
 * Why: an agent's own history is the best anomaly detector — a burst or an out-of-character transfer is the signal that credentials may be misused.
 * @param input - normalized risk input; behavior profile and economic view are read.
 * @returns Signals; BEHAV_NO_HISTORY (22) when there is no baseline, BEHAV_NORMAL (6) when nothing deviates.
 * Maps to: internal — buildBehavioralProfile (history source).
 */
export function assessBehavioral(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const b = input.behavior;

  if (!b.hasHistory) {
    out.push(sig('BEHAV_NO_HISTORY', 'behavioral', 'low', 22,
      'No behavioral baseline for this agent — cannot confirm normal pattern'));
    return out;
  }

  // Velocity: bursty activity relative to the agent's own 7d rate.
  const dailyAvg = b.actionCount7d / 7;
  if (b.actionCount24h > 0 && dailyAvg > 0 && b.actionCount24h > dailyAvg * 3 && b.actionCount24h >= 5) {
    out.push(sig('BEHAV_VELOCITY', 'behavioral', 'medium',
      Math.min(70, 30 + b.actionCount24h * 2),
      `Activity spike: ${b.actionCount24h} actions in 24h vs ${dailyAvg.toFixed(1)}/day baseline`,
      [{ key: 'count24h', value: b.actionCount24h }, { key: 'baseline', value: dailyAvg.toFixed(1) }]));
  }

  // Value anomaly: this transfer dwarfs the agent's historical max.
  try {
    const v = input.economic.valueWei;
    const max = BigInt(b.valueMax7dWei || '0');
    const mean = BigInt(b.valueMean7dWei || '0');
    if (v > 0n && max > 0n && v > max * 3n) {
      out.push(sig('BEHAV_VALUE_ANOMALY', 'behavioral', 'high', 75,
        'Transfer value is >3× the largest transfer this agent has ever made',
        [{ key: 'thisWei', value: v.toString() }, { key: 'max7dWei', value: max.toString() }]));
    } else if (v > 0n && mean > 0n && v > mean * 5n) {
      out.push(sig('BEHAV_VALUE_ELEVATED', 'behavioral', 'medium', 48,
        'Transfer value is >5× this agent’s mean transfer',
        [{ key: 'thisWei', value: v.toString() }, { key: 'mean7dWei', value: mean.toString() }]));
    }
  } catch {}

  // New counterparty for value transfer.
  const movingValue = input.economic.valueWei > 0n;
  const toNewParty = input.targets.some((t) => !b.seenTargets.includes(t));
  if (movingValue && toNewParty && input.targets.length > 0) {
    out.push(sig('BEHAV_NEW_COUNTERPARTY', 'behavioral', 'medium', 40,
      'Moving value to a counterparty the agent has never paid before'));
  }

  // Recent failure clustering — possible probing / misconfiguration / attack.
  if (b.failedCount24h >= 3) {
    out.push(sig('BEHAV_FAILURE_CLUSTER', 'behavioral', 'medium',
      Math.min(60, 20 + b.failedCount24h * 8),
      `${b.failedCount24h} failed actions in the last 24h`,
      [{ key: 'failed24h', value: b.failedCount24h }]));
  }

  if (out.length === 0) {
    out.push(sig('BEHAV_NORMAL', 'behavioral', 'info', 6, 'Consistent with the agent’s established pattern'));
  }
  return out;
}

// ── 5. Policy proximity / breach ─────────────────────────────────────────────

/**
 * Score proximity to and breach of effective policy limits: value over maxValue (critical 95), value ≥90% of ceiling, targets off the allowlist (80), batch over cap (70), unresolved conflicts.
 * Why: policy is the operator's stated boundary — crossing it is not a heuristic, it is a violation, and nearing it deserves a warning before the breach happens.
 * @param input - normalized risk input; policy.effectiveLimits is read.
 * @returns Signals; POLICY_NONE (20) when no policy resolved, POLICY_WITHIN (8) when comfortably inside.
 * Maps to: policy rule spend-cap / target allowlist / batch cap.
 */
export function assessPolicy(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const limits = input.policy?.effectiveLimits;
  if (!limits) {
    out.push(sig('POLICY_NONE', 'policy', 'low', 20, 'No effective policy limits resolved for this plan'));
    return out;
  }

  // Value vs maxValue.
  try {
    const max = BigInt(limits.maxValue || '0');
    const v = input.economic.valueWei;
    if (max > 0n && v > 0n) {
      if (v > max) {
        out.push(sig('POLICY_VALUE_BREACH', 'policy', 'critical', 95,
          'Transfer value exceeds the effective policy maxValue',
          [{ key: 'valueWei', value: v.toString() }, { key: 'maxValueWei', value: max.toString() }]));
      } else {
        const ratio = Number((v * 100n) / max);
        if (ratio >= 90) {
          out.push(sig('POLICY_VALUE_NEAR', 'policy', 'medium', 45,
            `Transfer uses ${ratio}% of the policy value ceiling`,
            [{ key: 'pct', value: ratio }]));
        }
      }
    }
  } catch {}

  // Target allowlist.
  if (limits.allowedTargets && limits.allowedTargets.length > 0) {
    const allow = new Set(limits.allowedTargets.map((a) => a.toLowerCase()));
    const offlist = input.targets.filter((t) => !allow.has(t));
    if (offlist.length > 0) {
      out.push(sig('POLICY_TARGET_OFFLIST', 'policy', 'high', 80,
        `${offlist.length} target(s) not on the policy allowlist`,
        [{ key: 'offlist', value: offlist.join(',') }]));
    }
  }

  // Batch size vs cap.
  if (input.economic.isBatch && limits.maxBatchSize && input.economic.batchSize > limits.maxBatchSize) {
    out.push(sig('POLICY_BATCH_BREACH', 'policy', 'high', 70,
      `Batch of ${input.economic.batchSize} exceeds max batch size ${limits.maxBatchSize}`));
  }

  // Policy conflicts detected upstream.
  if (input.policy?.conflicts && input.policy.conflicts.length > 0) {
    out.push(sig('POLICY_CONFLICT', 'policy', 'medium', 40,
      `${input.policy.conflicts.length} unresolved policy conflict(s)`));
  }

  if (out.length === 0) {
    out.push(sig('POLICY_WITHIN', 'policy', 'info', 8, 'Comfortably within effective policy limits'));
  }
  return out;
}

// ── 6. Simulation outcome ────────────────────────────────────────────────────

/**
 * Score the dry-run outcome: a predicted revert is critical (100), an unconfirmed simulation is high (60), skipped/absent simulation is low (18–20), gas >2M is medium (35).
 * Why: a transaction the chain says will revert must never be approved on hope — simulation is the only pre-execution ground truth.
 * @param input - normalized risk input; simulation result is read.
 * @returns Signals; SIM_OK (5) when simulation succeeded cleanly.
 * Maps to: contract eth_call dry-run (stage-7 simulation).
 */
export function assessSimulation(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const sim = input.simulation;

  if (!sim) {
    out.push(sig('SIM_ABSENT', 'simulation', 'low', 20, 'Plan was not simulated before assessment'));
    return out;
  }

  const skipped = sim.warnings.some((w) => /skipped|disabled|no provider/i.test(w));
  if (skipped && sim.steps.length === 0) {
    out.push(sig('SIM_SKIPPED', 'simulation', 'low', 18,
      'Simulation was skipped — outcome not verified on-chain'));
    return out;
  }

  const reverted = sim.steps.filter((s) => s.reverted);
  if (reverted.length > 0) {
    out.push(sig('SIM_REVERT', 'simulation', 'critical', 100,
      `Simulation reverted (${reverted.length} step(s)) — the transaction is expected to fail`,
      [{ key: 'revertReason', value: reverted[0].revertReason || 'unknown' }]));
    return out;
  }

  if (!sim.success && sim.errors.length > 0) {
    out.push(sig('SIM_ERROR', 'simulation', 'high', 60,
      `Simulation could not confirm success: ${sim.errors[0]}`));
  }

  // Gas anomaly — unusually high gas can indicate an unexpected/complex path.
  const gas = sim.totalGasEstimate;
  if (gas) {
    try {
      const limit = BigInt(gas.gasLimit || '0');
      if (limit > 2_000_000n) {
        out.push(sig('SIM_GAS_HIGH', 'simulation', 'medium', 35,
          `Estimated gas ${limit.toString()} is unusually high for a single plan`,
          [{ key: 'gasLimit', value: limit.toString() }]));
      }
    } catch {}
  }

  if (out.length === 0) {
    out.push(sig('SIM_OK', 'simulation', 'info', 5, 'Simulation succeeded with no reverts'));
  }
  return out;
}

// ── 7. Temporal / replay ─────────────────────────────────────────────────────

/**
 * Score intent age and expiry: >900s old is medium (55, replay/state-drift risk), >300s low (30), an already-past expiry is high (60).
 * Why: a stale intent may execute against state that no longer matches what was approved — age is a replay vector.
 * @param input - normalized risk input; nowUnix vs requestedAt and limits.expiry are read.
 * @returns Signals; TEMP_FRESH (4) for intents ≤300s old. Always returns at least one signal.
 * Maps to: internal — RiskEngineCore.assess (nowUnix).
 */
export function assessTemporal(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const age = input.nowUnix - input.intent.requestedAt;

  if (age > 900) {
    out.push(sig('TEMP_STALE', 'temporal', 'medium', 55,
      `Intent is ${age}s old — high replay/state-drift risk`, [{ key: 'ageSec', value: age }]));
  } else if (age > 300) {
    out.push(sig('TEMP_AGING', 'temporal', 'low', 30,
      `Intent is ${age}s old — consider recompiling against current state`));
  } else {
    out.push(sig('TEMP_FRESH', 'temporal', 'info', 4, 'Fresh intent'));
  }

  // Expiry sanity.
  const expiry = input.intent.limits?.expiry;
  if (expiry && expiry <= input.nowUnix) {
    out.push(sig('TEMP_EXPIRED', 'temporal', 'high', 60, 'Intent expiry is already in the past'));
  }

  return out;
}

// ── 8. Capability coverage ───────────────────────────────────────────────────

/**
 * Score capability coverage: missing required capabilities are high (70), actions needing delegation are medium (40).
 * Why: a plan the agent is not authorized to run should not reach an approver as if it were ready — missing capability is a readiness failure, not a detail.
 * @param input - normalized risk input; capabilities.canExecute/missingExplicit/mustDelegate are read.
 * @returns Signals; CAP_OK (6) when fully covered, CAP_PARTIAL (35) when uncovered but nothing is explicitly missing.
 * Maps to: contract CredentialRegistry / CapabilityRegistry (grant source).
 */
export function assessCapability(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];
  const caps = input.capabilities;

  if (caps.canExecute && caps.missingExplicit.length === 0) {
    out.push(sig('CAP_OK', 'capability', 'info', 6, 'All required capabilities are satisfied'));
    return out;
  }

  if (caps.missingExplicit.length > 0) {
    out.push(sig('CAP_MISSING', 'capability', 'high', 70,
      `Missing required capabilities: ${caps.missingExplicit.join(', ')}`,
      [{ key: 'missing', value: caps.missingExplicit.join(',') }]));
  }

  if (caps.mustDelegate && caps.mustDelegate.length > 0) {
    out.push(sig('CAP_MUST_DELEGATE', 'capability', 'medium', 40,
      `Action requires delegation for: ${caps.mustDelegate.join(', ')}`));
  }

  if (out.length === 0) {
    out.push(sig('CAP_PARTIAL', 'capability', 'medium', 35, 'Partial capability coverage'));
  }
  return out;
}

// ── 9. Compliance / structuring ──────────────────────────────────────────────

/**
 * Score compliance: a blocked counterparty is a hard critical stop (100), and value just under a round threshold ($1k/$10k) amid bursty activity flags structuring (45).
 * Why: sanctions are not a scoring nuance — a blocked counterparty forces DENY via the scoring override, and structuring is the evasion shape that thresholds alone miss.
 * @param input - normalized risk input; targets/reputation, notional and behavior are read.
 * @returns Signals; COMP_CLEAR (3) when no flag fires.
 * Maps to: event COMP_BLOCKED (scoring override forces DENY).
 */
export function assessCompliance(input: RiskInput): RiskSignal[] {
  const out: RiskSignal[] = [];

  // Blocked counterparty is a hard compliance stop.
  const blocked = input.targets.filter((t) => input.reputation.get(t)?.tier === 'blocked');
  if (blocked.length > 0) {
    out.push(sig('COMP_BLOCKED', 'compliance', 'critical', 100,
      'Counterparty is on the operator blocklist (sanctions / known-malicious)',
      [{ key: 'addresses', value: blocked.join(',') }]));
  }

  // Structuring heuristic: value just under a round threshold while agent is bursty.
  const usd = input.economic.notionalUsd;
  if (usd > 0 && input.behavior.hasHistory) {
    const nearUnder = (limit: number) => usd >= limit * 0.9 && usd < limit;
    if ((nearUnder(10_000) || nearUnder(1_000)) && input.behavior.actionCount24h >= 3) {
      out.push(sig('COMP_STRUCTURING', 'compliance', 'medium', 45,
        `Value $${usd.toFixed(0)} sits just under a round reporting threshold amid repeated activity`));
    }
  }

  if (out.length === 0) {
    out.push(sig('COMP_CLEAR', 'compliance', 'info', 3, 'No compliance flags'));
  }
  return out;
}

/** All assessors in dimension order. */
export const ASSESSORS: ((input: RiskInput, ctx: RiskContext) => RiskSignal[])[] = [
  assessValue,
  assessCounterparty,
  assessAuthority,
  assessBehavioral,
  assessPolicy,
  assessSimulation,
  assessTemporal,
  assessCapability,
  assessCompliance,
];
