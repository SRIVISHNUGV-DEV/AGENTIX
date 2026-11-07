import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class HermesAdapter extends BaseHarnessAdapter {
  readonly id = "hermes";
  readonly name = "Hermes";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  /**
   * Creates the Hermes adapter, resolving its config paths up front.
   * Why: BaseHarnessAdapter.detect/connect read configPath/mcpConfigPath as fields, so they must be set at construction — "" when Hermes is not installed.
   * @returns A HermesAdapter bound to this machine's Hermes install (or to "" paths when absent).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the paths they read).
   */
  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  /**
   * Returns Hermes's config directory.
   * Why: connect() writes a fresh MCP config here when no config file exists yet.
   * @returns `~/.hermes`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected getConfigDir(): string {
    return join(homedir(), ".hermes");
  }

  /**
   * Returns the first existing Hermes config location, or null.
   * Why: detect() treats existence as the "installed?" signal; both known locations are probed in order.
   * @returns `~/.hermes` or `~/.config/hermes`, or null when neither exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected findConfigPath(): string | null {
    const paths = [
      join(homedir(), ".hermes"),
      join(homedir(), ".config", "hermes"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the first existing Hermes MCP config file, or null.
   * Why: detect/connect need the exact file holding the `agentix` MCP entry.
   * @returns `~/.hermes/mcp.json` or `~/.hermes/mcp_config.json`, or null when neither exists.
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the file it lives in).
   */
  protected findMCPConfigPath(): string | null {
    const paths = [
      join(homedir(), ".hermes", "mcp.json"),
      join(homedir(), ".hermes", "mcp_config.json"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the command that prints the Hermes version.
   * Why: detectVersion runs it best-effort; stderr is suppressed and a missing binary yields "" so detection never fails on version alone.
   * @returns `hermes --version 2>/dev/null || echo ''`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detectVersion (the command it runs).
   */
  protected getVersionCommand(): string | null { return "hermes --version 2>/dev/null || echo ''"; }
  /**
   * Returns the binary name used to check whether Hermes is on PATH.
   * Why: detect() requires the binary as well as the config dir, so a stale config alone does not count as installed.
   * @returns "hermes".
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.checkBinaryExists (the name it looks up).
   */
  protected getBinaryName(): string | null { return "hermes"; }
  /**
   * Returns the key under which the AgentIX entry lives in Hermes's MCP config.
   * Why: detect/disconnect must know which entry is ours to read or remove it without touching other servers.
   * @returns "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected getMCPKey(): string { return "agentix"; }
}
