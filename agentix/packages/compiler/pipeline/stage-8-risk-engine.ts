// ─────────────────────────────────────────────────────────────────────────────
// Pipeline stage 8 — Risk Engine (adapter)
//
// This stage is a thin adapter over the modular risk engine in ../risk. It keeps
// the historical `assess(intent, capabilities)` signature (so existing callers
// and the pipeline don't break) while adding optional `policy` and `simulation`
// arguments so the engine can reason about policy proximity and on-chain dry-run
// outcomes. The heavy lifting — signals, reputation, behavioral history, scoring,
// decisioning — lives in the ../risk module and is unit-testable in isolation.
// ─────────────────────────────────────────────────────────────────────────────

import { ParsedIntent } from '../types/intent';
import { ResolvedCapabilities } from '../types/capability';
import { OptimizedPolicy } from '../types/policy';
import { SimulationResult } from '../types/simulation';
import { RiskAssessment } from '../types/risk';
import { PluginRegistry } from '../plugins/registry';
import { CompilerConfig } from '../types/compilation';
import { RiskEngineCore } from '../risk/engine';

export class RiskEngine {
  private core: RiskEngineCore;

  /**
   * Build the stage-8 adapter over the modular risk engine.
   * Why: the pipeline keeps its historical assess() signature while the real scoring lives in ../risk; the adapter just wires config + plugins into RiskEngineCore.
   * @param plugins - registry consulted for 'risk-rule' plugins.
   * @param config - compiler config; config.risk carries thresholds, weights and address lists.
   * Maps to: internal — RiskEngineCore constructor.
   */
  constructor(private plugins: PluginRegistry, private config: CompilerConfig) {
    this.core = new RiskEngineCore(config.risk, plugins);
  }

  /**
   * Assess the risk of a parsed intent via the modular risk engine.
   * Why: the pipeline keeps this historical assess(intent, capabilities) signature so existing callers do not break, while the optional policy and simulation arguments unlock the policy and simulation dimensions.
   * @param intent - the parsed intent.
   * @param capabilities - resolved capabilities for the acting agent.
   * @param policy - optional optimized policy; enables the policy dimension (value-ceiling proximity, allowlist, batch caps, conflicts).
   * @param simulation - optional simulation result; enables the simulation dimension (revert prediction, gas anomaly).
   * @returns The full RiskAssessment (score, category, decision, signals, controls); never throws for bad input — assessor failures degrade to neutral signals.
   * Maps to: internal — RiskEngineCore.assess.
   */
  async assess(
    intent: ParsedIntent,
    capabilities: ResolvedCapabilities,
    policy?: OptimizedPolicy,
    simulation?: SimulationResult
  ): Promise<RiskAssessment> {
    return this.core.assess({ intent, capabilities, policy, simulation });
  }
}
