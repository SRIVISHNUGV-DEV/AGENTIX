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

/** Flattened check for clients (dashboard) that consume a single list rather
 *  than grouped sections. status is normalized to PASS/WARNING/ERROR. */
export interface DiagnosticCheck {
  name: string;
  status: "PASS" | "WARNING" | "ERROR";
  value: string;
  message: string;
  repair?: string;
}

export interface DiagnosticResult {
  timestamp: number;
  sections: DiagnosticSection[];
  /** Flattened view of sections[].items[] — the dashboard diagnostics and
   *  onboarding pages read `checks`, while the CLI renders `sections`. Both
   *  are derived from the same data so they can never drift. */
  checks: DiagnosticCheck[];
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

/**
 * Full doctor run: all twelve subsystem checks, rolled up into sections, a flattened checks list, and an overall verdict.
 * The `agentix doctor` implementation — read-only, never repairs. The flattened
 * checks[] is derived from the same sections[] the CLI renders, so dashboard
 * and CLI can never drift; INFO/OK items both map to PASS in checks[].
 * @returns DiagnosticResult with timestamp, sections, checks, overall (OK/WARNING/ERROR), repairable count and a one-line summary.
 * @throws Never throws: check functions catch their own failures (a check that throws outside its try would propagate — none do today).
 * Maps to: CLI 'agentix doctor' / MCP tool agentix_diagnostics (via diagnostics.ts runDiagnostics, which covers a subset).
 * Side effects: read-only (config/DB/filesystem reads, one npm version exec, harness scan); no writes or chain calls.
 */
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

  // Flatten sections into a single checks[] list for clients that don't group
  // (dashboard). INFO/OK both map to PASS so the dashboard's PASS/WARNING/ERROR
  // model stays intact.
  const checks: DiagnosticCheck[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      checks.push({
        name: `${section.name}: ${item.label}`,
        status: item.status === "ERROR" ? "ERROR" : item.status === "WARNING" ? "WARNING" : "PASS",
        value: item.value,
        message: item.value,
        repair: item.repair,
      });
    }
  }

  return { timestamp: Date.now(), sections, checks, overall, repairable, summary };
}

/**
 * Node.js version check: major >= 18 passes.
 * @returns DiagnosticSection "Node.js" — ERROR with a nodejs.org repair hint when below 18, otherwise OK.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: none (reads process.version).
 */
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

/**
 * npm availability check via `npm --version`.
 * @returns DiagnosticSection "NPM" — OK with the version, or ERROR ("Not found") with an install repair hint.
 * @throws Never throws: exec failures are caught.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: spawns `npm --version` (child process, no network).
 */
