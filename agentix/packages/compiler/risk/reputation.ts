// ─────────────────────────────────────────────────────────────────────────────
// Counterparty reputation
//
// Resolves an address to a trust tier + risk score using, in order of authority:
//   1. Operator blocklist  (config.blockedAddresses)      → blocked / 100
//   2. AgentIX system contracts (from runtime config)     → system / 0
//   3. Operator trustlist  (config.trustedAddresses)      → trusted / 5
//   4. Behavioral familiarity (agent has transacted before)→ seen / 25
//   5. On-chain shape heuristics (EOA vs contract, age)   → known/unknown
//
// The engine passes the resolved map into signals; this module is the only place
// that knows *how* to judge an address, so the policy is centralized and testable.
// ─────────────────────────────────────────────────────────────────────────────

import { AddressReputation, BehavioralProfile } from './context';
import { RiskEngineConfig } from '../types/compilation';

/**
 * Resolve AgentIX core contract addresses from the runtime config into a lowercase set.
 * Why: system contracts are tier 'system' (score 0) — the compiler stays decoupled from a deployment by resolving them lazily instead of hard-coding.
 * @returns Lowercase system addresses; empty set when the config module is unresolvable (e.g. unit tests).
 * Maps to: internal — systemAddresses (cached accessor).
 */
function loadSystemAddresses(): Set<string> {
  const set = new Set<string>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadConfig } = require('../../../src/core/config');
    const cfg = loadConfig();
    const c = cfg?.contracts || {};
    for (const v of Object.values(c)) {
      if (typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v)) set.add(v.toLowerCase());
    }
    if (typeof cfg?.contracts?.entryPoint === 'string') set.add(cfg.contracts.entryPoint.toLowerCase());
  } catch {
    // Config not resolvable in this context — degrade gracefully.
  }
  return set;
}

let _systemCache: { at: number; set: Set<string> } | null = null;
/**
 * Return the cached system-address set, refreshing it at most once per minute.
 * Why: config reads are cheap but not free — a 60s cache bounds them while still picking up redeploys quickly.
 * @returns The cached (or freshly loaded) lowercase address set.
 * Side effects: refreshes the module-level _systemCache when stale.
 * Maps to: internal — ReputationResolver constructor.
 */
function systemAddresses(): Set<string> {
  if (_systemCache && Date.now() - _systemCache.at < 60_000) return _systemCache.set;
  const set = loadSystemAddresses();
  _systemCache = { at: Date.now(), set };
  return set;
}

/**
 * Force the system-address set (test hook — the __ prefix marks it as test-only).
 * Why: tests need deterministic 'system' tiers without a real runtime config on disk.
 * @param addrs - addresses to treat as system contracts; lowercased on store.
 * Side effects: overwrites the module-level _systemCache.
 * Maps to: internal — systemAddresses.
 */
export function __setSystemAddressesForTest(addrs: string[]): void {
  _systemCache = { at: Date.now(), set: new Set(addrs.map((a) => a.toLowerCase())) };
}

export class ReputationResolver {
  private system: Set<string>;
  private trusted: Set<string>;
  private blocked: Set<string>;

  /**
   * Build the resolver with system addresses plus the operator's trust/block lists.
   * Why: the tier order (blocked > system > trusted > seen > unknown) is the policy — it must be fixed at construction, not re-decided per address.
   * @param config - risk config; trustedAddresses/blockedAddresses are lowercased copies.
   * Maps to: internal — RiskEngineCore.assess (reputation step).
   */
  constructor(config: RiskEngineConfig) {
    this.system = systemAddresses();
    this.trusted = new Set((config.trustedAddresses || []).map((a) => a.toLowerCase()));
    this.blocked = new Set((config.blockedAddresses || []).map((a) => a.toLowerCase()));
  }

  /**
   * Judge one address into a trust tier and 0–100 risk score.
   * Why: the counterparty dimension is built from these verdicts — a blocked address (100) is a hard DENY downstream.
   * @param address - address to judge (case-insensitive).
   * @param behavior - behavioral profile; seenTargets decides the 'seen' tier (25).
   * @returns AddressReputation; unknown first-seen addresses score 60 pending on-chain enrichment.
   * Maps to: internal — RiskEngineCore.assess; event COMP_BLOCKED when tier is 'blocked'.
   */
  resolve(address: string, behavior: BehavioralProfile): AddressReputation {
    const addr = address.toLowerCase();

    if (this.blocked.has(addr)) {
      return { address: addr, tier: 'blocked', score: 100, labels: ['blocklist'],
        reason: 'Address is on the operator blocklist (sanctioned/known-malicious)' };
    }

    if (this.system.has(addr)) {
      return { address: addr, tier: 'system', score: 0, labels: ['agentix-core'],
        reason: 'AgentIX protocol contract' };
    }

    if (this.trusted.has(addr)) {
      return { address: addr, tier: 'trusted', score: 5, labels: ['operator-trusted'],
        reason: 'Address explicitly trusted by operator policy' };
    }

    if (behavior.seenTargets.includes(addr)) {
      return { address: addr, tier: 'seen', score: 25, labels: ['prior-counterparty'],
        reason: 'Agent has successfully transacted with this address before' };
    }

    // Unknown address — moderate risk. On-chain shape refinement (EOA vs contract,
    // deployment age) happens in the async enrich() path when a provider exists.
    return { address: addr, tier: 'unknown', score: 60, labels: ['first-seen'],
      reason: 'First-seen address with no prior relationship or trust anchor' };
  }

  /**
   * Refine an 'unknown' reputation on-chain via code size and nonce: contracts score 65 (unverified), fresh EOAs 70, EOAs with history 45.
   * Why: shape heuristics separate a dormant fresh account from an established one — the base 60 is only a placeholder until this runs.
   * @param base - reputation to refine; non-'unknown' tiers and missing providers return it unchanged.
   * @returns The refined reputation, or the base on any failure. Never throws.
   * Side effects: getCode + getTransactionCount RPCs.
   * Maps to: internal — RiskEngineCore.enrichReputation.
   */
  async enrich(base: AddressReputation): Promise<AddressReputation> {
    if (base.tier !== 'unknown') return base;
    const provider = getProvider();
    if (!provider) return base;

    try {
      const [code, nonce] = await Promise.all([
        provider.getCode(base.address).catch(() => '0x'),
        provider.getTransactionCount(base.address).catch(() => 0),
      ]);
      const isContract = code && code !== '0x';
      const labels = [...base.labels, isContract ? 'contract' : 'eoa'];

      if (isContract) {
        // Unverified/unknown contract — slightly higher than an EOA because it can
        // execute arbitrary logic on receipt of a call.
        return { ...base, tier: 'known', score: 65, labels: [...labels, 'unverified-contract'],
          reason: 'Unknown smart contract — can execute arbitrary logic; not in trust registry' };
      }

      if (nonce === 0) {
        return { ...base, score: 70, labels: [...labels, 'dormant'],
          reason: 'Fresh externally-owned account with zero outbound history' };
      }

      return { ...base, tier: 'known', score: 45, labels,
        reason: 'Externally-owned account with transaction history but no trust anchor' };
    } catch {
      return base;
    }
  }
}

/**
 * Lazily require the runtime provider.
 * Why: enrichment is best-effort — no provider means the base reputation stands, not a crash.
 * @returns The provider, or null when the module cannot be resolved.
 * Maps to: internal — ReputationResolver.enrich.
 */
function getProvider(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getProvider } = require('../../../src/core/provider');
    return getProvider();
  } catch {
    return null;
  }
}
