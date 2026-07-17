import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class MimoCodeAdapter extends BaseHarnessAdapter {
  readonly id = "mimocode";
  readonly name = "MimoCode";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    return join(homedir(), ".mimocode");
  }

  protected findConfigPath(): string | null {
    const paths = [
      join(homedir(), ".mimocode"),
      join(homedir(), ".config", "mimocode"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  protected findMCPConfigPath(): string | null {
    const paths = [
      join(homedir(), ".mimocode", "mcp.json"),
      join(homedir(), ".mimocode", "mcp_config.json"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  protected getVersionCommand(): string | null { return "mimo --version 2>/dev/null || echo ''"; }
  protected getBinaryName(): string | null { return "mimo"; }
  protected getMCPKey(): string { return "agentix"; }
}
