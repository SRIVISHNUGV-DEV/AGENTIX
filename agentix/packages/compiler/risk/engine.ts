// ─────────────────────────────────────────────────────────────────────────────
// RiskEngine (v2) — orchestrator
//
// Pipeline per assessment:
//   1. Build the normalized RiskInput (targets, economic view, behavior, reputation).
//   2. Enrich reputation on-chain (best-effort, bounded).
//   3. Run all dimension assessors → signals.
//   4. Run configured risk-rule plugins → extra signals.
//   5. Score → factors, aggregate, decision, controls.
//   6. Assemble a backward-compatible RiskAssessment.
//
// The engine is deterministic given its inputs except for optional network
// enrichment, which is time-bounded and degrades to heuristics on failure.
// ─────────────────────────────────────────────────────────────────────────────

import { ParsedIntent } from '../types/intent';
import { ResolvedCapabilities } from '../types/capability';
import { OptimizedPolicy } from '../types/policy';
import { SimulationResult } from '../types/simulation';
import { RiskEngineConfig } from '../types/compilation';
import {
  RiskAssessment, RiskSignal, RISK_ENGINE_VERSION,
} from '../types/risk';
import {
  RiskInput, RiskContext, EconomicView, AddressReputation,
  extractTargets, computeValue,
} from './context';
import { ReputationResolver } from './reputation';
import { buildBehavioralProfile } from './history';
import { ASSESSORS } from './signals';
import { score } from './scoring';
import { PluginRegistry } from '../plugins/registry';
import { RiskRulePlugin } from '../types/plugin';

const DEFAULT_RISK_CONFIG: RiskEngineConfig = {
  approvalThreshold: 75,
  denyThreshold: 90,
  weights: {},
  behavioralEnabled: true,
  notionalEnabled: true,
  trustedAddresses: [],
  blockedAddresses: [],
};

export interface RiskEngineInputs {
  intent: ParsedIntent;
  capabilities: ResolvedCapabilities;
  policy?: OptimizedPolicy;
  simulation?: SimulationResult;
}

export class RiskEngineCore {
  private cfg: RiskEngineConfig;

    /**
     * Build the risk engine core, merging caller config over the defaults.
     * Why: thresholds/weights are operator policy — defaults (approval 75, deny 90) apply unless the operator overrides them.
     * @param config - optional risk config; undefined means all defaults.
     * @param plugins - optional registry for 'risk-rule' plugins; omitted means no plugin signals.
     * Maps to: internal — RiskEngine (stage-8 adapter) constructor.
     */
  constructor(
    config: RiskEngineConfig | undefined,
    private plugins?: PluginRegistry
  ) {
    this.cfg = { ...DEFAULT_RISK_CONFIG, ...(config || {}) };
  }

