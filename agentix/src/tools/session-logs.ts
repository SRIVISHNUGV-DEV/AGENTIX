import { runQuery, runSingle, runExecute } from "../core/database";
import { getEventBus } from "../../packages/core/eventbus";
import type { AgentAction } from "../../packages/shared/types";

export interface SessionLog {
  id: number;
  timestamp: number;
  agent?: string;
  tool: string;
  intent: string;
  sessionId?: string;
  walletAddress?: string;
  riskLevel: string;
  txHash?: string;
  executionTime?: number;
  success: boolean;
  failureReason?: string;
  metadata?: string;
}

export interface Anomaly {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  timestamp: number;
  relatedIds: number[];
}

export class SessionLogger {
/**
 * Append one agent action to the audit log and return its row id.
 * The append-only record behind anomaly detection and the session-log MCP
 * tools — every tool call an agent makes should land here, with its risk level.
 * @param action - AgentAction minus id/timestamp (auto-filled); riskLevel and success drive the detectors, so set them honestly.
 * @returns The new row id (lastInsertRowid) as a number.
 * @throws Throws if the DB insert fails; callers should not let a logging failure fail the action being logged.
 * Maps to: internal — every tool execution path; read via MCP tool agentix_session_logs.
 * Side effects: DB insert into agent_actions.
 */

