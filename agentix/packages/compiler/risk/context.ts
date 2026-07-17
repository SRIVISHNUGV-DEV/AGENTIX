// ─────────────────────────────────────────────────────────────────────────────
// RiskInput / RiskContext
//
// A normalized, side-effect-free view of everything the risk engine needs to
// reason about a plan. Assembled once by the engine and passed to every signal
// assessor, so assessors never touch the DB, network or global state directly —
// they're pure functions of (input, context). That makes them trivially testable.
// ─────────────────────────────────────────────────────────────────────────────

import { ParsedIntent } from '../types/intent';
import { ResolvedCapabilities } from '../types/capability';
import { OptimizedPolicy } from '../types/policy';
import { SimulationResult } from '../types/simulation';
import { RiskEngineConfig } from '../types/compilation';

/**
 * Behavioral history for the acting wallet, summarized to the numbers the
 * behavioral assessor needs. Populated by risk/history.ts; when history is
 * unavailable every field is 0 and `hasHistory` is false.
 */
export interface BehavioralProfile {
  hasHistory: boolean;
  actionCount24h: number;
  actionCount7d: number;
  failedCount24h: number;
  distinctTargets7d: number;
  valueMean7dWei: string;   // mean per-tx value over 7d
  valueMax7dWei: string;    // largest single tx over 7d
  spent24hWei: string;      // successful value moved in last 24h
  lastActionAt: number;     // unix seconds, 0 if none
  seenTargets: string[];    // lowercased targets the agent has transacted with
  everChangedOwner: boolean;
}

export const EMPTY_PROFILE: BehavioralProfile = {
  hasHistory: false,
  actionCount24h: 0,
  actionCount7d: 0,
  failedCount24h: 0,
  distinctTargets7d: 0,
  valueMean7dWei: '0',
  valueMax7dWei: '0',
  spent24hWei: '0',
  lastActionAt: 0,
  seenTargets: [],
  everChangedOwner: false,
};

/**
 * Reputation verdict for a single counterparty address.
 */
export interface AddressReputation {
  address: string;
  tier: 'system' | 'trusted' | 'known' | 'seen' | 'unknown' | 'flagged' | 'blocked';
  score: number;          // 0 (fully trusted) – 100 (maximally risky)
  labels: string[];       // e.g. ["agentix-core","eoa","new-address"]
  reason: string;
}

/**
 * Normalized economic view of the intent.
 */
export interface EconomicView {
  valueWei: bigint;
  valueEth: number;
  notionalUsd: number;     // 0 when price unavailable / notional disabled
  isBatch: boolean;
  batchSize: number;
  batchTotalWei: bigint;
}

export interface RiskInput {
  intent: ParsedIntent;
  capabilities: ResolvedCapabilities;
  policy?: OptimizedPolicy;
  simulation?: SimulationResult;
  /** All counterparty addresses referenced by the intent (lowercased, de-duped). */
  targets: string[];
  economic: EconomicView;
  behavior: BehavioralProfile;
  /** Per-target reputation, keyed by lowercased address. */
  reputation: Map<string, AddressReputation>;
  nowUnix: number;
}

export interface RiskContext {
  config: RiskEngineConfig;
  ethPriceUsd: number;     // 0 when unavailable
}

// ── target extraction ────────────────────────────────────────────────────────

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Pull every counterparty-like address out of an intent, from both the typed
 * `targets` array and the loosely-typed params bag. Returns lowercased, unique.
 */
export function extractTargets(intent: ParsedIntent): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string' && ADDR_RE.test(v)) out.add(v.toLowerCase());
  };

  for (const t of intent.targets || []) push(t);

  const p = intent.params || {};
  push(p.target);
  push(p.recipient);
  push(p.delegatee);
  push(p.delegator);
  push(p.ownerAddress);
  push(p.walletAddress);
  push(p.sessionKey);
  if (Array.isArray(p.targets)) for (const t of p.targets) push(t);

  return [...out];
}

/**
 * Sum the wei value(s) an intent moves, handling both single and batch shapes.
 */
export function computeValue(intent: ParsedIntent): { total: bigint; isBatch: boolean; batchSize: number } {
  const p = intent.params || {};
  const toWei = (v: unknown): bigint => {
    if (typeof v !== 'string' && typeof v !== 'number') return 0n;
    try { return BigInt(v as any); } catch { return 0n; }
  };

  if (Array.isArray(p.values)) {
    let total = 0n;
    for (const v of p.values) total += toWei(v);
    return { total, isBatch: true, batchSize: p.values.length };
  }

  return { total: toWei(p.value), isBatch: false, batchSize: 1 };
}
