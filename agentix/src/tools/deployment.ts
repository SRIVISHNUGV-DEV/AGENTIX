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

  if (config.rpcUrl) {
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
    steps.push({ name: "Verify RPC connectivity", status: "SKIP", message: "No RPC URL configured" });
  }

  logger.info("deploy", "AgentIX initialized successfully");

  return { success: true, steps };
}

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
    const tables = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as any;
    steps.push({ name: "Database", status: "DONE", message: `${tables?.c || 0} tables` });
  } catch (e: any) {
    steps.push({ name: "Database", status: "ERROR", message: e.message });
  }

  return { success: true, steps };
}
