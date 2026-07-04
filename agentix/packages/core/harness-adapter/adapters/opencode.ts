import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class OpenCodeAdapter extends BaseHarnessAdapter {
  readonly id = "opencode";
  readonly name = "OpenCode";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    return join(homedir(), ".opencode");
  }

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

  protected getVersionCommand(): string | null { return "opencode --version 2>/dev/null || echo ''"; }
  protected getMCPKey(): string { return "agentix"; }
}
