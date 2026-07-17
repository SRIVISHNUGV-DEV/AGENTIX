import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { loadConfig, AGENTIX_HOME } from "../core/config";
import { getDatabase } from "../core/database";
import { getProxyGuard } from "../core/proxy-guard";
import { runSingle, runQuery } from "../core/database";
import { runHealthCheck } from "./health";

export interface DiagnosticResult {
  success: boolean;
  sections: DiagnosticSection[];
  timestamp: string;
}

export interface DiagnosticSection {
  name: string;
  status: "OK" | "WARNING" | "ERROR" | "INFO";
  items: DiagnosticItem[];
}

export interface DiagnosticItem {
  label: string;
  value: string;
  status?: "OK" | "WARNING" | "ERROR" | "INFO";
}

export async function runDiagnostics(): Promise<DiagnosticResult> {
  const sections: DiagnosticSection[] = [];

  sections.push(diagnoseSystem());
  sections.push(diagnoseConfiguration());
  sections.push(diagnoseContracts());
  sections.push(diagnoseDatabase());
  sections.push(diagnoseOrganizations());
  sections.push(diagnoseStorage());

  return {
    success: true,
    sections,
    timestamp: new Date().toISOString(),
  };
}

function diagnoseSystem(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  items.push({ label: "Node.js Version", value: process.version, status: "INFO" });
  items.push({ label: "Platform", value: process.platform, status: "INFO" });
  items.push({ label: "Architecture", value: process.arch, status: "INFO" });
  items.push({ label: "AgentIX Home", value: AGENTIX_HOME, status: existsSync(AGENTIX_HOME) ? "OK" : "ERROR" });

  const dirs = ["config", "db", "trees", "logs", "backups", "tools"];
  for (const d of dirs) {
    const p = join(AGENTIX_HOME, d);
    items.push({ label: `Directory: ${d}`, value: existsSync(p) ? "Exists" : "Missing", status: existsSync(p) ? "OK" : "WARNING" });
  }

  return { name: "System", status: "OK", items };
}

function diagnoseConfiguration(): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const config = loadConfig();

  items.push({ label: "Version", value: config.version, status: "OK" });
  items.push({ label: "Chain ID", value: String(config.chainId), status: "OK" });
  items.push({ label: "Network", value: config.networkName, status: "OK" });
  items.push({ label: "RPC URL", value: config.rpcUrl || "(not set)", status: config.rpcUrl ? "OK" : "WARNING" });
  items.push({ label: "RPC Fallback", value: config.rpcFallbackUrl || "(not set)", status: config.rpcFallbackUrl ? "OK" : "INFO" });
  items.push({ label: "Database Path", value: config.database.path, status: "OK" });

  return { name: "Configuration", status: config.rpcUrl ? "OK" : "WARNING", items };
}

function diagnoseContracts(): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const guard = getProxyGuard();
  const proxies = guard.listAllProxies();

  for (const [name, addr] of Object.entries(proxies)) {
    items.push({ label: name, value: addr, status: "OK" });
  }

  const impls = loadConfig().implementations;
  for (const [name, addr] of Object.entries(impls)) {
    items.push({ label: `impl:${name}`, value: addr, status: "INFO" });
  }

  return { name: "Contracts", status: "OK", items };
}

function diagnoseDatabase(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  try {
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];

    items.push({ label: "Tables", value: String(tables.length), status: "OK" });

    for (const t of tables) {
      const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get() as any;
      items.push({ label: t.name, value: `${count?.c || 0} rows`, status: "OK" });
    }

    const integrity = db.pragma("integrity_check") as any[];
    items.push({ label: "Integrity Check", value: String(integrity?.[0]?.integrity_check || "ok"), status: "OK" });
  } catch (e: any) {
    items.push({ label: "Database Error", value: e.message, status: "ERROR" });
  }

  return { name: "Database", status: "OK", items };
}

function diagnoseOrganizations(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  try {
    const orgs = runQuery<any>("SELECT * FROM organizations ORDER BY created_at DESC");
    items.push({ label: "Total Organizations", value: String(orgs.length), status: "OK" });

    for (const org of orgs.slice(0, 10)) {
      const credCount = runSingle<{ count: number }>(
        "SELECT COUNT(*) as count FROM credentials WHERE organization_id = ?",
        org.id
      );
      items.push({
        label: org.name,
        value: `id=${org.id.slice(0, 12)}... creds=${credCount?.count || 0}`,
        status: org.active ? "OK" : "WARNING",
      });
    }
  } catch (e: any) {
    items.push({ label: "Error", value: e.message, status: "ERROR" });
  }

  return { name: "Organizations", status: "OK", items };
}

function diagnoseStorage(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  try {
    const dirs = ["organizations", "trees", "credentials", "sessions", "wallets", "proofs", "capabilities", "delegations"];
    for (const d of dirs) {
      const p = join(AGENTIX_HOME, d);
      if (existsSync(p)) {
        const files = readdirSync(p);
        items.push({ label: d, value: `${files.length} files`, status: "OK" });
      } else {
        items.push({ label: d, value: "Not found", status: "INFO" });
      }
    }
  } catch (e: any) {
    items.push({ label: "Error", value: e.message, status: "ERROR" });
  }

  return { name: "Storage", status: "OK", items };
}
