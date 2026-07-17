// ─────────────────────────────────────────────────────────────────────────────
// AgentIX Risk Engine — type model
//
// The risk engine is the decisioning core of the compiler. It converts a parsed
// intent (plus resolved capabilities, generated policy and simulation results)
// into a structured, explainable risk verdict.
//
// Design goals:
//   • Backward compatible — every field the old engine emitted is still present
//     (score, category, factors, warnings, suggestions, requiresApproval).
//   • Multi-dimensional — risk is decomposed into orthogonal dimensions, each
//     independently scored, bounded and explained.
//   • Explainable — every point of score is traceable to a signal with evidence.
//   • Actionable — the engine emits a decision, required controls and mitigations,
//     not just a number.
// ─────────────────────────────────────────────────────────────────────────────

export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'AUTHORITY';

/**
 * Terminal decision the engine recommends for a plan. This is a superset of the
 * legacy `requiresApproval` boolean and is what a policy enforcer should switch on.
 */
export type RiskDecision =
  | 'ALLOW'            // within policy, auto-executable
  | 'ALLOW_WITH_CONTROLS' // executable but attach controls (e.g. rate cap, monitor)
  | 'REVIEW'           // hold for human/owner approval
  | 'CHALLENGE'        // require step-up auth (fresh signature / MFA / ZK proof)
  | 'DENY';            // block outright

/**
 * Orthogonal axes of risk. Each dimension is scored 0–100 independently, capped,
 * then aggregated. Adding a dimension never silently dilutes the others because
 * aggregation is dominance-aware (see scoring.ts).
 */
export type RiskDimension =
  | 'value'          // economic magnitude / notional at stake
  | 'counterparty'   // trust in the target address(es)
  | 'authority'      // does the action change control/permissions/ownership
  | 'behavioral'     // deviation from the agent's historical pattern (velocity/anomaly)
  | 'policy'         // proximity to / breach of owner policy & effective limits
  | 'simulation'     // what the on-chain dry-run revealed (reverts, gas, state)
  | 'temporal'       // freshness, expiry, replay window
  | 'capability'     // is the action actually authorized by held capabilities
  | 'compliance';    // sanctioned/blocklisted counterparties, structuring, etc.

export const RISK_DIMENSIONS: RiskDimension[] = [
  'value', 'counterparty', 'authority', 'behavioral',
  'policy', 'simulation', 'temporal', 'capability', 'compliance',
];

export type RiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/**
 * A single piece of evidence backing a signal — keeps the assessment auditable.
 */
export interface RiskEvidence {
  key: string;
  value: string | number | boolean;
}

/**
 * A signal is one atomic observation contributing to a dimension's score.
 * Many signals roll up into a RiskFactor (one per dimension).
 */
export interface RiskSignal {
  code: string;              // stable machine code e.g. VALUE_HIGH_NOTIONAL
  dimension: RiskDimension;
  severity: RiskSeverity;
  score: number;             // 0–100 contribution within its dimension
  reason: string;            // human explanation
  evidence?: RiskEvidence[];
}

/**
 * RiskFactor — one per dimension. Backward-compatible with the legacy shape
 * (`name`, `weight`, `score`, `reason` are all still present and populated).
 */
export interface RiskFactor {
  name: string;              // legacy: dimension name (e.g. "value_transfer")
  weight: number;            // legacy: dimension weight used in aggregation
  score: number;             // legacy: 0–100 dimension score
  reason: string;            // legacy: dominant reason
  dimension?: RiskDimension; // new: machine axis
  signals?: RiskSignal[];    // new: contributing signals with evidence
  capped?: boolean;          // new: true if dimension hit its hard cap
}

export interface RiskWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface RiskSuggestion {
  code: string;
  message: string;
  mitigation: string;
}

/**
 * A concrete control the enforcer can attach to make an otherwise-risky plan
 * acceptable (returned when decision === ALLOW_WITH_CONTROLS or CHALLENGE).
 */
export interface RiskControl {
  code: string;
  type: 'require_signature' | 'require_zk_proof' | 'rate_limit' | 'value_cap'
      | 'time_lock' | 'monitor' | 'split_transaction' | 'whitelist_only';
  description: string;
  params?: Record<string, unknown>;
}

export interface RiskAssessment {
  // ── legacy surface (unchanged) ───────────────────────────────────────────
  score: number;                 // 0–100 aggregate
  category: RiskCategory;
  factors: RiskFactor[];
  warnings: RiskWarning[];
  suggestions: RiskSuggestion[];
  requiresApproval: boolean;

  // ── new surface (all optional so old consumers keep working) ─────────────
  decision?: RiskDecision;
  confidence?: number;           // 0–1, how much data backed the assessment
  dimensionScores?: Partial<Record<RiskDimension, number>>;
  signals?: RiskSignal[];        // flattened, sorted by score desc
  controls?: RiskControl[];      // controls to attach for ALLOW_WITH_CONTROLS/CHALLENGE
  topDrivers?: string[];         // human summary of what moved the needle
  notionalUsd?: number;          // best-effort USD value at stake
  assessedAt?: number;           // unix seconds
  engineVersion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds & tunables
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_THRESHOLDS = {
  LOW_MAX: 25,
  MEDIUM_MAX: 50,
  HIGH_MAX: 75,
  DEFAULT_APPROVAL_THRESHOLD: 75,
} as const;

/**
 * Decision bands. A plan's decision is the *most severe* of:
 *   (a) the band its aggregate score falls into, and
 *   (b) any hard override raised by a signal (e.g. sanctioned counterparty ⇒ DENY).
 */
export const DECISION_BANDS: { max: number; decision: RiskDecision }[] = [
  { max: 25, decision: 'ALLOW' },
  { max: 50, decision: 'ALLOW_WITH_CONTROLS' },
  { max: 75, decision: 'REVIEW' },
  { max: 90, decision: 'CHALLENGE' },
  { max: 100, decision: 'DENY' },
];

/**
 * Default per-dimension weights. Sum need not be 1 — aggregation normalizes.
 * These are overridable via compiler config (`risk.weights`).
 */
export const DEFAULT_DIMENSION_WEIGHTS: Record<RiskDimension, number> = {
  value: 0.20,
  counterparty: 0.16,
  authority: 0.16,
  behavioral: 0.12,
  policy: 0.14,
  simulation: 0.10,
  temporal: 0.04,
  capability: 0.05,
  compliance: 0.03,
};

/**
 * Hard caps: the maximum a single dimension can contribute to the *pre-dominance*
 * weighted mean. Prevents one noisy axis from saturating the score while still
 * letting the dominance term (scoring.ts) surface a single critical signal.
 */
export const DIMENSION_CAPS: Record<RiskDimension, number> = {
  value: 100,
  counterparty: 100,
  authority: 100,
  behavioral: 90,
  policy: 100,
  simulation: 100,
  temporal: 60,
  capability: 100,
  compliance: 100,
};

export const RISK_ENGINE_VERSION = '2.0.0';
