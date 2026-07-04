import {
  HarnessAdapter,
  HarnessInfo,
  DetectResult,
  ConnectResult,
  HealthCheckResult,
  HealthCheck,
  SyncResult,
  RepairResult,
  MCPConfig,
  MCPEntry,
  AgentIXTool,
} from "./types";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { execSync } from "child_process";

const AGENTIX_MCP_ENTRY: MCPEntry = {
  command: "node",
  args: ["AGENTIX_PATH/dist/src/mcp/index.js"],
};

const AGENTIX_TOOLS: AgentIXTool[] = [
  { name: "agentix_health", description: "System health check", inputSchema: { type: "object", properties: {} } },
  { name: "agentix_stats", description: "System statistics", inputSchema: { type: "object", properties: {} } },
  { name: "agentix_org_list", description: "List organizations", inputSchema: { type: "object", properties: {} } },
  { name: "agentix_org_request", description: "Submit org onboarding request", inputSchema: { type: "object", properties: { name: { type: "string" }, ownerAddress: { type: "string" } }, required: ["name", "ownerAddress"] } },
  { name: "agentix_cred_list", description: "List credentials", inputSchema: { type: "object", properties: { organizationId: { type: "string" } } } },
  { name: "agentix_wallet_create", description: "Deploy a new AgentWallet", inputSchema: { type: "object", properties: { ownerAddress: { type: "string" } } } },
  { name: "agentix_wallet_balance", description: "ETH + EntryPoint deposit balance", inputSchema: { type: "object", properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },
  { name: "agentix_wallet_deposit", description: "Deposit ETH to EntryPoint", inputSchema: { type: "object", properties: { walletAddress: { type: "string" }, amount: { type: "string" } }, required: ["walletAddress", "amount"] } },
  { name: "agentix_wallet_whitelist", description: "Whitelist target+selector on wallet", inputSchema: { type: "object", properties: { walletAddress: { type: "string" }, target: { type: "string" }, selector: { type: "string" } }, required: ["walletAddress", "target", "selector"] } },
  { name: "agentix_wallet_execute", description: "Execute tx through wallet", inputSchema: { type: "object", properties: { walletAddress: { type: "string" }, target: { type: "string" }, value: { type: "string" }, data: { type: "string" } }, required: ["walletAddress", "target"] } },
  { name: "agentix_session_create", description: "Create lightweight session", inputSchema: { type: "object", properties: { walletAddress: { type: "string" }, sessionKey: { type: "string" }, dailySpendLimit: { type: "string" }, dailyTxLimit: { type: "number" }, expirySeconds: { type: "number" } }, required: ["walletAddress", "sessionKey", "dailySpendLimit", "dailyTxLimit", "expirySeconds"] } },
  { name: "agentix_session_validate", description: "Validate a session", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, signer: { type: "string" }, value: { type: "string" } }, required: ["sessionId", "signer"] } },
  { name: "agentix_session_revoke", description: "Revoke a session", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, walletAddress: { type: "string" } }, required: ["sessionId", "walletAddress"] } },
  { name: "agentix_delegation_create", description: "Create delegation", inputSchema: { type: "object", properties: { delegator: { type: "string" }, delegatee: { type: "string" }, scope: { type: "string" }, expirySeconds: { type: "number" } }, required: ["delegator", "delegatee", "scope", "expirySeconds"] } },
  { name: "agentix_delegation_list", description: "List delegations", inputSchema: { type: "object", properties: { organizationId: { type: "string" } } } },
  { name: "agentix_backup_create", description: "Create backup", inputSchema: { type: "object", properties: { description: { type: "string" } } } },
  { name: "agentix_backup_list", description: "List backups", inputSchema: { type: "object", properties: {} } },
  { name: "agentix_protocol_doc", description: "Protocol docs for a topic", inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } },
  { name: "agentix_diagnostics", description: "Full system diagnostics", inputSchema: { type: "object", properties: {} } },
  { name: "agentix_fund", description: "Get fiat on-ramp options for ETH", inputSchema: { type: "object", properties: { network: { type: "string" }, amount: { type: "string" }, currency: { type: "string" }, country: { type: "string" } }, required: ["network", "amount"] } },
];

