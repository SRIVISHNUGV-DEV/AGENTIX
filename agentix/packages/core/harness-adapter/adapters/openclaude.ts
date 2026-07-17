import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class OpenClaudeAdapter extends BaseHarnessAdapter {
  readonly id = "openclaude";
  readonly name = "OpenClaude";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    return join(homedir(), ".openclaude");
  }

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

  protected getVersionCommand(): string | null {
    return "openclaude --version 2>/dev/null || echo ''";
  }

  protected getBinaryName(): string | null { return "openclaude"; }
  protected getMCPKey(): string { return "agentix"; }
}
