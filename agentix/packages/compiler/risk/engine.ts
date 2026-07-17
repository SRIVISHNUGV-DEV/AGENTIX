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

  constructor(
    config: RiskEngineConfig | undefined,
    private plugins?: PluginRegistry
  ) {
    this.cfg = { ...DEFAULT_RISK_CONFIG, ...(config || {}) };
  }

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

  private computeConfidence(input: RiskInput): number {
    let c = 0.5;
    if (input.behavior.hasHistory) c += 0.2;
    if (input.simulation && input.simulation.steps.length > 0) c += 0.15;
    if (input.economic.notionalUsd > 0) c += 0.1;
    if (input.policy?.effectiveLimits) c += 0.05;
    return Math.min(1, Number(c.toFixed(2)));
  }

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

function weiToEth(wei: bigint): number {
  // Convert with 6 significant fractional digits without floating errors on huge values.
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = wei % 1_000_000_000_000_000_000n;
  return Number(whole) + Number(frac) / 1e18;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function timeout(ms: number): Promise<'TIMEOUT'> {
  return new Promise((r) => setTimeout(() => r('TIMEOUT'), ms));
}

function emptyBehavior() {
  return {
    hasHistory: false, actionCount24h: 0, actionCount7d: 0, failedCount24h: 0,
    distinctTargets7d: 0, valueMean7dWei: '0', valueMax7dWei: '0', spent24hWei: '0',
    lastActionAt: 0, seenTargets: [] as string[], everChangedOwner: false,
  };
}
