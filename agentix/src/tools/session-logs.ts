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

  getRecent(limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions ORDER BY timestamp DESC LIMIT ?", limit
    );
  }

  getByWallet(walletAddress: string, limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?",
      walletAddress, limit
    );
  }

  getBySession(sessionId: string): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE session_id = ? ORDER BY timestamp DESC",
      sessionId
    );
  }

  getByTool(tool: string, limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE tool = ? ORDER BY timestamp DESC LIMIT ?",
      tool, limit
    );
  }

  getByRisk(level: string, limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE risk_level = ? ORDER BY timestamp DESC LIMIT ?",
      level, limit
    );
  }

  getFailures(limit = 50): SessionLog[] {
    return runQuery<SessionLog>(
      "SELECT * FROM agent_actions WHERE success = 0 ORDER BY timestamp DESC LIMIT ?", limit
    );
  }

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

  constructor(logger: SessionLogger) {
    this.logger = logger;
  }

  scan(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    anomalies.push(...this.detectRapidFire());
    anomalies.push(...this.detectRepeatedFailures());
    anomalies.push(...this.detectHighRiskBursts());
    anomalies.push(...this.detectUnusualPatterns());
    anomalies.push(...this.detectSessionAbuse());
    return anomalies;
  }

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
      "SELECT wallet_address, COUNT(DISTINCT wallet_address) as count FROM agent_actions WHERE wallet_address IS NOT NULL AND timestamp > ? GROUP BY wallet_address HAVING count > 3",
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

export function getSessionLogger(): SessionLogger {
  if (!_logger) _logger = new SessionLogger();
  return _logger;
}

export function getAnomalyDetector(): AnomalyDetector {
  if (!_detector) _detector = new AnomalyDetector(getSessionLogger());
  return _detector;
}