  /**
   * Assess a parsed intent end to end: behavior profile, economic view, reputation, dimension signals, plugin rules, scoring and decision.
   * Why: this is the single risk entry point — the pipeline calls it once per compile and the returned decision drives APPROVAL_REQUIRED vs APPROVED.
   * @param inputs - intent, capabilities, and optional policy/simulation (omitting them degrades gracefully: policy and simulation dimensions emit "absent" signals).
   * @returns RiskAssessment with legacy score/category plus decision, confidence, dimension scores, signals, controls and top drivers. requiresApproval is true on REVIEW/CHALLENGE/DENY or score >= approvalThreshold.
   * @throws Never for bad input; assessor and plugin failures are swallowed per-assessor.
   * Side effects: reads local action history and (bounded, 1.5s) on-chain reputation enrichment; fetches the ETH price with a 1.2s timeout.
   * Maps to: event RiskAssessed (plan risk outcome); policy rule spend-cap via the policy dimension.
   */
  async assess(inputs: RiskEngineInputs): Promise<RiskAssessment> {
    const now = Math.floor(Date.now() / 1000);
    const { intent, capabilities, policy, simulation } = inputs;

    // 1. Behavioral profile (optional).
    const wallet = intent.agent?.walletAddress || (intent.params?.walletAddress as string) || '';
    const behavior = this.cfg.behavioralEnabled
      ? safe(() => buildBehavioralProfile(wallet, now), emptyBehavior())
      : emptyBehavior();

    // 2. Economic view.
    const { total: valueWei, isBatch, batchSize } = computeValue(intent);
    const ethPriceUsd = this.cfg.notionalEnabled ? await this.getEthPrice() : 0;
    const valueEth = weiToEth(valueWei);
    const economic: EconomicView = {
      valueWei,
      valueEth,
      notionalUsd: ethPriceUsd > 0 ? valueEth * ethPriceUsd : 0,
      isBatch,
      batchSize,
      batchTotalWei: valueWei,
    };

    // 3. Targets + reputation.
    const targets = extractTargets(intent);
    const resolver = new ReputationResolver(this.cfg);
    const reputation = new Map<string, AddressReputation>();
    for (const t of targets) reputation.set(t, resolver.resolve(t, behavior));
    // Bounded on-chain enrichment of unknown addresses.
    await this.enrichReputation(resolver, reputation);

    const input: RiskInput = {
      intent, capabilities, policy, simulation,
      targets, economic, behavior, reputation, nowUnix: now,
    };
    const ctx: RiskContext = { config: this.cfg, ethPriceUsd };

    // 4. Run dimension assessors.
    let signals: RiskSignal[] = [];
    for (const assessor of ASSESSORS) {
      try { signals.push(...assessor(input, ctx)); } catch {}
    }

    // 5. Plugin risk rules (now actually wired into the dimension model).
    signals = signals.concat(await this.runPlugins(intent, input));

    // 6. Score & decide.
    const result = score(signals, this.cfg.weights, {
      approval: this.cfg.approvalThreshold,
      deny: this.cfg.denyThreshold,
    });

    const confidence = this.computeConfidence(input);
    const requiresApproval =
      result.decision === 'REVIEW' ||
      result.decision === 'CHALLENGE' ||
      result.decision === 'DENY' ||
      result.score >= this.cfg.approvalThreshold;

    return {
      // legacy surface
      score: result.score,
      category: result.category,
      factors: result.factors,
      warnings: result.warnings,
      suggestions: result.suggestions,
      requiresApproval,
      // new surface
      decision: result.decision,
      confidence,
      dimensionScores: result.dimensionScores,
      signals: result.signals,
      controls: result.controls,
      topDrivers: result.topDrivers,
      notionalUsd: economic.notionalUsd || undefined,
      assessedAt: now,
      engineVersion: RISK_ENGINE_VERSION,
    };
  }

  /**
   * Run configured risk-rule plugins and convert their factors into risk signals.
   * Why: operators extend the risk model without forking the engine — plugin factors become ordinary 'policy'-dimension signals.
   * @param intent - parsed intent (passed to plugins as a plain record).
   * @param input - normalized risk input (targets, value, notional).
   * @returns Plugin signals (scores clamped to 0–100, severity from score bands); empty array when no registry or no plugins; failing plugins are skipped.
   * Maps to: internal — RiskEngineCore.assess (step 5).
   */
  private async runPlugins(intent: ParsedIntent, input: RiskInput): Promise<RiskSignal[]> {
    if (!this.plugins) return [];
    const out: RiskSignal[] = [];
    const riskPlugins = this.plugins.getByType('risk-rule') as RiskRulePlugin[];
    for (const plugin of riskPlugins) {
      try {
        const res = await plugin.assessRisk(intent as unknown as Record<string, unknown>, {
          targets: input.targets,
          valueWei: input.economic.valueWei.toString(),
          notionalUsd: input.economic.notionalUsd,
        });
        for (const f of res.factors) {
          out.push({
            code: `PLUGIN_${plugin.name.toUpperCase()}_${f.name.toUpperCase()}`.replace(/[^A-Z0-9_]/g, '_'),
            dimension: 'policy',
            severity: f.score >= 75 ? 'high' : f.score >= 40 ? 'medium' : 'low',
            score: Math.max(0, Math.min(100, f.score)),
            reason: `${plugin.name}: ${f.reason}`,
          });
        }
      } catch {}
    }
    return out;
  }

  /**
   * Enrich unknown-address reputations with on-chain data (EOA vs contract, nonce), bounded to 1.5s total.
   * Why: enrichment is a network call that must never block the pipeline — the race lets the assessment proceed with heuristic reputations on timeout.
   * @param resolver - reputation resolver that performs the enrichment.
   * @param reputation - map mutated in place with enriched entries.
   * @returns Resolves when enrichment finishes or the 1.5s bound hits, whichever comes first.
   * Side effects: mutates the reputation map; performs getCode/getTransactionCount RPCs.
   * Maps to: internal — RiskEngineCore.assess (step 3).
   */
  private async enrichReputation(
    resolver: ReputationResolver,
    reputation: Map<string, AddressReputation>
  ): Promise<void> {
    const unknowns = [...reputation.values()].filter((r) => r.tier === 'unknown');
    if (unknowns.length === 0) return;
    // Bound total enrichment time so risk assessment never blocks the pipeline.
    const enrichAll = Promise.all(
      unknowns.map(async (r) => {
        const enriched = await resolver.enrich(r);
        reputation.set(r.address, enriched);
      })
    );
    await Promise.race([enrichAll, timeout(1500)]);
  }