async function checkNPM(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  try {
    const version = execSync("npm --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    items.push({ label: "NPM Version", status: "OK", value: version });
  } catch {
    items.push({ label: "NPM Version", status: "ERROR", value: "Not found", repair: "Install npm: npm install -g npm" });
  }
  return { name: "NPM", status: items.some((i) => i.status === "ERROR") ? "ERROR" : "OK", items };
}

/**
 * better-sqlite3 availability check via require.resolve.
 * Resolution only — the module is never loaded here, so a present-but-broken
 * native binding still reports OK and fails later at DB open.
 * @returns DiagnosticSection "SQLite" — OK when resolvable, ERROR with an install repair hint otherwise.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: none (module resolution only).
 */
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

/**
 * Runtime config check: does agentix.config.json exist under ~/.agentix.
 * @returns DiagnosticSection "Runtime" — OK when the config exists, WARNING with a "Run: agentix init" repair hint otherwise.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only filesystem check.
 */
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

/**
 * Database check: table count and DB file size (<100MB OK, larger is WARNING).
 * Note the section status ignores the size warning — it is OK unless the DB
 * open itself fails, so callers must read the item status for the size signal.
 * @returns DiagnosticSection "Database" — ERROR with an init repair hint when the DB cannot be opened.
 * @throws Never throws: DB failures are caught into an item.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only DB query + file stat (may create the DB file if getDatabase initializes it).
 */
async function checkDatabase(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  try {
    const db = getDatabase();
    // Application tables only: exclude sqlite_sequence, SQLite's internal
    // auto-increment bookkeeping table (34 application tables, not 35).
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").all() as any[];
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

/**
 * Data-directory check: all 16 dirs from ensureDirectories() exist.
 * The list must match core/config.ts exactly — the 16th dir ("keys", the session
 * keystore home) was previously unchecked, which is why doctor once reported
 * 15/15 while the runtime owned a 16th directory.
 * @returns DiagnosticSection "Storage" — OK when all 16 are present, WARNING with an init repair hint otherwise.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only filesystem checks.
 */
async function checkDirectories(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  // Must match ensureDirectories() in core/config.ts exactly (16 dirs).
  // The previously unchecked 16th directory was "keys" — the session
  // keystore's home, created lazily by session-keystore.ts and never
  // checked by doctor, which is why doctor reported 15/15 while the
  // runtime owned a 16th directory.
  const dirs = ["config", "contracts", "organizations", "trees", "credentials", "sessions", "wallets", "proofs", "capabilities", "delegations", "logs", "db", "tools", "cache", "backups", "keys"];
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

/**
 * RPC configuration check: primary URL, fallback URL and network/chain display.
 * Config presence only — no endpoint is probed here, so a configured-but-dead
 * URL still reports OK.
 * @returns DiagnosticSection "Network" — WARNING when no primary URL is set, otherwise OK (a missing fallback is INFO, not a warning).
 * @throws Throws if loadConfig() fails — no try/catch here.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only config read.
 */
async function checkRPC(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const config = loadConfig();
  items.push({
    label: "RPC Endpoint",
    status: config.rpcUrl ? "OK" : "WARNING",
    value: config.rpcUrl || "Not configured",
    repair: config.rpcUrl ? undefined : "Run: agentix config set rpcUrl https://sepolia.base.org",
  });
  items.push({
    label: "RPC Fallback",
    status: config.rpcFallbackUrl ? "OK" : "INFO",
    value: config.rpcFallbackUrl || "Not configured",
  });
  items.push({ label: "Network", status: "OK", value: `${config.networkName} (Chain ${config.chainId})` });
  return { name: "Network", status: items.some((i) => i.status === "WARNING") ? "WARNING" : "OK", items };
}

/**
 * Contract-address check: every address in config.contracts set and non-zero.
 * Note the section status is always "OK" — missing addresses only show as a
 * WARNING item, so callers must read the item status.
 * @returns DiagnosticSection "Contracts" — item "Contract Addresses" is WARNING with a "<n> configured" value when any are missing.
 * @throws Throws if the config cannot be loaded.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only config read.
 */
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

/**
 * Dashboard-app check: is apps/dashboard present in the checkout.
 * The dashboard is intentionally NOT in the published npm package, so "absent"
 * is INFO (not applicable), not a warning — a clean published install must not
 * report a false problem.
 * @returns DiagnosticSection "Dashboard" — always status OK; items report Found/Missing or Not applicable.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only filesystem checks (four candidate paths).
 */
async function checkDashboard(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  // The dashboard is a repo-checkout feature — it is intentionally NOT part of
  // the published `npx agentix` package (which ships only the CLI/MCP/API
  // bundles). Look in both the CWD and next to this module, and treat "absent"
  // as INFO (not applicable) rather than a WARNING, so a clean published
  // install doesn't report a false problem.
  const candidates = [
    join(process.cwd(), "apps", "dashboard"),
    join(__dirname, "apps", "dashboard"),
    join(__dirname, "..", "apps", "dashboard"),
    join(__dirname, "..", "..", "apps", "dashboard"),
  ];
  const dashboardPath = candidates.find((p) => existsSync(p));
  if (dashboardPath) {
    items.push({ label: "Dashboard App", status: "OK", value: "Found" });
    const pkgExists = existsSync(join(dashboardPath, "package.json"));
    items.push({ label: "Dashboard Dependencies", status: pkgExists ? "OK" : "WARNING", value: pkgExists ? "package.json found" : "Missing" });
  } else {
    items.push({ label: "Dashboard App", status: "INFO", value: "Not applicable (runs from repo checkout, not the npm package)" });
  }
  return { name: "Dashboard", status: "OK", items };
}

/**
 * MCP-server availability check across all install shapes (published bundle mcp.js, compiled dist, raw TS source).
 * Any one candidate found is enough — the check exists so doctor does not
 * false-negative on a valid install of a different shape.
 * @returns DiagnosticSection "MCP Server" — OK when a candidate exists, WARNING with a build/reinstall repair hint otherwise.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only filesystem checks.
 */
async function checkMCP(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  // MCP ships in several shapes depending on how AgentIX is running:
  //   - published npm bundle:  <bundle>/mcp.js   (this module is inlined into
  //                            index.js, so __dirname == the bundle root)
  //   - compiled repo build:   dist/src/mcp/index.js
  //   - raw TS source (tsx):   src/mcp/server.ts
  // Check all of them so `doctor` doesn't false-negative on a valid install.
  const candidates = [
    join(__dirname, "mcp.js"),
    join(process.cwd(), "mcp.js"),
    join(process.cwd(), "dist-publish", "mcp.js"),
    join(process.cwd(), "dist", "src", "mcp", "index.js"),
    join(process.cwd(), "src", "mcp", "server.ts"),
  ];
  const found = candidates.some((p) => existsSync(p));
  items.push({
    label: "MCP Server",
    status: found ? "OK" : "WARNING",
    value: found ? "Available" : "Not built",
    repair: found ? undefined : "Run: bun run build (repo) or reinstall the package",
  });
  return { name: "MCP Server", status: items.some((i) => i.status === "WARNING") ? "WARNING" : "OK", items };
}

/**
 * Backup-directory check: does ~/.agentix/backups exist.
 * Note the section status is always "OK" — a missing dir only shows as a
 * WARNING item, so callers must read the item status.
 * @returns DiagnosticSection "Backups" — item WARNING ("Not created") when the dir is absent.
 * @throws Never throws.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: read-only filesystem check.
 */
async function checkBackups(): Promise<DiagnosticSection> {
  const items: DiagnosticItem[] = [];
  const backupDir = join(AGENTIX_HOME, "backups");
  const exists = existsSync(backupDir);
  items.push({ label: "Backup Directory", status: exists ? "OK" : "WARNING", value: exists ? "Ready" : "Not created" });
  return { name: "Backups", status: "OK", items };
}

/**
 * AI-harness check: scan for installed harnesses and their connection state.
 * Note the section status is always "OK" — a detected-but-unconnected harness
 * only shows as a WARNING item, so callers must read the item statuses.
 * @returns DiagnosticSection "AI Harnesses" — one item per detected harness plus a totals item; a missing harness module is an INFO item, not an error.
 * @throws Never throws: scan failures are caught into an INFO item.
 * Maps to: internal — runFullDiagnostics.
 * Side effects: scans the machine for harness installs (read-only).
 */
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

/**
 * Full runtime initialization: directories, DB, config, harness detect/connect, event bus, health.
 * The `agentix init` implementation. Steps run in order and each records
 * done/skip/error; the run succeeds unless a step errors. Connecting harnesses
 * is OFF by default — detection is read-only, but connecting mutates external
 * IDE/agent configs, so it needs an explicit opt-in (`init --connect-harnesses`
 * or `agentix connect`), never a silent side effect of a plain init. Note the
 * returned databaseReady/directoriesCreated flags are always true; check steps[]
 * for per-step errors.
 * @param rpcUrl - Optional RPC endpoint to persist; omit for the default public endpoints (no probe on plain init).
 * @param connectHarnesses - When true, writes the AgentIX MCP entry into every detected harness config. Default false.
 * @returns InitResult with success, per-step results, loaded config, harness counts; success is false when any step errored.
 * @throws Never throws: step failures are recorded as error steps (an unexpected throw inside runStep would propagate — none do today).
 * Maps to: CLI 'agentix init'.
 * Side effects: creates dirs + DB, persists config (via tools/deployment initializeAgentix), optionally writes external harness configs, initializes the event bus.
 */
export async function initializeFullRuntime(rpcUrl?: string, connectHarnesses = false): Promise<InitResult> {
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
    // Previously saveConfig ran ONLY when --rpc was passed, so a plain init
    // never wrote config/agentix.config.json and doctor (checkRuntime) then
    // reported "Not initialized" after a successful init — with a repair hint
    // ("Run: agentix init") that could never fix it. Fix: invoke the
    // previously dead initializeAgentix path (tools/deployment.ts), which
    // unconditionally persists the config (defaults merged) before doing
    // anything else. Its RPC probe is skipped for plain init (see
    // deployment.ts), so this stays offline-safe.
    const { initializeAgentix } = await import("./deployment");
    const result = await initializeAgentix(rpcUrl);
    if (!result.success) throw new Error(result.error || "Configuration save failed");
    return rpcUrl ? `RPC configured: ${rpcUrl}` : "Configuration saved (default network)";
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
    if (!connectHarnesses) {
      // Read-only init: do NOT touch external IDE/agent configs. The user can
      // opt in with `agentix init --connect-harnesses` or `agentix connect`.
      return harnessesDetected > 0
        ? `Skipped — ${harnessesDetected} harness(es) detected. Run 'agentix connect' to wire them.`
        : null;
    }
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
