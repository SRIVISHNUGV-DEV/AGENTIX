// ─────────────────────────────────────────────────────────────────────────────
// Risk engine test harness
//
// Runs the modular risk engine against a battery of scenarios and asserts on the
// resulting category / decision / signals. No DB or network required — behavioral
// history and price oracle degrade to neutral, so the engine runs fully offline.
//
//   Run:  bun x tsx packages/compiler/risk/__tests__/risk.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'assert';
import { RiskEngineCore } from '../engine';
import { __setSystemAddressesForTest } from '../reputation';
import { ParsedIntent } from '../../types/intent';
import { ResolvedCapabilities } from '../../types/capability';
import { OptimizedPolicy } from '../../types/policy';
import { SimulationResult } from '../../types/simulation';
import { RiskEngineConfig } from '../../types/compilation';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    try {
      await fn();
      passed++;
      console.log(`  \u2713 ${name}`);
    } catch (e: any) {
      failed++;
      console.error(`  \u2717 ${name}\n      ${e.message}`);
    }
  };
  return run();
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const SYSTEM_ADDR = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const KNOWN_EOA = '0xac0a72faaf2596dd55a20049f0ab7584b58b3dee';
const FRESH_ADDR = '0x1111111111111111111111111111111111111111';
const BLOCKED_ADDR = '0x9999999999999999999999999999999999999999';

__setSystemAddressesForTest([SYSTEM_ADDR]);

const RISK_MEDIUM_FLOOR = 26; // > LOW_MAX (25)

function baseConfig(over: Partial<RiskEngineConfig> = {}): RiskEngineConfig {
  return {
    approvalThreshold: 75,
    denyThreshold: 90,
    weights: {},
    behavioralEnabled: false, // no DB in tests
    notionalEnabled: false,   // no network in tests
    trustedAddresses: [SYSTEM_ADDR],
    blockedAddresses: [BLOCKED_ADDR],
    ...over,
  };
}

function intent(action: string, params: Record<string, unknown> = {}): ParsedIntent {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    id: 'intent_test',
    source: 'sdk',
    action,
    normalizedAction: action,
    params,
    agent: { identityId: 1, walletAddress: '0x2222222222222222222222222222222222222222' },
    requestedAt: now,
    priority: 'normal',
    validationErrors: [],
  };
}

function caps(canExecute = true, missing: string[] = []): ResolvedCapabilities {
  return {
    agent: { identityId: 1, walletAddress: '0x2222222222222222222222222222222222222222' },
    organization: { id: '', active: false },
    capabilities: [], delegations: [], credentials: [],
    grantedActions: [], restrictedActions: [], missingActions: missing,
    canExecute, missingExplicit: missing, mustDelegate: [],
  };
}

function policy(over: Partial<OptimizedPolicy['effectiveLimits']> = {}): OptimizedPolicy {
  return {
    rules: [], edges: [], root: 'r', conflicts: [],
    effectiveLimits: {
      maxValue: '1000000000000000000', // 1 ETH
      maxGas: '0', expiry: Math.floor(Date.now() / 1000) + 3600,
      allowedTargets: [], maxBatchSize: 20, ...over,
    },
  };
}

function sim(over: Partial<SimulationResult> = {}): SimulationResult {
  return { success: true, steps: [{ nodeId: 's0', success: true, reverted: false }], warnings: [], errors: [], ...over };
}

const engine = (cfg?: Partial<RiskEngineConfig>) => new RiskEngineCore(baseConfig(cfg));

