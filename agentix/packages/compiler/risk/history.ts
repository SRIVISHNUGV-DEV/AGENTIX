// ─────────────────────────────────────────────────────────────────────────────
// Behavioral history
//
// Builds a BehavioralProfile for a wallet from the local `agent_actions` table
// (populated by the compiler gateway on every executed intent). This is what lets
// the risk engine reason about *velocity* and *anomaly* — e.g. "this agent has
// never moved >0.1 ETH and is now trying to move 5 ETH to a first-seen address".
//
// The DB is optional: in any context where @agentix/database can't be resolved or
// the table is empty, we return EMPTY_PROFILE and the behavioral dimension simply
// contributes a neutral score. Never throws.
// ─────────────────────────────────────────────────────────────────────────────

import { BehavioralProfile, EMPTY_PROFILE } from './context';

interface ActionRow {
  intent?: string;
  tool?: string;
  success?: number;
  timestamp?: number;
  metadata?: string;
}

function getDb(): { query: (sql: string, params?: unknown[]) => Record<string, unknown>[] } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runQuery } = require('@agentix/database');
    return { query: (sql: string, params: unknown[] = []) => runQuery(sql, ...params) };
  } catch {
    return null;
  }
}

function parseValueWei(row: ActionRow): bigint {
  // The gateway stores the raw params under `intent` and a summary (incl. value)
  // under `metadata`. Prefer the metadata summary, fall back to raw params.
  const tryParse = (blob?: string, key: string = 'value'): bigint | null => {
    if (!blob) return null;
    try {
      const o = JSON.parse(blob);
      if (o && o[key] != null) return BigInt(String(o[key]));
    } catch {}
    return null;
  };
  return tryParse(row.metadata) ?? tryParse(row.intent) ?? 0n;
}

function extractTarget(row: ActionRow): string | null {
  const tryParse = (blob?: string): string | null => {
    if (!blob) return null;
    try {
      const o = JSON.parse(blob);
      const t = o?.target || o?.recipient || o?.delegatee;
      if (typeof t === 'string' && /^0x[a-fA-F0-9]{40}$/.test(t)) return t.toLowerCase();
    } catch {}
    return null;
  };
  return tryParse(row.metadata) ?? tryParse(row.intent) ?? null;
}

/**
 * Build a behavioral profile for `walletAddress`. `now` is injected for testability.
 */
export function buildBehavioralProfile(walletAddress: string, now: number): BehavioralProfile {
  if (!walletAddress) return { ...EMPTY_PROFILE };
  const db = getDb();
  if (!db) return { ...EMPTY_PROFILE };

  const wallet = walletAddress.toLowerCase();
  const day = 86_400;
  const t24 = now - day;
  const t7d = now - 7 * day;

  let rows: ActionRow[];
  try {
    rows = db.query(
      `SELECT intent, tool, success, timestamp, metadata
         FROM agent_actions
        WHERE lower(wallet_address) = ? AND timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT 500`,
      [wallet, t7d]
    ) as ActionRow[];
  } catch {
    return { ...EMPTY_PROFILE };
  }

  if (!rows || rows.length === 0) return { ...EMPTY_PROFILE };

  let actionCount24h = 0;
  let failedCount24h = 0;
  let spent24h = 0n;
  let valueSum7d = 0n;
  let valueMax7d = 0n;
  let valueSamples = 0;
  let lastActionAt = 0;
  let everChangedOwner = false;
  const targets7d = new Set<string>();
  const seen = new Set<string>();

  for (const r of rows) {
    const ts = Number(r.timestamp || 0);
    if (ts > lastActionAt) lastActionAt = ts;

    const tool = String(r.tool || '');
    if (tool === 'wallet_transfer_ownership' || tool === 'changeOwner') everChangedOwner = true;

    const v = parseValueWei(r);
    if (v > 0n) {
      valueSum7d += v;
      valueSamples++;
      if (v > valueMax7d) valueMax7d = v;
    }

    const target = extractTarget(r);
    if (target) {
      targets7d.add(target);
      if (r.success === 1) seen.add(target);
    }

    if (ts >= t24) {
      actionCount24h++;
      if (r.success !== 1) failedCount24h++;
      if (r.success === 1 && v > 0n) spent24h += v;
    }
  }

  const valueMean = valueSamples > 0 ? valueSum7d / BigInt(valueSamples) : 0n;

  return {
    hasHistory: true,
    actionCount24h,
    actionCount7d: rows.length,
    failedCount24h,
    distinctTargets7d: targets7d.size,
    valueMean7dWei: valueMean.toString(),
    valueMax7dWei: valueMax7d.toString(),
    spent24hWei: spent24h.toString(),
    lastActionAt,
    seenTargets: [...seen],
    everChangedOwner,
  };
}
