import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class HermesAdapter extends BaseHarnessAdapter {
  readonly id = "hermes";
  readonly name = "Hermes";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    return join(homedir(), ".hermes");
  }

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

  protected getVersionCommand(): string | null { return "hermes --version 2>/dev/null || echo ''"; }
  protected getMCPKey(): string { return "agentix"; }
}
