import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class ClaudeCodeAdapter extends BaseHarnessAdapter {
  readonly id = "claude-code";
  readonly name = "Claude Code";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    return join(homedir(), ".claude");
  }

  protected findConfigPath(): string | null {
    const paths = [
      join(homedir(), ".claude"),
      join(homedir(), ".config", "claude"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  protected findMCPConfigPath(): string | null {
    const paths = [
      join(homedir(), ".claude", "mcp.json"),
      join(homedir(), ".claude", "mcp_config.json"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  protected getVersionCommand(): string | null { return "claude --version 2>/dev/null || echo ''"; }
  protected getMCPKey(): string { return "agentix"; }
}
