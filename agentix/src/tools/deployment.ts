import { loadConfig, saveConfig, ensureDirectories, AGENTIX_HOME } from "../core/config";
import { getDatabase } from "../core/database";
import { checkRpcConnection } from "../core/provider";
import { getProxyGuard } from "../core/proxy-guard";
import { logger } from "../core/logger";

export interface DeployResult {
  success: boolean;
  steps: DeployStep[];
  error?: string;
}

export interface DeployStep {
  name: string;
  status: "DONE" | "SKIP" | "ERROR";
  message: string;
}

/**
 * First-run initialization: directories, config, DB, contract list, optional RPC probe.
 * Idempotent — safe to re-run; it overwrites nothing already present except the
 * RPC URL when one is passed. Plain init stays offline-safe: the RPC probe runs
 * ONLY when an explicit URL is given, because checkRpcConnection has no timeout
 * and loadConfig() always fills in a default URL.
 * @param rpcUrl - Optional RPC endpoint to persist; omit to skip the connectivity probe entirely.
 * @returns DeployResult with per-step DONE/SKIP/ERROR statuses; success:false only when the DB step fails (other step failures are recorded but do not fail init).
 * @throws Never throws: step failures are recorded in the steps list.
 * Maps to: CLI 'agentix init' (via wizard initializeFullRuntime).
 * Side effects: creates ~/.agentix/ dirs, writes config, creates/opens the SQLite DB, may probe the network when rpcUrl is given.
 */
export async function initializeAgentix(rpcUrl?: string): Promise<DeployResult> {
  const steps: DeployStep[] = [];

  steps.push({ name: "Create directories", status: "DONE", message: "Created ~/.agentix/ directory structure" });
  ensureDirectories();

  const config = loadConfig();
  if (rpcUrl) config.rpcUrl = rpcUrl;
  saveConfig(config);
  steps.push({ name: "Initialize configuration", status: "DONE", message: "Created agentix.config.json" });

  try {
    getDatabase();
    steps.push({ name: "Initialize SQLite database", status: "DONE", message: "Database created with schema" });
  } catch (e: any) {
    steps.push({ name: "Initialize SQLite database", status: "ERROR", message: e.message });
    return { success: false, steps, error: e.message };
  }

  try {
    const guard = getProxyGuard();
    const proxies = guard.listAllProxies();
    steps.push({ name: "Load contract addresses", status: "DONE", message: `${Object.keys(proxies).length} proxy contracts loaded` });
  } catch (e: any) {
    steps.push({ name: "Load contract addresses", status: "ERROR", message: e.message });
  }

  // Probe the network ONLY when the caller passed an explicit RPC URL.
  // loadConfig() always fills in the default public URL, so gating on
  // config.rpcUrl would make every plain init wait on a network probe
  // (checkRpcConnection has no timeout) — plain init must stay offline-safe.
  // This matters because `init` now invokes initializeAgentix (via wizard.ts):
  // a plain init saves the config and skips the probe; `init --rpc <url>`
  // still verifies the URL it was given.
  if (rpcUrl) {
    try {
      const rpcResult = await checkRpcConnection();
      if (rpcResult.connected) {
        steps.push({ name: "Verify RPC connectivity", status: "DONE", message: `Connected to chain ${rpcResult.chainId}` });
      } else {
        steps.push({ name: "Verify RPC connectivity", status: "SKIP", message: `RPC not connected: ${rpcResult.error}` });
      }
    } catch (e: any) {
      steps.push({ name: "Verify RPC connectivity", status: "SKIP", message: e.message });
    }
  } else {
    steps.push({ name: "Verify RPC connectivity", status: "SKIP", message: "No explicit RPC URL passed — connectivity check skipped" });
  }

  logger.info("deploy", "AgentIX initialized successfully");

  return { success: true, steps };
}

/**
 * Current deployment state as a step list (home dir, config version/chain, network, RPC, contracts, DB table count).
 * Read-only status snapshot for `agentix status`-style output — it never creates
 * or repairs anything, and a missing DB is reported as an ERROR step, not thrown.
 * @returns DeployResult with success:true and one step per subsystem; the Database step is ERROR when the DB cannot be opened.
 * @throws Never throws: failures surface as ERROR steps.
 * Maps to: internal — CLI status display.
 * Side effects: read-only (opens the DB for a table count; may create the DB file if getDatabase initializes it).
 */
export async function showDeploymentStatus(): Promise<DeployResult> {
  const steps: DeployStep[] = [];
  const config = loadConfig();

  steps.push({ name: "AgentIX Home", status: "DONE", message: AGENTIX_HOME });
  steps.push({ name: "Configuration", status: "DONE", message: `v${config.version}, chain ${config.chainId}` });
  steps.push({ name: "Network", status: "DONE", message: config.networkName });
  steps.push({ name: "RPC URL", status: config.rpcUrl ? "DONE" : "SKIP", message: config.rpcUrl || "(not configured)" });

  const guard = getProxyGuard();
  const proxies = guard.listAllProxies();
  steps.push({ name: "Contracts", status: "DONE", message: `${Object.keys(proxies).length} proxy addresses` });

  try {
    const db = getDatabase();
    // Count application tables only: sqlite_sequence is SQLite's internal
    // auto-increment bookkeeping table, not an application table (34, not 35).
    const tables = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").get() as any;
    steps.push({ name: "Database", status: "DONE", message: `${tables?.c || 0} tables` });
  } catch (e: any) {
    steps.push({ name: "Database", status: "ERROR", message: e.message });
  }

  return { success: true, steps };
}
