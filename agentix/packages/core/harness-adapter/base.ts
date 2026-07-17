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

/**
 * Resolve the command an MCP client should run to launch the AgentIX MCP server.
 * Handles every install context so MCP works out of the box:
 *   1. Global npm install  → the `agentix-mcp` bin is on PATH.
 *   2. Published bundle     → <pkg>/mcp.js sits next to package.json.
 *   3. Local dev (compiled) → <pkg>/dist/src/mcp/server.js after `npm run build`.
 *   4. Local dev (source)   → <pkg>/src/mcp/server.ts run via `npx tsx`.
 * The first entry that exists on disk wins; the global bin is preferred because
 * it survives the package being moved or reinstalled.
 */
export function resolveMCPLaunchCommand(agentixPath: string): MCPEntry {
  // (2) Bundled published package: mcp.js at the package root.
  const bundled = join(agentixPath, "mcp.js");
  if (existsSync(bundled)) {
    return { command: "node", args: [bundled] };
  }
  // (3) Compiled dev build.
  const compiled = join(agentixPath, "dist", "src", "mcp", "server.js");
  if (existsSync(compiled)) {
    return { command: "node", args: [compiled] };
  }
  // (4) Source (dev): run the TS entry through tsx.
  const source = join(agentixPath, "src", "mcp", "server.ts");
  if (existsSync(source)) {
    return { command: "npx", args: ["tsx", source] };
  }
  // (1) Fallback: rely on the globally-installed bin shim.
  return { command: "agentix-mcp", args: [] };
}

/** Absolute path to the MCP server entrypoint for a given install, or null. */
export function findMCPServerEntry(agentixPath: string): string | null {
  for (const rel of ["mcp.js", join("dist", "src", "mcp", "server.js"), join("src", "mcp", "server.ts")]) {
    const p = join(agentixPath, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

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
  "gemini": "https://www.gstatic.com/lamda/images/favicon_v3.ico",
  "openclaude": "https://cdn.anthropic.com/icons/claude.svg",
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
      const binary = this.getVersionCommand();
      if (!binary) return undefined;
      // Pipe stderr so a failing/permission-denied binary probe doesn't leak
      // "Access is denied." (Windows) or similar noise to the parent console.
      const out = execSync(binary, { timeout: 3000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return out.trim().split("\n")[0] || undefined;
    } catch {
      return undefined;
    }
  }

  /** Checks if the tool binary is available in PATH. Returns the binary name if found. */
  protected checkBinaryExists(): string | null {
    const cmd = this.getBinaryCheckCommand();
    if (!cmd) return null;
    try {
      // Pipe stderr so a failed lookup (e.g. Windows "Access is denied.") stays quiet.
      const out = execSync(cmd, { timeout: 3000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  /** Override to provide a command that checks if the binary exists, e.g. "where claude" or "which claude". */
  protected getBinaryCheckCommand(): string | null {
    const bin = this.getBinaryName();
    if (!bin) return null;
    return process.platform === "win32" ? `where ${bin} 2>nul` : `which ${bin} 2>/dev/null`;
  }

  /** Override to provide the binary name for existence check. */
  protected getBinaryName(): string | null { return null; }

  /** Override to provide the version-check command for this harness, e.g. "claude --version". */
  protected getVersionCommand(): string | null { return null; }

  protected abstract getConfigDir(): string;
  protected abstract findConfigPath(): string | null;
  protected abstract findMCPConfigPath(): string | null;
  protected abstract getMCPKey(): string;

  getTools(): AgentIXTool[] {
    return AGENTIX_TOOLS;
  }

  /**
   * A registered MCP entry is only "valid" if it can actually launch:
   *   - a file-path argument (node <path>, npx tsx <path>) must exist on disk;
   *   - a bare global bin (agentix-mcp) is assumed launchable via PATH.
   * This lets detect() distinguish a healthy wiring from a stale one that points
   * at a path removed by an upgrade, so re-runs self-heal instead of skipping.
   */
  protected mcpEntryIsValid(entry: MCPEntry): boolean {
    if (!entry || !entry.command) return false;
    const args = entry.args || [];
    // Find a filesystem path among the args (absolute or with a path separator).
    const fileArg = args.find((a) => typeof a === "string" && /[\\/]/.test(a) && /\.(js|ts|cjs|mjs)$/.test(a));
    if (fileArg) return existsSync(fileArg.replace(/\\\\/g, "\\"));
    // No file path (e.g. `agentix-mcp` global bin) — treat as launchable.
    return true;
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
        const entry = config.mcpServers?.[key] || config[key];
        if (entry) {
          // Only count as connected if the entry still points to a launchable
          // server. Stale configs from older versions referenced a path that no
          // longer exists (dist/src/mcp/index.js); those must be re-wired, not
          // treated as healthy — otherwise connectAll() skips and never heals them.
          alreadyConnected = this.mcpEntryIsValid(entry);
        }
      } catch {}
    }

    // Detect version asynchronously (best-effort)
    const version = await this.detectVersion();

    // Verify tool binary exists — config dir alone is not enough (could be stale/empty)
    const binaryFound = this.checkBinaryExists();

    // Require: config exists AND (binary found OR already connected via MCP)
    const found = configExists && (binaryFound !== null || alreadyConnected);

    const harness: HarnessInfo = {
      id: this.id,
      name: this.name,
      logo: this.logo,
      version,
      configPath: configPath || "",
      mcpConfigPath: mcpConfigPath || "",
      status: alreadyConnected ? "connected" : found ? "detected" : "disconnected",
      tools: AGENTIX_TOOLS.map((t) => ({ name: t.name, description: t.description, installed: alreadyConnected })),
      lastChecked: Date.now(),
    };

    return { found, harness, configExists, mcpConfigExists, alreadyConnected };
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
      const mcpEntry = findMCPServerEntry(agentixPath);
      checks.push({
        name: "AgentIX MCP Server",
        status: mcpEntry ? "PASS" : "ERROR",
        message: mcpEntry ? "MCP server build found" : "MCP server not built — run npm run build",
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
    const mcpEntry = findMCPServerEntry(agentixPath);
    if (!mcpEntry) {
      try {
        execSync("npm run build", { cwd: agentixPath, stdio: "pipe" });
        repairs.push({
          component: "MCP Server",
          action: "Rebuild",
          success: !!findMCPServerEntry(agentixPath),
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

    // Resolve a launch command that actually works in the caller's install
    // context (global npx bin, bundled mcp.js, dev build, or tsx source).
    config.mcpServers["agentix"] = resolveMCPLaunchCommand(agentixPath);

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
          if (pkg.name === "agentix" || pkg.name === "agentix-v1" || pkg.name === "@agentix/core") {
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