  log(action: Omit<AgentAction, "id" | "timestamp">): number {
    const now = Math.floor(Date.now() / 1000);
    const result = runExecute(
      `INSERT INTO agent_actions (timestamp, agent, tool, intent, session_id, wallet_address, risk_level, tx_hash, execution_time, success, failure_reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      now, action.agent || null, action.tool, action.intent,
      action.sessionId || null, action.walletAddress || null,
      action.riskLevel, action.txHash || null, action.executionTime || null,
      action.success ? 1 : 0, action.failureReason || null,
      action.metadata ? JSON.stringify(action.metadata) : null
    );
    return Number(result.lastInsertRowid);
  }

/**
 * Most recent logged actions, newest first.
 * @param limit - Max rows, default 50; 0 returns an empty list.
 * @returns SessionLog[] (empty when no actions are logged).
 * @throws Throws if the DB cannot be read.
 * Maps to: MCP tool agentix_session_logs (unfiltered).
 * Side effects: read-only DB query.
 */

  getRecent(limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions ORDER BY timestamp DESC LIMIT ?", limit
    );
  }

/**
 * Logged actions for one wallet, newest first.
 * @param walletAddress - Exact wallet address; @param limit - Max rows, default 50.
 * @returns SessionLog[] (empty when the wallet has no actions).
 * @throws Throws if the DB cannot be read.
 * Maps to: MCP tool agentix_session_logs (walletAddress filter).
 * Side effects: read-only DB query.
 */

  getByWallet(walletAddress: string, limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?",
      walletAddress, limit
    );
  }

/**
 * Every logged action for one session, newest first (no limit).
 * Use for post-incident review of a single session — the full list can be long
 * for a busy session, there is no pagination here.
 * @param sessionId - Session id to filter on.
 * @returns SessionLog[] (empty when the session has no actions).
 * @throws Throws if the DB cannot be read.
 * Maps to: internal — session audit review (no dedicated MCP filter).
 * Side effects: read-only DB query.
 */

  getBySession(sessionId: string): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE session_id = ? ORDER BY timestamp DESC",
      sessionId
    );
  }

/**
 * Logged actions for one tool name, newest first.
 * @param tool - Exact tool string as logged; @param limit - Max rows, default 50.
 * @returns SessionLog[] (empty when the tool was never logged).
 * @throws Throws if the DB cannot be read.
 * Maps to: MCP tool agentix_session_logs (tool filter).
 * Side effects: read-only DB query.
 */

  getByTool(tool: string, limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE tool = ? ORDER BY timestamp DESC LIMIT ?",
      tool, limit
    );
  }

/**
 * Logged actions at one risk level, newest first.
 * @param level - Exact risk string as logged (e.g. "HIGH", "AUTHORITY"); @param limit - Max rows, default 50.
 * @returns SessionLog[] (empty when nothing was logged at that level).
 * @throws Throws if the DB cannot be read.
 * Maps to: MCP tool agentix_session_logs (riskLevel filter).
 * Side effects: read-only DB query.
 */

  getByRisk(level: string, limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE risk_level = ? ORDER BY timestamp DESC LIMIT ?",
      level, limit
    );
  }

/**
 * Failed logged actions (success = 0), newest first.
 * The first place to look when something is wrong — failures cluster here
 * before they trip the repeated-failure detector.
 * @param limit - Max rows, default 50.
 * @returns SessionLog[] (empty when nothing failed).
 * @throws Throws if the DB cannot be read.
 * Maps to: internal — failure review (feeds detectRepeatedFailures).
 * Side effects: read-only DB query.
 */

  getFailures(limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE success = 0 ORDER BY timestamp DESC LIMIT ?", limit
    );
  }

/**
 * Aggregate log stats: totals, success/failure counts, breakdowns by risk and tool, average execution time.
 * @returns {total, successful, failed, byRisk, byTool, avgExecutionTime} — byRisk/byTool are empty objects when nothing is logged; avgExecutionTime is 0 when no row has an execution time.
 * @throws Throws if the DB cannot be read.
 * Maps to: MCP tool agentix_session_log_stats.
 * Side effects: read-only DB queries (several COUNT/GROUP BY + one AVG).
 */

  getStats(): {
    total: number;
    successful: number;
    failed: number;
    byRisk: Record<string, number>;
    byTool: Record<string, number>;
    avgExecutionTime: number;
  } {
    const total = runSingle<{ count: number }>("SELECT COUNT(*) as count FROM agent_actions")?.count || 0;
    const successful = runSingle<{ count: number }>("SELECT COUNT(*) as count FROM agent_actions WHERE success = 1")?.count || 0;
    const failed = total - successful;

    const riskRows = runQuery<{ risk_level: string; count: number }>(
      "SELECT risk_level, COUNT(*) as count FROM agent_actions GROUP BY risk_level"
    );
    const byRisk: Record<string, number> = {};
    for (const r of riskRows) byRisk[r.risk_level] = r.count;

    const toolRows = runQuery<{ tool: string; count: number }>(
      "SELECT tool, COUNT(*) as count FROM agent_actions GROUP BY tool ORDER BY count DESC"
    );
    const byTool: Record<string, number> = {};
    for (const r of toolRows) byTool[r.tool] = r.count;

    const avgRow = runSingle<{ avg: number }>(
      "SELECT AVG(execution_time) as avg FROM agent_actions WHERE execution_time IS NOT NULL"
    );

    return { total, successful, failed, byRisk, byTool, avgExecutionTime: avgRow?.avg || 0 };
  }
}

// ── Anomaly Detection ──────────────────────────────────────────────────

export class AnomalyDetector {
  private logger: SessionLogger;

/**
 * Build a detector bound to one SessionLogger.
 * The detector only reads through the logger's queries — it never writes —
 * so constructing it is cheap and side-effect free.
 * @param logger - SessionLogger supplying the log data; detectors share the logger's DB connection.
 * @returns An AnomalyDetector ready to scan.
 * Maps to: internal — getAnomalyDetector.
 * Side effects: none.
 */
  constructor(logger: SessionLogger) {
    this.logger = logger;
  }

/**
 * Run all five detectors over the recent log and return every anomaly found.
 * Read-only triage, not enforcement — it reports suspicious patterns (rapid
 * fire, repeated failures, high-risk bursts, unusual volume, session abuse)
 * and leaves the response to the caller.
 * @returns Anomaly[] (empty when nothing trips a threshold); detectors run in fixed order and their results concatenate.
 * @throws Throws if a detector's DB query fails.
 * Maps to: internal — anomaly review / dashboard alerts.
 * Side effects: read-only DB queries.
 */

  scan(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    anomalies.push(...this.detectRapidFire());
    anomalies.push(...this.detectRepeatedFailures());
    anomalies.push(...this.detectHighRiskBursts());
    anomalies.push(...this.detectUnusualPatterns());
    anomalies.push(...this.detectSessionAbuse());
    return anomalies;
  }

/**
 * RAPID_FIRE detector: more than 20 actions in the last 60 seconds.
 * Catches runaway loops and burst abuse; the 20/60s threshold is hardcoded,
 * not configurable, so a legitimately busy minute trips it too.
 * @returns Anomaly[] with one MEDIUM RAPID_FIRE entry (relatedIds = all action ids in the window), or [].
 * @throws Throws if the DB query fails.
 * Maps to: internal — scan.
 * Side effects: read-only DB query.
 */
  private detectRapidFire(): Anomaly[] {
    const recent = runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE timestamp > ? ORDER BY timestamp ASC",
      Math.floor(Date.now() / 1000) - 60
    );

    if (recent.length > 20) {
      return [{
        type: "RAPID_FIRE",
        severity: "MEDIUM",
        description: `${recent.length} actions in the last 60 seconds (threshold: 20)`,
        timestamp: Math.floor(Date.now() / 1000),
        relatedIds: recent.map((r) => r.id),
      }];
    }
    return [];
  }

/**
 * REPEATED_FAILURES detector: 5+ failures for the same tool in the last 5 minutes.
 * Groups failures by tool first, so five failures spread across five tools do
 * not trip it — only a single tool failing repeatedly.
 * @returns Anomaly[] with one HIGH entry per tripped tool (relatedIds = the failing action ids), or [].
 * @throws Throws if the DB query fails.
 * Maps to: internal — scan.
 * Side effects: read-only DB query.
 */
  private detectRepeatedFailures(): Anomaly[] {
    const failures = runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE success = 0 AND timestamp > ? ORDER BY timestamp DESC",
      Math.floor(Date.now() / 1000) - 300
    );

    const byTool: Map<string, SessionLog[]> = new Map();
    for (const f of failures) {
      const existing = byTool.get(f.tool) || [];
      existing.push(f);
      byTool.set(f.tool, existing);
    }

    const anomalies: Anomaly[] = [];
    for (const [tool, logs] of byTool) {
      if (logs.length >= 5) {
        anomalies.push({
          type: "REPEATED_FAILURES",
          severity: "HIGH",
          description: `${logs.length} consecutive failures for tool '${tool}' in last 5 minutes`,
          timestamp: logs[0].timestamp,
          relatedIds: logs.map((l) => l.id),
        });
      }
    }
    return anomalies;
  }

/**
 * HIGH_RISK_BURST detector: 5+ HIGH- or AUTHORITY-risk actions in the last 5 minutes.
 * High-risk actions are individually legitimate, so this flags volume, not any
 * single action — five authority actions in five minutes is the trip wire.
 * @returns Anomaly[] with one HIGH entry (relatedIds = the high-risk action ids), or [].
 * @throws Throws if the DB query fails.
 * Maps to: internal — scan.
 * Side effects: read-only DB query.
 */
  private detectHighRiskBursts(): Anomaly[] {
    const highRisk = runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE risk_level IN ('HIGH', 'AUTHORITY') AND timestamp > ?",
      Math.floor(Date.now() / 1000) - 300
    );

    if (highRisk.length >= 5) {
      return [{
        type: "HIGH_RISK_BURST",
        severity: "HIGH",
        description: `${highRisk.length} high/authority-risk actions in last 5 minutes`,
        timestamp: Math.floor(Date.now() / 1000),
        relatedIds: highRisk.map((h) => h.id),
      }];
    }
    return [];
  }

/**
 * Volume detectors: hourly count >3x the 7-day daily average (UNUSUAL_VOLUME), and >5 distinct wallets active in the last hour (MULTI_WALLET_ACTIVITY).
 * Both are heuristics with known blind spots — a new deployment has no 7-day
 * baseline (dailyAvg 0 disables the volume check), and the multi-wallet check
 * counts wallets with >3 actions, not all active wallets.
 * @returns Anomaly[] with up to two entries (MEDIUM volume, LOW multi-wallet), or [].
 * @throws Throws if a DB query fails.
 * Maps to: internal — scan.
 * Side effects: read-only DB queries.
 */
  private detectUnusualPatterns(): Anomaly[] {
    const anomalies: Anomaly[] = [];

    const hourlyCount = runSingle<{ count: number }>(
      "SELECT COUNT(*) as count FROM agent_actions WHERE timestamp > ?",
      Math.floor(Date.now() / 1000) - 3600
    )?.count || 0;

    const dailyAvg = runSingle<{ avg: number }>(
      "SELECT AVG(daily_count) as avg FROM (SELECT COUNT(*) as daily_count FROM agent_actions WHERE timestamp > ? GROUP BY (timestamp / 86400))",
      Math.floor(Date.now() / 1000) - 86400 * 7
    )?.avg || 0;

    if (dailyAvg > 0 && hourlyCount > dailyAvg * 3) {
      anomalies.push({
        type: "UNUSUAL_VOLUME",
        severity: "MEDIUM",
        description: `Hourly action count (${hourlyCount}) is ${Math.round(hourlyCount / dailyAvg)}x the daily average (${Math.round(dailyAvg)})`,
        timestamp: Math.floor(Date.now() / 1000),
        relatedIds: [],
      });
    }

    const multiWallet = runQuery<{ wallet_address: string; count: number }>(
      "SELECT wallet_address, COUNT(*) as count FROM agent_actions WHERE wallet_address IS NOT NULL AND timestamp > ? GROUP BY wallet_address HAVING count > 3",
      Math.floor(Date.now() / 1000) - 3600
    );

    if (multiWallet.length > 5) {
      anomalies.push({
        type: "MULTI_WALLET_ACTIVITY",
        severity: "LOW",
        description: `${multiWallet.length} distinct wallets active in last hour`,
        timestamp: Math.floor(Date.now() / 1000),
        relatedIds: [],
      });
    }

    return anomalies;
  }

/**
 * SESSION_ABUSE detector: any session with >10 actions in the last hour and a >50% failure rate.
 * A failing session is usually a broken agent loop retrying the same denied
 * call — the >10-action floor keeps a single failed attempt from tripping it.
 * @returns Anomaly[] with one HIGH entry per abusive session, or [].
 * @throws Throws if the DB query fails.
 * Maps to: internal — scan.
 * Side effects: read-only DB query.
 */
  private detectSessionAbuse(): Anomaly[] {
    const anomalies: Anomaly[] = [];

    const sessionActions = runQuery<{ session_id: string; cnt: number; fails: number }>(
      `SELECT session_id, COUNT(*) as cnt, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as fails
       FROM agent_actions WHERE session_id IS NOT NULL AND timestamp > ?
       GROUP BY session_id HAVING cnt > 10`,
      Math.floor(Date.now() / 1000) - 3600
    );

    for (const s of sessionActions) {
      const failRate = s.fails / s.cnt;
      if (failRate > 0.5) {
        anomalies.push({
          type: "SESSION_ABUSE",
          severity: "HIGH",
          description: `Session ${s.session_id} has ${s.fails}/${s.cnt} failures (${Math.round(failRate * 100)}% fail rate)`,
          timestamp: Math.floor(Date.now() / 1000),
          relatedIds: [],
        });
      }
    }

    return anomalies;
  }
}

let _logger: SessionLogger | null = null;
let _detector: AnomalyDetector | null = null;

/**
 * The shared SessionLogger singleton (lazy, module-level).
 * Every logger call in the process writes through this one instance, so log
 * rows are ordered by a single writer path.
 * @returns The same SessionLogger on every call after the first.
 * @throws Never throws (construction has no I/O).
 * Maps to: internal — all logging call sites.
 * Side effects: creates the singleton on first call; none afterwards.
 */
export function getSessionLogger(): SessionLogger {
  if (!_logger) _logger = new SessionLogger();
  return _logger;
}

/**
 * The shared AnomalyDetector singleton (lazy, module-level), bound to the shared logger.
 * @returns The same AnomalyDetector on every call after the first.
 * @throws Never throws (construction has no I/O).
 * Maps to: internal — anomaly review / dashboard alerts.
 * Side effects: creates the singleton (and the logger) on first call; none afterwards.
 */
export function getAnomalyDetector(): AnomalyDetector {
  if (!_detector) _detector = new AnomalyDetector(getSessionLogger());
  return _detector;
}
