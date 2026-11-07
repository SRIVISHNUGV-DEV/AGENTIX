import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class GeminiAdapter extends BaseHarnessAdapter {
  readonly id = "gemini";
  readonly name = "Gemini";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  /**
   * Creates the Gemini adapter, resolving its config paths up front.
   * Why: BaseHarnessAdapter.detect/connect read configPath/mcpConfigPath as fields, so they must be set at construction — "" when Gemini is not installed.
   * @returns A GeminiAdapter bound to this machine's Gemini install (or to "" paths when absent).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the paths they read).
   */
  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  /**
   * Returns Gemini's config directory.
   * Why: connect() writes a fresh MCP config here when no config file exists yet.
   * @returns `~/.gemini`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected getConfigDir(): string {
    return join(homedir(), ".gemini");
  }

  /**
   * Returns the first existing Gemini config location, or null.
   * Why: detect() treats existence as the "installed?" signal; Gemini has shipped under several home-dir names, so all four are probed in order.
   * @returns The first existing path among `~/.gemini`, `~/.config/gemini`, `~/.google/gemini`, `~/.config/google-gemini`, or null when none exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected findConfigPath(): string | null {
    const paths = [
      join(homedir(), ".gemini"),
      join(homedir(), ".config", "gemini"),
      join(homedir(), ".google", "gemini"),
      join(homedir(), ".config", "google-gemini"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the first existing Gemini MCP config file, or null.
   * Why: detect/connect need the exact file holding the `agentix` MCP entry.
   * @returns The first existing path among the mcp.json / mcp_config.json files under the known Gemini dirs, or null when none exists.
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the file it lives in).
   */
  protected findMCPConfigPath(): string | null {
    const paths = [
      join(homedir(), ".gemini", "mcp.json"),
      join(homedir(), ".gemini", "mcp_config.json"),
      join(homedir(), ".config", "gemini", "mcp.json"),
      join(homedir(), ".google", "gemini", "mcp.json"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the command that prints the Gemini version.
   * Why: detectVersion runs it best-effort; stderr is suppressed and a missing binary yields "" so detection never fails on version alone.
   * @returns `gemini --version 2>/dev/null || echo ''`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detectVersion (the command it runs).
   */
  protected getVersionCommand(): string | null {
    return "gemini --version 2>/dev/null || echo ''";
  }

  /**
   * Returns the binary name used to check whether Gemini is on PATH.
   * Why: detect() requires the binary as well as the config dir, so a stale config alone does not count as installed.
   * @returns "gemini".
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.checkBinaryExists (the name it looks up).
   */
  protected getBinaryName(): string | null { return "gemini"; }
  /**
   * Returns the key under which the AgentIX entry lives in Gemini's MCP config.
   * Why: detect/disconnect must know which entry is ours to read or remove it without touching other servers.
   * @returns "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected getMCPKey(): string { return "agentix"; }
}
