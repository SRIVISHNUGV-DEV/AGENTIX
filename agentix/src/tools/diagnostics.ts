import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { loadConfig, AGENTIX_HOME } from "../core/config";
import { getDatabase } from "../core/database";
import { getProxyGuard } from "../core/proxy-guard";
import { runSingle, runQuery } from "../core/database";

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

/**
 * Full local diagnostics: system, configuration, contracts, database, organizations, storage.
 * The `agentix doctor` entry point — read-only checks that never repair anything;
 * each section reports its own items, and the caller decides what is actionable.
 * @returns DiagnosticResult with all six sections and an ISO timestamp; success is always true (per-item statuses carry failures).
 * @throws Never throws: section functions catch their own errors.
 * Maps to: MCP tool agentix_diagnostics / CLI 'agentix doctor'.
 * Side effects: read-only (DB reads, directory listings); no writes or network calls.
 */
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

/**
 * System section: Node version, platform, arch, ~/.agentix presence and its six core subdirs.
 * Note the section status is always "OK" — missing directories only show as
 * WARNING items, so callers must read item statuses, not the section status.
 * @returns DiagnosticSection named "System" with one item per check.
 * @throws Never throws: pure filesystem/config reads.
 * Maps to: internal — runDiagnostics.
 * Side effects: read-only filesystem checks.
 */
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

/**
 * Configuration section: version, chain id, network, RPC URLs and DB path from the loaded config.
 * The section is WARNING when no RPC URL is set (items still list every value),
 * which is the one diagnose* whose status actually reflects its items.
 * @returns DiagnosticSection named "Configuration".
 * @throws Throws if loadConfig() fails — runDiagnostics does not catch it.
 * Maps to: internal — runDiagnostics.
 * Side effects: read-only config read.
 */
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

/**
 * Contracts section: every proxy address from ProxyGuard plus every implementation address from config.
 * Note the section status is always "OK" — an empty proxy list still reports OK,
 * so callers must read the items.
 * @returns DiagnosticSection named "Contracts" with one item per proxy (status OK) and per implementation (status INFO).
 * @throws Throws if the proxy guard cannot be constructed.
 * Maps to: internal — runDiagnostics.
 * Side effects: read-only (proxy registry + config read).
 */
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

/**
 * Database section: application table list with row counts plus an integrity_check.
 * Note the section status is always "OK" even when the DB open fails — the error
 * is an ERROR item, so callers must read item statuses.
 * @returns DiagnosticSection named "Database"; on DB failure it contains a single "Database Error" item.
 * @throws Never throws: DB errors are caught into an item.
 * Maps to: internal — runDiagnostics.
 * Side effects: read-only DB queries (SELECT COUNT per table + PRAGMA integrity_check).
 */
function diagnoseDatabase(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  try {
    const db = getDatabase();
    // Application tables only: sqlite_sequence is SQLite's internal
    // auto-increment bookkeeping table, not an application table (34, not 35).
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").all() as any[];

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

/**
 * Organizations section: total org count plus the 10 newest orgs with their credential counts.
 * Note the section status is always "OK" — inactive orgs only show as WARNING
 * items, so callers must read item statuses.
 * @returns DiagnosticSection named "Organizations"; on DB failure a single "Error" item.
 * @throws Never throws: DB errors are caught into an item.
 * Maps to: internal — runDiagnostics.
 * Side effects: read-only DB queries.
 */
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

/**
 * Storage section: file counts for the eight per-entity dirs under ~/.agentix.
 * Note the section status is always "OK" — a missing dir is an INFO item, not a
 * warning, so a fresh install with no data reports clean.
 * @returns DiagnosticSection named "Storage"; on filesystem failure a single "Error" item.
 * @throws Never throws: filesystem errors are caught into an item.
 * Maps to: internal — runDiagnostics.
 * Side effects: read-only directory listings.
 */
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
