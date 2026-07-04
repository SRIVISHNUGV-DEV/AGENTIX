import { existsSync } from "fs";
import { loadConfig, AGENTIX_HOME } from "../core/config";
import { checkRpcConnection } from "../core/provider";
import { getDatabase } from "../core/database";
import { getProxyGuard } from "../core/proxy-guard";
import { runSingle, runQuery } from "../core/database";
import { logger } from "../core/logger";

export interface HealthCheck {
  name: string;
  status: "PASS" | "WARNING" | "ERROR";
  message: string;
  details?: any;
}

export interface HealthResult {
  status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  checks: HealthCheck[];
  timestamp: string;
}

export async function runHealthCheck(): Promise<HealthResult> {
  const checks: HealthCheck[] = [];

  checks.push(await checkRpc());
  checks.push(await checkContracts());
  checks.push(await checkProxyStatus());
  checks.push(await checkDatabase());
  checks.push(await checkTrees());
  checks.push(await checkConfiguration());
  checks.push(await checkDiskUsage());
  checks.push(await checkLogs());

  const hasError = checks.some((c) => c.status === "ERROR");
  const hasWarning = checks.some((c) => c.status === "WARNING");

  const status = hasError ? "UNHEALTHY" : hasWarning ? "DEGRADED" : "HEALTHY";

  return {
    status,
    checks,
    timestamp: new Date().toISOString(),
  };
}

async function checkRpc(): Promise<HealthCheck> {
  try {
    const result = await checkRpcConnection();
    if (result.connected) {
      return {
        name: "RPC Connectivity",
        status: "PASS",
        message: `Connected to chain ${result.chainId}, block #${result.blockNumber}`,
        details: { chainId: result.chainId, blockNumber: result.blockNumber },
      };
    }
    return {
      name: "RPC Connectivity",
      status: "ERROR",
      message: `RPC connection failed: ${result.error}`,
    };
  } catch (e: any) {
    return { name: "RPC Connectivity", status: "ERROR", message: e.message };
  }
}

async function checkContracts(): Promise<HealthCheck> {
  try {
    const config = loadConfig();
    const missing: string[] = [];

    const requiredContracts = [
      "credentialRegistry",
      "sessionManager",
      "agentWalletFactory",
      "capabilityRegistry",
      "delegationManager",
      "organizationRegistry",
    ];

    for (const name of requiredContracts) {
      const addr = config.contracts[name as keyof typeof config.contracts];
      if (!addr || addr === "0x0000000000000000000000000000000000000000") {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      return {
        name: "Contract Status",
        status: "WARNING",
        message: `Missing contract addresses: ${missing.join(", ")}`,
        details: { missing },
      };
    }

    return {
      name: "Contract Status",
      status: "PASS",
      message: `All ${requiredContracts.length} contracts configured`,
    };
  } catch (e: any) {
    return { name: "Contract Status", status: "ERROR", message: e.message };
  }
}

async function checkProxyStatus(): Promise<HealthCheck> {
  try {
    const guard = getProxyGuard();
    const proxies = guard.listAllProxies();
    const implCount = Object.keys(guard.listAllProxies()).length;

    return {
      name: "Proxy Status",
      status: "PASS",
      message: `${implCount} proxy contracts registered`,
      details: { proxies },
    };
  } catch (e: any) {
    return { name: "Proxy Status", status: "ERROR", message: e.message };
  }
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

    const counts: Record<string, number> = {};
    for (const t of tables as any[]) {
      const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get() as any;
      counts[t.name] = count?.c || 0;
    }

    return {
      name: "Database Integrity",
      status: "PASS",
      message: `${tables.length} tables, all accessible`,
      details: { tables: (tables as any[]).map((t) => t.name), counts },
    };
  } catch (e: any) {
    return { name: "Database Integrity", status: "ERROR", message: e.message };
  }
}

async function checkTrees(): Promise<HealthCheck> {
  try {
    const orgs = runQuery<{ id: string }>("SELECT id FROM organizations");
    const warnings: string[] = [];

    for (const org of orgs) {
      const activeRoot = runSingle<{ root: string }>(
        "SELECT root FROM credential_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
        org.id
      );
      const revokedRoot = runSingle<{ root: string }>(
        "SELECT root FROM revocation_roots WHERE organization_id = ? ORDER BY epoch DESC LIMIT 1",
        org.id
      );

      if (!activeRoot) warnings.push(`Org ${org.id.slice(0, 12)}... has no active root`);
      if (!revokedRoot) warnings.push(`Org ${org.id.slice(0, 12)}... has no revoked root`);
    }

    if (warnings.length > 0) {
      return {
        name: "Tree Integrity",
        status: "WARNING",
        message: warnings.join("; "),
        details: { warnings },
      };
    }

    return {
      name: "Tree Integrity",
      status: "PASS",
      message: `${orgs.length} organizations, all trees valid`,
    };
  } catch (e: any) {
    return { name: "Tree Integrity", status: "ERROR", message: e.message };
  }
}

async function checkConfiguration(): Promise<HealthCheck> {
  try {
    const config = loadConfig();
    const issues: string[] = [];

    if (!config.rpcUrl) issues.push("RPC URL not configured");
    if (!config.contracts.credentialRegistry) issues.push("Credential registry not set");
    if (!config.contracts.sessionManager) issues.push("Session manager not set");

    if (issues.length > 0) {
      return {
        name: "Configuration Integrity",
        status: "WARNING",
        message: issues.join("; "),
        details: { issues },
      };
    }

    return {
      name: "Configuration Integrity",
      status: "PASS",
      message: "Configuration complete",
    };
  } catch (e: any) {
    return { name: "Configuration Integrity", status: "ERROR", message: e.message };
  }
}

async function checkDiskUsage(): Promise<HealthCheck> {
  try {
    const dbPath = loadConfig().database.path;
    const dbExists = existsSync(dbPath);

    return {
      name: "Disk Usage",
      status: dbExists ? "PASS" : "WARNING",
      message: dbExists ? "Database file exists" : "Database file not found",
    };
  } catch (e: any) {
    return { name: "Disk Usage", status: "ERROR", message: e.message };
  }
}

async function checkLogs(): Promise<HealthCheck> {
  try {
    const logDir = `${AGENTIX_HOME}/logs`;
    const exists = existsSync(logDir);

    return {
      name: "Log System",
      status: exists ? "PASS" : "WARNING",
      message: exists ? "Log directory exists" : "Log directory not found",
    };
  } catch (e: any) {
    return { name: "Log System", status: "ERROR", message: e.message };
  }
}
