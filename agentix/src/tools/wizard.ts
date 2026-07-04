import { loadConfig, ensureDirectories, AGENTIX_HOME } from "../core/config";
import { getDatabase } from "../core/database";
import { existsSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export interface DiagnosticItem {
  label: string;
  status: "OK" | "WARNING" | "ERROR" | "INFO";
  value: string;
  repair?: string;
}

export interface DiagnosticSection {
  name: string;
  status: "OK" | "WARNING" | "ERROR";
  items: DiagnosticItem[];
}

export interface DiagnosticResult {
  timestamp: number;
  sections: DiagnosticSection[];
  overall: "OK" | "WARNING" | "ERROR";
  repairable: number;
  summary: string;
}

export interface InitStep {
  name: string;
  status: "pending" | "running" | "done" | "error" | "skip";
  message: string;
  duration?: number;
}

export interface InitResult {
  success: boolean;
  steps: InitStep[];
  config: any;
  databaseReady: boolean;
  directoriesCreated: boolean;
  harnessesDetected: number;
  harnessesConnected: number;
}

export async function runFullDiagnostics(): Promise<DiagnosticResult> {
  const sections: DiagnosticSection[] = [];
  let repairable = 0;

  sections.push(await checkNodeJS());
  sections.push(await checkNPM());
  sections.push(await checkSQLite());
  sections.push(await checkRuntime());
  sections.push(await checkDatabase());
  sections.push(await checkDirectories());
  sections.push(await checkRPC());
  sections.push(await checkContracts());
  sections.push(await checkDashboard());
  sections.push(await checkMCP());
  sections.push(await checkBackups());
  sections.push(await checkHarnesses());

  for (const section of sections) {
    for (const item of section.items) {
      if (item.repair) repairable++;
    }
  }

  const hasError = sections.some((s) => s.status === "ERROR");
  const hasWarning = sections.some((s) => s.status === "WARNING");
  const overall = hasError ? "ERROR" : hasWarning ? "WARNING" : "OK";

  const summary = overall === "OK"
    ? "All systems operational"
    : overall === "WARNING"
    ? `${repairable} issue(s) detected — auto-repair available`
    : `${sections.filter((s) => s.status === "ERROR").length} critical issue(s) detected`;

  return { timestamp: Date.now(), sections, overall, repairable, summary };
}

async function checkNodeJS(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const version = process.version;
  const major = parseInt(version.replace("v", "").split(".")[0]);
  items.push({
    label: "Node.js Version",
    status: major >= 18 ? "OK" : "ERROR",
    value: version,
    repair: major < 18 ? "Install Node.js 18+ from https://nodejs.org" : undefined,
  });
  return { name: "Node.js", status: items.some((i) => i.status === "ERROR") ? "ERROR" : "OK", items };
}

async function checkNPM(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  try {
    const version = execSync("npm --version", { encoding: "utf-8" }).trim();
    items.push({ label: "NPM Version", status: "OK", value: version });
  } catch {
    items.push({ label: "NPM Version", status: "ERROR", value: "Not found", repair: "Install npm: npm install -g npm" });
  }
  return { name: "NPM", status: items.some((i) => i.status === "ERROR") ? "ERROR" : "OK", items };
}

async function checkSQLite(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  try {
    require.resolve("better-sqlite3");
    items.push({ label: "better-sqlite3", status: "OK", value: "Installed" });
  } catch {
    items.push({ label: "better-sqlite3", status: "ERROR", value: "Not installed", repair: "Run: npm install better-sqlite3" });
  }
  return { name: "SQLite", status: items.some((i) => i.status === "ERROR") ? "ERROR" : "OK", items };
}

async function checkRuntime(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const configExists = existsSync(join(AGENTIX_HOME, "config", "agentix.config.json"));
  items.push({
    label: "Configuration",
    status: configExists ? "OK" : "WARNING",
    value: configExists ? "Found" : "Not initialized",
    repair: configExists ? undefined : "Run: agentix init",
  });
  return { name: "Runtime", status: items.some((i) => i.status === "ERROR") ? "ERROR" : items.some((i) => i.status === "WARNING") ? "WARNING" : "OK", items };
}

async function checkDatabase(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  try {
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    items.push({ label: "Database", status: "OK", value: `${tables.length} tables` });

    const sizePath = loadConfig().database.path;
    if (existsSync(sizePath)) {
      const size = statSync(sizePath).size;
      items.push({ label: "Database Size", status: size < 100 * 1024 * 1024 ? "OK" : "WARNING", value: `${(size / 1024).toFixed(1)} KB` });
    }
  } catch (e: any) {
    items.push({ label: "Database", status: "ERROR", value: e.message, repair: "Run: agentix init" });
  }
  return { name: "Database", status: items.some((i) => i.status === "ERROR") ? "ERROR" : "OK", items };
}

async function checkDirectories(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const dirs = ["config", "contracts", "organizations", "trees", "credentials", "sessions", "wallets", "proofs", "capabilities", "delegations", "logs", "db", "tools", "cache", "backups"];
  let ok = 0;
  let missing = 0;
  for (const d of dirs) {
    const p = join(AGENTIX_HOME, d);
    if (existsSync(p)) ok++;
    else missing++;
  }
  items.push({
    label: "Directories",
    status: missing === 0 ? "OK" : "WARNING",
    value: `${ok}/${dirs.length} present`,
    repair: missing > 0 ? "Run: agentix init" : undefined,
  });
  return { name: "Storage", status: missing === 0 ? "OK" : "WARNING", items };
}

async function checkRPC(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const config = loadConfig();
  items.push({
    label: "RPC Endpoint",
    status: config.rpcUrl ? "OK" : "WARNING",
    value: config.rpcUrl || "Not configured",
    repair: config.rpcUrl ? undefined : "Run: agentix config set rpcUrl https://sepolia.base.org",
  });
  items.push({ label: "Network", status: "OK", value: `${config.networkName} (Chain ${config.chainId})` });
  return { name: "Network", status: items.some((i) => i.status === "WARNING") ? "WARNING" : "OK", items };
}

async function checkContracts(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const config = loadConfig();
  const contracts = config.contracts;
  let configured = 0;
  let missing = 0;
  for (const [name, addr] of Object.entries(contracts)) {
    if (addr && addr !== "0x0000000000000000000000000000000000000000") configured++;
    else missing++;
  }
  items.push({ label: "Contract Addresses", status: missing === 0 ? "OK" : "WARNING", value: `${configured} configured` });
  return { name: "Contracts", status: "OK", items };
}

async function checkDashboard(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const dashboardPath = join(process.cwd(), "apps", "dashboard");
  const exists = existsSync(dashboardPath);
  items.push({ label: "Dashboard App", status: exists ? "OK" : "WARNING", value: exists ? "Found" : "Not found" });
  if (exists) {
    const pkgExists = existsSync(join(dashboardPath, "package.json"));
    items.push({ label: "Dashboard Dependencies", status: pkgExists ? "OK" : "WARNING", value: pkgExists ? "package.json found" : "Missing" });
  }
  return { name: "Dashboard", status: "OK", items };
}

async function checkMCP(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const mcpPath = join(process.cwd(), "dist", "src", "mcp", "index.js");
  items.push({
    label: "MCP Server",
    status: existsSync(mcpPath) ? "OK" : "WARNING",
    value: existsSync(mcpPath) ? "Built" : "Not built",
    repair: existsSync(mcpPath) ? undefined : "Run: npm run build",
  });
  return { name: "MCP Server", status: items.some((i) => i.status === "WARNING") ? "WARNING" : "OK", items };
}

async function checkBackups(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const backupDir = join(AGENTIX_HOME, "backups");
  const exists = existsSync(backupDir);
  items.push({ label: "Backup Directory", status: exists ? "OK" : "WARNING", value: exists ? "Ready" : "Not created" });
  return { name: "Backups", status: "OK", items };
}

async function checkHarnesses(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  try {
    const { getHarnessManager } = await import("../../packages/core/harness-adapter");
    const manager = getHarnessManager();
    const scan = await manager.scanAll();
    items.push({
      label: "Detected Harnesses",
      status: scan.totalDetected > 0 ? "OK" : "INFO",
      value: `${scan.totalDetected} detected, ${scan.totalConnected} connected`,
    });
    for (const h of scan.harnesses) {
      items.push({
        label: h.adapter.name,
        status: h.detect.alreadyConnected ? "OK" : h.detect.found ? "WARNING" : "INFO",
        value: h.detect.alreadyConnected ? "Connected" : h.detect.found ? "Detected (not connected)" : "Not found",
      });
    }
  } catch {
    items.push({ label: "Harness Detection", status: "INFO", value: "Module not available" });
  }
  return { name: "AI Harnesses", status: "OK", items };
}

export async function initializeFullRuntime(rpcUrl?: string): Promise<InitResult> {
  const steps: InitStep[] = [];
  const startTime = Date.now();

  const runStep = async (name: string, fn: () => Promise<string | null>): Promise<void> => {
    const step: InitStep = { name, status: "running", message: "", duration: 0 };
    steps.push(step);
    const stepStart = Date.now();
    try {
      const msg = await fn();
      step.status = msg === null ? "skip" : "done";
      step.message = msg || `${name} skipped (already exists)`;
      step.duration = Date.now() - stepStart;
    } catch (e: any) {
      step.status = "error";
      step.message = e.message;
      step.duration = Date.now() - stepStart;
    }
  };

  let harnessesDetected = 0;
  let harnessesConnected = 0;

  await runStep("Create directories", async () => {
    ensureDirectories();
    return "Directories created";
  });

  await runStep("Initialize database", async () => {
    getDatabase();
    return "Database initialized";
  });

  await runStep("Configure network", async () => {
    if (rpcUrl) {
      const { saveConfig } = await import("../core/config");
      saveConfig({ rpcUrl });
      return `RPC configured: ${rpcUrl}`;
    }
    return null;
  });

  await runStep("Detect AI harnesses", async () => {
    try {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const scan = await manager.scanAll();
      harnessesDetected = scan.totalDetected;
      harnessesConnected = scan.totalConnected;
      return `Found ${scan.totalDetected} harness(es), ${scan.totalConnected} connected`;
    } catch {
      return null;
    }
  });

  await runStep("Connect harnesses", async () => {
    try {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const results = await manager.connectAll();
      harnessesConnected += results.totalConnected;
      return results.totalConnected > 0 ? `Connected to ${results.totalConnected} harness(es)` : null;
    } catch {
      return null;
    }
  });

  await runStep("Initialize event bus", async () => {
    const { getEventBus } = await import("../../packages/core/eventbus");
    getEventBus();
    return "Event bus ready";
  });

  await runStep("Verify health", async () => {
    const config = loadConfig();
    const hasRpc = !!config.rpcUrl;
    return hasRpc ? "System healthy" : "System initialized (configure RPC for full functionality)";
  });

  const config = loadConfig();
  return {
    success: steps.every((s) => s.status !== "error"),
    steps,
    config,
    databaseReady: true,
    directoriesCreated: true,
    harnessesDetected,
    harnessesConnected,
  };
}
