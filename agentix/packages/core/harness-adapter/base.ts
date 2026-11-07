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
 * Resolves the command an MCP client should run to launch the AgentIX MCP server.
 * Why: every install context launches the server differently (global bin, bundled mcp.js, compiled dist, or tsx source), and MCP must work out of the box in all of them — the first entry that exists on disk wins, with the global bin preferred because it survives the package being moved or reinstalled.
 * @param agentixPath Root of the agentix package to probe for a server entrypoint.
 * @returns An MCPEntry: bundled `node mcp.js`, compiled `node dist/src/mcp/server.js`, source `npx tsx src/mcp/server.ts`, or the `agentix-mcp` global bin as fallback when none exists on disk.
 * @throws Nothing — existence checks only; a missing entrypoint falls through to the global-bin fallback instead of throwing.
 * Maps to: MCP config mcpServers.agentix entry (the launch command written into each harness's MCP config).
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

/**
 * Returns the absolute path of the MCP server entrypoint for an install, or null.
 * Why: healthCheck and repair need to know whether a buildable/runnable server exists at all, without deciding how to launch it.
 * @param agentixPath Root of the agentix package to probe, in the same order as resolveMCPLaunchCommand (mcp.js, then dist build, then tsx source).
 * @returns The first existing entrypoint path, or null when none of the three layouts is present.
 * @throws Nothing — existence checks only.
 * Maps to: internal — BaseHarnessAdapter.healthCheck / repair (the "is the server built?" check).
 */
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

  /**
   * Returns this harness's logo URL for display, or "" when it has none.
   * Why: detect() stamps the logo into HarnessInfo so the UI can render the harness without its own lookup table.
   * @returns The URL from HARNESS_LOGOS for this id, or "" for an unlisted harness (note: the doc comment's "generated SVG initial" fallback is not implemented — "" is returned).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (HarnessInfo.logo).
   */
  get logo(): string {
    return HARNESS_LOGOS[this.id] || "";
  }

  /**
   * Probes the harness's CLI for its installed version, best-effort.
   * Why: detect() wants a version string, but a missing or broken binary must never fail detection — so failures silently yield undefined.
   * @returns The first line of the version command's stdout, trimmed, or undefined when no version command exists, the binary fails, or the 3s timeout fires.
   * @throws Nothing — all exec failures are swallowed.
   * Maps to: internal — BaseHarnessAdapter.detect (HarnessInfo.version).
   * Side effects: runs a child process (the harness CLI) with a 3s timeout; stderr is piped so probe noise never leaks to the parent console.
   */
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

  /**
   * Checks whether the harness's tool binary is on PATH.
   * Why: detect() requires more than a config dir — a stale/empty config without the binary is not a real install.
   * @returns The binary's resolved path (stdout of the check command, trimmed), or null when there is no check command, the binary is absent, or the 3s timeout fires.
   * @throws Nothing — all exec failures are swallowed.
   * Maps to: internal — BaseHarnessAdapter.detect (the `found` decision).
   * Side effects: runs a child process (`which`/`where`) with a 3s timeout; stderr is piped to stay quiet.
   */
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

  /**
   * Returns the shell command that checks whether the harness binary exists.
   * Why: the check differs per OS (`where` on Windows, `which` elsewhere); subclasses override getBinaryName and get this for free.
   * @returns `where <bin> 2>nul` on win32, `which <bin> 2>/dev/null` elsewhere, or null when the subclass defines no binary name.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.checkBinaryExists (the command it runs).
   */
  protected getBinaryCheckCommand(): string | null {
    const bin = this.getBinaryName();
    if (!bin) return null;
    return process.platform === "win32" ? `where ${bin} 2>nul` : `which ${bin} 2>/dev/null`;
  }

  /**
   * Returns the harness's binary name for existence checks.
   * Why: the base class needs one hook per harness — the name is the only thing that varies between `which claude` and `which cursor`.
   * @returns The binary name, or null in the base class (subclasses override; a null means "no binary to check").
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.getBinaryCheckCommand (the name it embeds in the check).
   */
  protected getBinaryName(): string | null { return null; }

  /**
   * Returns the command that prints the harness's version.
   * Why: detectVersion needs one hook per harness (e.g. "claude --version"); the base default is "no version command".
   * @returns The version command, or null in the base class (subclasses override; null means "version unknown").
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detectVersion (the command it runs).
   */
  protected getVersionCommand(): string | null { return null; }

  /**
   * Returns the directory that holds this harness's configuration.
   * Why: connect() needs a place to write the MCP config when no config file exists yet.
   * @returns The harness-specific config directory (e.g. ~/.claude).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected abstract getConfigDir(): string;
  /**
   * Returns the path of this harness's config file/dir, or null when not installed.
   * Why: detect() uses existence as the "is this harness installed?" signal — subclasses probe the known locations in order.
   * @returns The first existing config path, or null when none of the known locations exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected abstract findConfigPath(): string | null;
  /**
   * Returns the path of this harness's MCP config file, or null when it does not exist.
   * Why: detect() and connect() both need the exact file to read or write the `agentix` MCP entry in.
   * @returns The first existing MCP config path, or null when none of the known locations exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the file the MCP entry is read from / written to).
   */
  protected abstract findMCPConfigPath(): string | null;
  /**
   * Returns the key under which the AgentIX entry lives in this harness's MCP config.
   * Why: harnesses differ in where the entry sits (top-level key vs under mcpServers); the key tells detect/disconnect which entry is ours.
   * @returns The MCP server key, conventionally "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected abstract getMCPKey(): string;

  /**
   * Returns the full list of AgentIX tools this harness can call.
   * Why: every harness exposes the same tool surface, so the list lives once in the base class instead of being duplicated per adapter.
   * @returns The shared AGENTIX_TOOLS array (same reference every call — callers must not mutate it).
   * @throws Nothing.
   * Maps to: MCP tool agentix_* — the tool list served to the harness over MCP.
   */
  getTools(): AgentIXTool[] {
    return AGENTIX_TOOLS;
  }

  /**
   * Returns true when a registered MCP entry could actually launch the server.
   * Why: a stale entry pointing at a path removed by an upgrade must not count as "connected" — otherwise connectAll() skips it and never heals the wiring.
   * @param entry The MCP entry from the harness config; a missing entry or empty command is invalid.
   * @returns False for a missing/empty entry; true when a file-path arg in the entry exists on disk, or when there is no file arg (a bare global bin like `agentix-mcp` is assumed launchable via PATH).
   * @throws Nothing — existence checks only.
   * Maps to: internal — BaseHarnessAdapter.detect (the alreadyConnected decision).
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

  /**
   * Detects whether this harness is installed and whether AgentIX is already wired into it.
   * Why: the entry point for scan/connect/repair — everything downstream keys off `found` and `alreadyConnected`, so detection must be strict (config alone is not enough).
   * @returns DetectResult with `found` (config exists AND (binary on PATH OR already connected)), the HarnessInfo (status connected/detected/disconnected, tools marked installed only when connected), and configExists/mcpConfigExists/alreadyConnected flags.
   * @throws Nothing — a malformed MCP config is swallowed and treated as not connected; version/binary probes fail soft.
   * Maps to: internal — HarnessManager.scanAll (which calls detect on every adapter).
   * Side effects: reads the MCP config file from disk and runs the version/binary probes as child processes.
   */
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

  /**
   * Writes the AgentIX MCP entry into this harness's config, creating the config dir/file when needed.
   * Why: the one action that actually wires the tools into the harness — detect() only reports, connect() changes state.
   * @returns ConnectResult with success, toolsInstalled/toolsTotal (both = the AGENTIX_TOOLS count on success), and a message.
   * @throws Nothing — writeMCPConfig reports success unconditionally once the write completes; a thrown write error would propagate, so callers that must not throw should use HarnessManager.connectAll.
   * Maps to: MCP config mcpServers.agentix entry (the entry this writes).
   * Side effects: creates the config directory when missing and writes (or overwrites) the MCP config file, preserving other servers already in it.
   * Security note: the written entry launches the local MCP server — a malicious agentixPath could point the harness at an attacker-controlled server, so resolveAgentixPath must only ever return the real package root.
   */
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

  /**
   * Removes the AgentIX MCP entry from this harness's config.
   * Why: the clean off-ramp for connect() — uninstalling must remove only our entry and leave the rest of the user's MCP config intact.
   * @returns `{ success, message }` — success:false with "MCP config not found" when there is no config file; success:true after the entry is deleted and the file rewritten.
   * @throws Nothing — read/parse/write failures are caught and returned as `{ success: false, message }`.
   * Maps to: MCP config mcpServers.agentix entry (the entry this removes).
   * Side effects: rewrites the MCP config file with our key deleted (under mcpServers or top-level, whichever held it).
   */
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

  /**
   * Runs the install / MCP-config / server-build checks for this harness.
   * Why: a single verdict for "is this harness usable right now?" — the dashboard and diagnostics consume it instead of re-implementing the checks.
   * @returns HealthCheckResult with `healthy` true only when every check passes, plus per-check PASS/WARNING/ERROR entries; the MCP-server check runs only when already connected.
   * @throws Nothing — detect() fails soft, so healthCheck returns a result rather than throwing.
   * Maps to: MCP tool agentix_health (the health surface this backs).
   * Side effects: reads config files and runs version/binary probes via detect().
   */
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

  /**
   * Re-wires the harness (connect) and reports the tool counts.
   * Why: the periodic "make sure the wiring is still there" step — syncAll() calls it only for harnesses that are already connected, to refresh the tool list after an upgrade.
   * @returns SyncResult with synced = connect success, toolsAdded = tools installed by the reconnect, toolsRemoved/toolsUpdated always 0.
   * @throws Nothing — connect failures surface as synced:false rather than throwing (except a raw write error escaping connect, which would propagate).
   * Maps to: internal — HarnessManager.syncAll (the only caller).
   * Side effects: rewrites the MCP config file via connect().
   */
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

  /**
   * Reconnects a disconnected harness and rebuilds the MCP server when it is missing.
   * Why: the self-heal path — a stale config or a missing build is fixed in place instead of surfacing as a manual setup error.
   * @returns RepairResult with `repaired` true only when every repair step succeeded, plus per-component repair records (MCP Config reconnect, and MCP Server rebuild when no entrypoint was found).
   * @throws Nothing — a failed `npm run build` is caught and recorded as a failed repair step, not thrown.
   * Maps to: internal — HarnessManager.repairAll (the only caller).
   * Side effects: may rewrite the MCP config (via connect) and runs `npm run build` in the agentix package dir when the server entrypoint is missing.
   */
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

  /**
   * Installs the AgentIX tools into this harness (alias for connect).
   * Why: the HarnessAdapter interface requires an install() step; for this adapter installing is exactly connecting the MCP entry — there is no separate package to install.
   * @returns The ConnectResult from connect().
   * @throws Same as connect — a raw write error would propagate.
   * Maps to: MCP config mcpServers.agentix entry (installed by writing the entry).
   * Side effects: same as connect() — writes the MCP config file.
   */
  async install(): Promise<ConnectResult> {
    return this.connect();
  }

  /**
   * Merges the AgentIX MCP entry into a harness config file, preserving other servers.
   * Why: the single writer behind connect() — it must never clobber another MCP server's entry, and it must resolve the launch command for this install context.
   * @param configPath Config file to write; missing parent dirs are created, and a missing or malformed existing file starts from an empty config.
   * @param agentixPath Package root used to resolve the launch command.
   * @returns ConnectResult with success:true, toolsInstalled/toolsTotal = the AGENTIX_TOOLS count.
   * @throws Throws on write failure (e.g. read-only file) — callers must handle it.
   * Maps to: internal — BaseHarnessAdapter.connect (the only caller).
   * Side effects: writes the config file (JSON, 2-space indent), setting mcpServers["agentix"] to the resolved launch command.
   */
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

  /**
   * Walks up from the current working directory to find the agentix package root.
   * Why: connect/healthCheck/repair all need the package root to locate the MCP server, and the process may have been started from any subdirectory.
   * @returns The nearest ancestor (or cwd itself) whose package.json names `agentix`, `agentix-v1` or `@agentix/core`; cwd when no such ancestor exists.
   * @throws Nothing — unreadable package.json files are skipped, not fatal.
   * Maps to: internal — BaseHarnessAdapter.connect / healthCheck / repair (the package root they resolve the server from).
   * Side effects: reads package.json files while walking up; no writes.
   */
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

  /**
   * Returns the default MCP config filename for this harness.
   * Why: connect() needs a filename when no config file exists yet — the base default covers harnesses that do not override it.
   * @returns "mcp_config.json".
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (the filename used for a fresh config).
   */
  protected getMCPConfigFilename(): string {
    return "mcp_config.json";
  }
}