// ── scenarios ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nAgentIX Risk Engine v2 — scenario tests\n');

  await test('low-value action to trusted counterparties → LOW / ALLOW', async () => {
    const r = await engine({ trustedAddresses: [SYSTEM_ADDR, KNOWN_EOA] }).assess({
      intent: intent('session_create_lightweight', { walletAddress: SYSTEM_ADDR, sessionKey: KNOWN_EOA }),
      capabilities: caps(),
      policy: policy(), simulation: sim(),
    });
    assert(r.category === 'LOW', `category=${r.category} score=${r.score}`);
    assert(r.decision === 'ALLOW' || r.decision === 'ALLOW_WITH_CONTROLS', `decision=${r.decision}`);
    assert(r.requiresApproval === false, 'should not require approval');
  });

  await test('first-seen session key is treated as at least MEDIUM (dominance posture)', async () => {
    const r = await engine().assess({
      intent: intent('session_create_lightweight', { walletAddress: SYSTEM_ADDR, sessionKey: FRESH_ADDR }),
      capabilities: caps(), policy: policy(), simulation: sim(),
    });
    assert(r.score >= RISK_MEDIUM_FLOOR, `score=${r.score} should reflect first-seen counterparty`);
    assert(r.signals!.some((s) => s.dimension === 'counterparty' && s.score >= 40), 'expected elevated counterparty signal');
  });

  await test('blocked counterparty → DENY regardless of value', async () => {
    const r = await engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: BLOCKED_ADDR, value: '1000' }),
      capabilities: caps(), policy: policy(), simulation: sim(),
    });
    assert(r.decision === 'DENY', `decision=${r.decision}`);
    assert(r.score >= 90, `score=${r.score}`);
    assert(r.signals!.some((s) => s.code === 'COMP_BLOCKED'), 'expected COMP_BLOCKED signal');
  });

  await test('value breach of policy ceiling → high score + POLICY_VALUE_BREACH', async () => {
    const r = await engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: KNOWN_EOA, value: '5000000000000000000' }), // 5 ETH
      capabilities: caps(), policy: policy({ maxValue: '1000000000000000000' }), simulation: sim(),
    });
    assert(r.signals!.some((s) => s.code === 'POLICY_VALUE_BREACH'), 'expected POLICY_VALUE_BREACH');
    assert(r.requiresApproval, 'should require approval');
    assert(['REVIEW', 'CHALLENGE', 'DENY'].includes(r.decision!), `decision=${r.decision}`);
  });

  await test('simulation revert forces DENY', async () => {
    const r = await engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: KNOWN_EOA, value: '1000' }),
      capabilities: caps(), policy: policy(),
      simulation: sim({ success: false, steps: [{ nodeId: 's0', success: false, reverted: true, revertReason: 'ERC20: insufficient' }], errors: ['revert'] }),
    });
    assert(r.signals!.some((s) => s.code === 'SIM_REVERT'), 'expected SIM_REVERT');
    assert(r.decision === 'DENY', `decision=${r.decision}`);
  });

  await test('ownership transfer is AUTHORITY-critical', async () => {
    const r = await engine().assess({
      intent: intent('wallet_transfer_ownership', { walletAddress: SYSTEM_ADDR, target: FRESH_ADDR }),
      capabilities: caps(), policy: policy(), simulation: sim(),
    });
    assert(r.dimensionScores!.authority! >= 90, `authority=${r.dimensionScores!.authority}`);
    assert(['REVIEW', 'CHALLENGE', 'DENY'].includes(r.decision!), `decision=${r.decision}`);
    assert(r.controls!.some((c) => c.type === 'time_lock'), 'expected a time_lock control');
  });

  await test('target off allowlist raises policy signal', async () => {
    const r = await engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: FRESH_ADDR, value: '1000' }),
      capabilities: caps(), policy: policy({ allowedTargets: [KNOWN_EOA] }), simulation: sim(),
    });
    assert(r.signals!.some((s) => s.code === 'POLICY_TARGET_OFFLIST'), 'expected POLICY_TARGET_OFFLIST');
  });

  await test('missing capability surfaces CAP_MISSING and raises capability dim', async () => {
    const r = await engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: KNOWN_EOA, value: '1000' }),
      capabilities: caps(false, ['wallet_execute']), policy: policy(), simulation: sim(),
    });
    assert(r.signals!.some((s) => s.code === 'CAP_MISSING'), 'expected CAP_MISSING');
    assert(r.dimensionScores!.capability! >= 70, `capability=${r.dimensionScores!.capability}`);
  });

  await test('stale intent raises temporal signal', async () => {
    const i = intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: KNOWN_EOA, value: '1000' });
    i.requestedAt = Math.floor(Date.now() / 1000) - 1200; // 20 min old
    const r = await engine().assess({ intent: i, capabilities: caps(), policy: policy(), simulation: sim() });
    assert(r.signals!.some((s) => s.code === 'TEMP_STALE'), 'expected TEMP_STALE');
  });

  await test('backward-compat surface present and well-formed', async () => {
    const r = await engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: KNOWN_EOA, value: '1000' }),
      capabilities: caps(), policy: policy(), simulation: sim(),
    });
    assert(typeof r.score === 'number' && r.score >= 0 && r.score <= 100, 'score range');
    assert(['LOW', 'MEDIUM', 'HIGH', 'AUTHORITY'].includes(r.category), 'category enum');
    assert(Array.isArray(r.factors) && r.factors.length > 0, 'factors present');
    assert(r.factors.every((f) => typeof f.name === 'string' && typeof f.weight === 'number' && typeof f.score === 'number'), 'legacy factor shape');
    assert(Array.isArray(r.warnings) && Array.isArray(r.suggestions), 'warnings/suggestions arrays');
    assert(typeof r.requiresApproval === 'boolean', 'requiresApproval bool');
    // new surface
    assert(typeof r.decision === 'string', 'decision present');
    assert(typeof r.confidence === 'number', 'confidence present');
    assert(r.engineVersion === '2.0.0', 'engineVersion');
  });

  await test('score is monotonic in value (bigger transfer ≥ smaller)', async () => {
    const mk = (v: string) => engine().assess({
      intent: intent('wallet_execute', { walletAddress: SYSTEM_ADDR, target: KNOWN_EOA, value: v }),
      capabilities: caps(), policy: policy({ maxValue: '1000000000000000000000' }), simulation: sim(),
    });
    const small = await mk('100000000000000000');   // 0.1 ETH
    const big = await mk('50000000000000000000');    // 50 ETH
    assert(big.score >= small.score, `big=${big.score} small=${small.score}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
