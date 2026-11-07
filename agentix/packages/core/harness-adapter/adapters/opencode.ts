import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class OpenCodeAdapter extends BaseHarnessAdapter {
  readonly id = "opencode";
  readonly name = "OpenCode";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  /**
   * Creates the OpenCode adapter, resolving its config paths up front.
   * Why: BaseHarnessAdapter.detect/connect read configPath/mcpConfigPath as fields, so they must be set at construction — "" when OpenCode is not installed.
   * @returns An OpenCodeAdapter bound to this machine's OpenCode install (or to "" paths when absent).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the paths they read).
   */
  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  /**
   * Returns OpenCode's config directory.
   * Why: connect() writes a fresh MCP config here when no config file exists yet.
   * @returns `~/.opencode`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected getConfigDir(): string {
    return join(homedir(), ".opencode");
  }

  /**
   * Returns the first existing OpenCode config location, or null.
   * Why: detect() treats existence as the "installed?" signal; both known locations are probed in order.
   * @returns `~/.opencode` or `~/.config/opencode`, or null when neither exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected findConfigPath(): string | null {
    const paths = [
      join(homedir(), ".opencode"),
      join(homedir(), ".config", "opencode"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the first existing OpenCode MCP config file, or null.
   * Why: detect/connect need the exact file holding the `agentix` MCP entry — OpenCode also reads a project-local `opencode.json` as fallback.
   * @returns `~/.opencode/mcp.json`, `~/.opencode/mcp_config.json`, or `<cwd>/opencode.json`, or null when none exists.
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the file it lives in).
   * Side effects: reads process.cwd() — the fallback is project-local, so the result depends on where the process was started.
   */
  protected findMCPConfigPath(): string | null {
    const paths = [
      join(homedir(), ".opencode", "mcp.json"),
      join(homedir(), ".opencode", "mcp_config.json"),
      join(process.cwd(), "opencode.json"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the command that prints the OpenCode version.
   * Why: detectVersion runs it best-effort; stderr is suppressed and a missing binary yields "" so detection never fails on version alone.
   * @returns `opencode --version 2>/dev/null || echo ''`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detectVersion (the command it runs).
   */
  protected getVersionCommand(): string | null { return "opencode --version 2>/dev/null || echo ''"; }
  /**
   * Returns the binary name used to check whether OpenCode is on PATH.
   * Why: detect() requires the binary as well as the config dir, so a stale config alone does not count as installed.
   * @returns "opencode".
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.checkBinaryExists (the name it looks up).
   */
  protected getBinaryName(): string | null { return "opencode"; }
  /**
   * Returns the key under which the AgentIX entry lives in OpenCode's MCP config.
   * Why: detect/disconnect must know which entry is ours to read or remove it without touching other servers.
   * @returns "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected getMCPKey(): string { return "agentix"; }
}
