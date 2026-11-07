import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class OpenClaudeAdapter extends BaseHarnessAdapter {
  readonly id = "openclaude";
  readonly name = "OpenClaude";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  /**
   * Creates the OpenClaude adapter, resolving its config paths up front.
   * Why: BaseHarnessAdapter.detect/connect read configPath/mcpConfigPath as fields, so they must be set at construction — "" when OpenClaude is not installed.
   * @returns An OpenClaudeAdapter bound to this machine's OpenClaude install (or to "" paths when absent).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the paths they read).
   */
  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  /**
   * Returns OpenClaude's config directory.
   * Why: connect() writes a fresh MCP config here when no config file exists yet.
   * @returns `~/.openclaude`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected getConfigDir(): string {
    return join(homedir(), ".openclaude");
  }

  /**
   * Returns the first existing OpenClaude config location, or null.
   * Why: detect() treats existence as the "installed?" signal; both known locations are probed in order.
   * @returns `~/.openclaude` or `~/.config/openclaude`, or null when neither exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected findConfigPath(): string | null {
    const paths = [
      join(homedir(), ".openclaude"),
      join(homedir(), ".config", "openclaude"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the first existing OpenClaude MCP config file, or null.
   * Why: detect/connect need the exact file holding the `agentix` MCP entry.
   * @returns `~/.openclaude/mcp.json`, `~/.openclaude/mcp_config.json`, or `~/.config/openclaude/mcp.json`, or null when none exists.
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the file it lives in).
   */
  protected findMCPConfigPath(): string | null {
    const paths = [
      join(homedir(), ".openclaude", "mcp.json"),
      join(homedir(), ".openclaude", "mcp_config.json"),
      join(homedir(), ".config", "openclaude", "mcp.json"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the command that prints the OpenClaude version.
   * Why: detectVersion runs it best-effort; stderr is suppressed and a missing binary yields "" so detection never fails on version alone.
   * @returns `openclaude --version 2>/dev/null || echo ''`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detectVersion (the command it runs).
   */
  protected getVersionCommand(): string | null {
    return "openclaude --version 2>/dev/null || echo ''";
  }

  /**
   * Returns the binary name used to check whether OpenClaude is on PATH.
   * Why: detect() requires the binary as well as the config dir, so a stale config alone does not count as installed.
   * @returns "openclaude".
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.checkBinaryExists (the name it looks up).
   */
  protected getBinaryName(): string | null { return "openclaude"; }
  /**
   * Returns the key under which the AgentIX entry lives in OpenClaude's MCP config.
   * Why: detect/disconnect must know which entry is ours to read or remove it without touching other servers.
   * @returns "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected getMCPKey(): string { return "agentix"; }
}
