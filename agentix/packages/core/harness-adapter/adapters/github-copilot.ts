import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class GitHubCopilotAdapter extends BaseHarnessAdapter {
  readonly id = "github-copilot";
  readonly name = "GitHub Copilot";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  /**
   * Creates the GitHub Copilot adapter, resolving its config paths up front.
   * Why: BaseHarnessAdapter.detect/connect read configPath/mcpConfigPath as fields, so they must be set at construction — "" when Copilot is not installed.
   * @returns A GitHubCopilotAdapter bound to this machine's Copilot install (or to "" paths when absent).
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect / connect (the paths they read).
   */
  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  /**
   * Returns GitHub Copilot's config directory for this OS.
   * Why: connect() writes a fresh MCP config here when no config file exists yet, and the location is OS-specific.
   * @returns `%APPDATA%\GitHub\Copilot` on win32, `~/Library/Application Support/GitHub/Copilot` on darwin, `~/.config/github-copilot` elsewhere.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.connect (where a missing MCP config is created).
   */
  protected getConfigDir(): string {
    const os = process.platform;
    if (os === "win32") return join(homedir(), "AppData", "Roaming", "GitHub", "Copilot");
    if (os === "darwin") return join(homedir(), "Library", "Application Support", "GitHub", "Copilot");
    return join(homedir(), ".config", "github-copilot");
  }

  /**
   * Returns the first existing Copilot config location, or null.
   * Why: detect() treats existence as the "installed?" signal — Copilot's config lives in its own dir or inside VS Code's globalStorage, so both are probed.
   * @returns getConfigDir() when it exists, else the OS-specific `GitHub.copilot` globalStorage dir, or null when neither exists.
   * @throws Nothing.
   * Maps to: internal — BaseHarnessAdapter.detect (configExists / the `found` decision).
   */
  protected findConfigPath(): string | null {
    const dirs = [this.getConfigDir()];
    const os = process.platform;
    if (os === "win32") {
      dirs.push(join(homedir(), "AppData", "Roaming", "Code", "User", "globalStorage", "GitHub.copilot"));
    } else if (os === "darwin") {
      dirs.push(join(homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "GitHub.copilot"));
    } else {
      dirs.push(join(homedir(), ".config", "Code", "User", "globalStorage", "GitHub.copilot"));
    }
    for (const p of dirs) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the first existing Copilot MCP config file, or null.
   * Why: detect/connect need the exact file holding the `agentix` MCP entry — Copilot reads it from VS Code's globalStorage, with a project-local `.vscode/mcp.json` as fallback.
   * @returns The first existing OS-specific `GitHub.copilot/mcp.json`, else `<cwd>/.vscode/mcp.json`, or null when neither exists.
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the file it lives in).
   * Side effects: reads process.cwd() — the fallback is project-local, so the result depends on where the process was started.
   */
  protected findMCPConfigPath(): string | null {
    const os = process.platform;
    const paths: string[] = [];
    if (os === "win32") {
      paths.push(join(homedir(), "AppData", "Roaming", "Code", "User", "globalStorage", "GitHub.copilot", "mcp.json"));
    } else if (os === "darwin") {
      paths.push(join(homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "GitHub.copilot", "mcp.json"));
    } else {
      paths.push(join(homedir(), ".config", "Code", "User", "globalStorage", "GitHub.copilot", "mcp.json"));
    }
    paths.push(join(process.cwd(), ".vscode", "mcp.json"));
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the key under which the AgentIX entry lives in Copilot's MCP config.
   * Why: detect/disconnect must know which entry is ours to read or remove it without touching other servers.
   * @returns "agentix".
   * @throws Nothing.
   * Maps to: MCP config mcpServers.agentix entry (the key this adapter reads and writes).
   */
  protected getMCPKey(): string {
    return "agentix";
  }
}