/** Logo lookup for each supported harness. */
export const HARNESS_LOGOS: Record<string, string> = {
  "claude-code": "https://cdn.anthropic.com/icons/claude-code.svg",
  "mimocode": "https://mimo.ai/favicon.svg",
  "opencode": "https://opencode.ai/favicon.svg",
  "github-copilot": "https://github.githubassets.com/favicons/favicon-dark.svg",
  "hermes": "https://hermes.ai/favicon.svg",
  "cursor": "https://cursor.sh/favicon.svg",
  "windsurf": "https://windsurf.com/favicon.svg",
  "cline": "https://cline.bot/favicon.svg",
};

export abstract class BaseHarnessAdapter implements HarnessAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly configPath: string;
  abstract readonly mcpConfigPath: string;

  /** Returns a logo URL for this harness. Falls back to a generated SVG initial. */
  get logo(): string {
    return HARNESS_LOGOS[this.id] || "";
  }

  /** Tries to detect the installed version by running the harness's CLI. */
  protected async detectVersion(): Promise<string | undefined> {
    try {
      const { execSync } = await import("child_process");
      const binary = this.getVersionCommand();
      if (!binary) return undefined;
      const out = execSync(binary, { timeout: 3000, encoding: "utf-8" });
      return out.trim().split("\n")[0] || undefined;
    } catch {
      return undefined;
    }
  }

  /** Override to provide the version-check command for this harness, e.g. "claude --version". */
  protected getVersionCommand(): string | null { return null; }

  protected abstract getConfigDir(): string;
  protected abstract findConfigPath(): string | null;
  protected abstract findMCPConfigPath(): string | null;
  protected abstract getMCPKey(): string;

  getTools(): AgentIXTool[] {
    return AGENTIX_TOOLS;
  }

  async detect(): Promise<DetectResult> {
    const configPath = this.findConfigPath();
    const mcpConfigPath = this.findMCPConfigPath();
    const configExists = configPath !== null;
    const mcpConfigExists = mcpConfigPath !== null;
    let alreadyConnected = false;

    if (mcpConfigExists && mcpConfigPath) {
      try {
        const raw = readFileSync(mcpConfigPath, "utf-8");
        const config = JSON.parse(raw);
        const key = this.getMCPKey();
        if (config.mcpServers?.[key] || config[key]) {
          alreadyConnected = true;
        }
      } catch {}
    }

    // Detect version asynchronously (best-effort)
    const version = await this.detectVersion();

    const harness: HarnessInfo = {
      id: this.id,
      name: this.name,
      logo: this.logo,
      version,
      configPath: configPath || "",
      mcpConfigPath: mcpConfigPath || "",
      status: alreadyConnected ? "connected" : configExists ? "detected" : "disconnected",
      tools: AGENTIX_TOOLS.map((t) => ({ name: t.name, description: t.description, installed: alreadyConnected })),
      lastChecked: Date.now(),
    };

    return { found: configExists, harness, configExists, mcpConfigExists, alreadyConnected };
  }

  async connect(): Promise<ConnectResult> {
    const mcpConfigPath = this.findMCPConfigPath();
    const agentixPath = this.resolveAgentixPath();

    if (!mcpConfigPath) {
      const configDir = this.getConfigDir();
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      return this.writeMCPConfig(mcpConfigPath || join(configDir, this.getMCPConfigFilename()), agentixPath);
    }

    return this.writeMCPConfig(mcpConfigPath, agentixPath);
  }

  async disconnect(): Promise<{ success: boolean; message: string }> {
    const mcpConfigPath = this.findMCPConfigPath();
    if (!mcpConfigPath || !existsSync(mcpConfigPath)) {
      return { success: false, message: "MCP config not found" };
    }

    try {
      const raw = readFileSync(mcpConfigPath, "utf-8");
      const config = JSON.parse(raw);
      const key = this.getMCPKey();
      if (config.mcpServers?.[key]) {
        delete config.mcpServers[key];
      } else if (config[key]) {
        delete config[key];
      }
      writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
      return { success: true, message: `Disconnected from ${this.name}` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheck[] = [];
    const detectResult = await this.detect();

    checks.push({
      name: "Application Installed",
      status: detectResult.configExists ? "PASS" : "ERROR",
      message: detectResult.configExists ? `${this.name} configuration found` : `${this.name} not found`,
    });

    checks.push({
      name: "MCP Configuration",
      status: detectResult.alreadyConnected ? "PASS" : "WARNING",
      message: detectResult.alreadyConnected ? "AgentIX tools registered" : "AgentIX not connected",
    });

    if (detectResult.alreadyConnected) {
      const agentixPath = this.resolveAgentixPath();
      const mcpJsExists = existsSync(join(agentixPath, "dist/src/mcp/index.js"));
      checks.push({
        name: "AgentIX MCP Server",
        status: mcpJsExists ? "PASS" : "ERROR",
        message: mcpJsExists ? "MCP server build found" : "MCP server not built — run npm run build",
      });
    }

    const healthy = checks.every((c) => c.status === "PASS");
    return {
      healthy,
      harnessId: this.id,
      checks,
      message: healthy ? `${this.name} is healthy and connected` : `${this.name} needs attention`,
    };
  }

  async sync(): Promise<SyncResult> {
    const connectResult = await this.connect();
    return {
      synced: connectResult.success,
      harnessId: this.id,
      toolsAdded: connectResult.toolsInstalled,
      toolsRemoved: 0,
      toolsUpdated: 0,
    };
  }

  async repair(): Promise<RepairResult> {
    const repairs = [];
    const detectResult = await this.detect();

    if (!detectResult.alreadyConnected) {
      const connectResult = await this.connect();
      repairs.push({
        component: "MCP Config",
        action: "Reconnect AgentIX tools",
        success: connectResult.success,
        message: connectResult.message,
      });
    }

    const agentixPath = this.resolveAgentixPath();
    const mcpJsExists = existsSync(join(agentixPath, "dist/src/mcp/index.js"));
    if (!mcpJsExists) {
      try {
        execSync("npm run build", { cwd: agentixPath, stdio: "pipe" });
        repairs.push({
          component: "MCP Server",
          action: "Rebuild",
          success: true,
          message: "MCP server rebuilt successfully",
        });
      } catch (e: any) {
        repairs.push({
          component: "MCP Server",
          action: "Rebuild",
          success: false,
          message: `Build failed: ${e.message}`,
        });
      }
    }

    return {
      repaired: repairs.every((r) => r.success),
      harnessId: this.id,
      repairs,
    };
  }

  async install(): Promise<ConnectResult> {
    return this.connect();
  }

  private writeMCPConfig(configPath: string, agentixPath: string): ConnectResult {
    let config: MCPConfig = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {}
    }

    if (!config.mcpServers) config.mcpServers = {};

    const mcpJsPath = join(agentixPath, "dist/src/mcp/index.js").replace(/\\/g, "\\\\");

    config.mcpServers["agentix"] = {
      command: "node",
      args: [mcpJsPath],
    };

    const dir = dirname(configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    return {
      success: true,
      harnessId: this.id,
      toolsInstalled: AGENTIX_TOOLS.length,
      toolsTotal: AGENTIX_TOOLS.length,
      message: `Connected ${AGENTIX_TOOLS.length} AgentIX tools to ${this.name}`,
      repairsNeeded: [],
    };
  }

  protected resolveAgentixPath(): string {
    let dir = process.cwd();
    while (dir !== dirname(dir)) {
      if (existsSync(join(dir, "package.json"))) {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
          if (pkg.name === "agentix-v1" || pkg.name === "@agentix/core") {
            return dir;
          }
        } catch {}
      }
      dir = dirname(dir);
    }
    return process.cwd();
  }

  protected getMCPConfigFilename(): string {
    return "mcp_config.json";
  }
}
