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
 * AgentIX core contract addresses are resolved lazily from the runtime config so
 * the compiler package stays decoupled from a specific deployment. Falls back to
 * an empty set when the runtime config module isn't resolvable (e.g. unit tests).
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
function systemAddresses(): Set<string> {
  if (_systemCache && Date.now() - _systemCache.at < 60_000) return _systemCache.set;
  const set = loadSystemAddresses();
  _systemCache = { at: Date.now(), set };
  return set;
}

/** For tests: force the system-address set. */
export function __setSystemAddressesForTest(addrs: string[]): void {
  _systemCache = { at: Date.now(), set: new Set(addrs.map((a) => a.toLowerCase())) };
}

export class ReputationResolver {
  private system: Set<string>;
  private trusted: Set<string>;
  private blocked: Set<string>;

  constructor(config: RiskEngineConfig) {
    this.system = systemAddresses();
    this.trusted = new Set((config.trustedAddresses || []).map((a) => a.toLowerCase()));
    this.blocked = new Set((config.blockedAddresses || []).map((a) => a.toLowerCase()));
  }

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
   * Best-effort on-chain refinement of an 'unknown' reputation using code size
   * and nonce. Never throws — returns the base reputation on any failure.
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

function getProvider(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getProvider } = require('../../../src/core/provider');
    return getProvider();
  } catch {
    return null;
  }
}