  /**
   * Score how much evidence backed this assessment (0.5 base, +history, +simulation, +notional, +policy, capped at 1).
   * Why: a high risk score from thin evidence should read differently from the same score with full context — confidence is the "how sure" alongside the "how bad".
   * @param input - normalized risk input.
   * @returns Confidence in [0.5, 1], rounded to 2 decimals.
   * Maps to: internal — RiskEngineCore.assess.
   */
  private computeConfidence(input: RiskInput): number {
    let c = 0.5;
    if (input.behavior.hasHistory) c += 0.2;
    if (input.simulation && input.simulation.steps.length > 0) c += 0.15;
    if (input.economic.notionalUsd > 0) c += 0.1;
    if (input.policy?.effectiveLimits) c += 0.05;
    return Math.min(1, Number(c.toFixed(2)));
  }

  /**
   * Fetch the current ETH/USD price for notional scoring, with a 1.2s timeout.
   * Why: USD notional tiers are the primary value signal when a price is available; without one the engine falls back to ETH tiers.
   * @returns Price in USD, or 0 when unavailable, non-positive, timed out, or the oracle module cannot be required.
   * Side effects: one price-oracle call (network).
   * Maps to: internal — RiskEngineCore.assess (economic view).
   */
  private async getEthPrice(): Promise<number> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getEthUsdPrice } = require('../../../src/core/price-oracle');
      const p = await Promise.race([getEthUsdPrice(), timeout(1200)]);
      return typeof p === 'number' && p > 0 ? p : 0;
    } catch {
      return 0;
    }
  }
}

// ── small utils ──────────────────────────────────────────────────────────────

/**
 * Convert wei to ETH as a float, keeping 6 fractional digits of precision without floating error on huge values.
 * Why: notional math needs a float, but Number(wei)/1e18 loses precision above 2^53 — splitting whole and fractional parts avoids that.
 * @param wei - value in wei (bigint).
 * @returns ETH as a number.
 * Maps to: internal — RiskEngineCore.assess (economic view).
 */
function weiToEth(wei: bigint): number {
  // Convert with 6 significant fractional digits without floating errors on huge values.
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = wei % 1_000_000_000_000_000_000n;
  return Number(whole) + Number(frac) / 1e18;
}

/**
 * Run `fn`, returning `fallback` when it throws.
 * Why: the behavioral-profile build must never take down an assessment — a DB failure degrades to "no history", not a crash.
 * @param fn - function to attempt.
 * @param fallback - value returned when fn throws.
 * @returns fn()'s result, or fallback.
 * Maps to: internal — RiskEngineCore.assess.
 */
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/**
 * Resolve with 'TIMEOUT' after `ms` milliseconds.
 * Why: the race partner for bounded network calls (reputation enrichment, price oracle).
 * @param ms - timeout in milliseconds.
 * @returns A promise resolving to the literal 'TIMEOUT'.
 * Maps to: internal — RiskEngineCore.enrichReputation / getEthPrice.
 */
function timeout(ms: number): Promise<'TIMEOUT'> {
  return new Promise((r) => setTimeout(() => r('TIMEOUT'), ms));
}

/**
 * Build the zeroed behavioral profile used when history is disabled or unavailable.
 * Why: one factory for the "no history" case keeps assess() from scattering EMPTY_PROFILE literals — every field 0/false and hasHistory false.
 * @returns A fresh BehavioralProfile-shaped object with hasHistory false.
 * Maps to: internal — RiskEngineCore.assess; risk/context EMPTY_PROFILE.
 */
function emptyBehavior() {
  return {
    hasHistory: false, actionCount24h: 0, actionCount7d: 0, failedCount24h: 0,
    distinctTargets7d: 0, valueMean7dWei: '0', valueMax7dWei: '0', spent24hWei: '0',
    lastActionAt: 0, seenTargets: [] as string[], everChangedOwner: false,
  };
}
