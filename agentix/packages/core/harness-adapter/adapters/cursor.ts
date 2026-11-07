import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { platform } from "os";

export class CursorAdapter extends BaseHarnessAdapter {
  readonly id = "cursor";
  readonly name = "Cursor";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  /**
   * Creates the Cursor adapter, resolving its config paths up front.
   * Why: BaseHarnessAdapter.detect/connect read configPath/mcpConfigPath as fields, so they must be set at construction — "" when Cursor is not installed.
   * @returns A CursorAdapter bound to this machine's Cursor install (or to "" paths when absent).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the paths they read).
   */
  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  /**
   * Returns Cursor's per-user config directory for this OS.
   * Why: connect() writes a fresh MCP config here when no config file exists yet, and the location is OS-specific (Windows/macOS/Linux differ).
   * @returns `%USERPROFILE%\AppData\Local\Cursor\User` on win32, `~/Library/Application Support/Cursor/User` on darwin, `~/.config/Cursor/User` elsewhere.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected getConfigDir(): string {
    const p = platform();
    if (p === "win32") return join(homedir(), "AppData", "Local", "Cursor", "User");
    if (p === "darwin") return join(homedir(), "Library", "Application Support", "Cursor", "User");
    return join(homedir(), ".config", "Cursor", "User");
  }

  /**
   * Returns the first existing Cursor config location, or null.
   * Why: detect() treats existence as the "installed?" signal; the generic locations are probed first, then the OS-specific ones.
   * @returns The first existing path among `~/.cursor`, `~/.config/cursor`, plus the OS-specific Cursor dirs, or null when none exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected findConfigPath(): string | null {
    const p = platform();
    const paths: string[] = [
      join(homedir(), ".cursor"),
      join(homedir(), ".config", "cursor"),
    ];
    if (p === "win32") {
      paths.push(join(homedir(), "AppData", "Local", "Cursor"));
      paths.push(join(homedir(), "AppData", "Roaming", "Cursor"));
    } else if (p === "darwin") {
      paths.push(join(homedir(), "Library", "Application Support", "Cursor"));
    } else {
      paths.push(join(homedir(), ".cursor", "config"));
    }
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the first existing Cursor MCP config file, or null.
   * Why: detect/connect need the exact file holding the `agentix` MCP entry; Cursor keeps it in different places per OS.
   * @returns The first existing path among `~/.cursor/mcp.json`, `~/.cursor/mcp_config.json`, plus the OS-specific mcp.json locations, or null when none exists.
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the file it lives in).
   */
  protected findMCPConfigPath(): string | null {
    const p = platform();
    const paths: string[] = [
      join(homedir(), ".cursor", "mcp.json"),
      join(homedir(), ".cursor", "mcp_config.json"),
    ];
    if (p === "win32") {
      paths.push(join(homedir(), "AppData", "Roaming", "Cursor", "mcp.json"));
      paths.push(join(homedir(), "AppData", "Local", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json"));
    } else if (p === "darwin") {
      paths.push(join(homedir(), "Library", "Application Support", "Cursor", "mcp.json"));
    }
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the command that prints the Cursor version for this OS.
   * Why: detectVersion runs it best-effort; stderr suppression differs per shell, so Windows uses `2>nul` and the rest `2>/dev/null`, and a missing binary yields "".
   * @returns `cursor --version` with the OS-appropriate stderr redirect, falling back to `echo ""`.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detectVersion (the command it runs).
   */
  protected getVersionCommand(): string | null {
    const p = platform();
    if (p === "win32") return 'cursor --version 2>nul || echo ""';
    return "cursor --version 2>/dev/null || echo ''";
  }

  /**
   * Returns the binary name used to check whether Cursor is on PATH.
   * Why: detect() requires the binary as well as the config dir, so a stale config alone does not count as installed.
   * @returns "cursor".
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.checkBinaryExists (the name it looks up).
   */
  protected getBinaryName(): string | null { return "cursor"; }
  /**
   * Returns the key under which the AgentIX entry lives in Cursor's MCP config.
   * Why: detect/disconnect must know which entry is ours to read or remove it without touching other servers.
   * @returns "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected getMCPKey(): string { return "agentix"; }
}
