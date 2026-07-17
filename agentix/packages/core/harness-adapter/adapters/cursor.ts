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

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    const p = platform();
    if (p === "win32") return join(homedir(), "AppData", "Local", "Cursor", "User");
    if (p === "darwin") return join(homedir(), "Library", "Application Support", "Cursor", "User");
    return join(homedir(), ".config", "Cursor", "User");
  }

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
    } else {
      paths.push(join(homedir(), ".cursor", "mcp.json"));
    }
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  protected getVersionCommand(): string | null {
    const p = platform();
    if (p === "win32") return 'cursor --version 2>nul || echo ""';
    return "cursor --version 2>/dev/null || echo ''";
  }

  protected getBinaryName(): string | null { return "cursor"; }
  protected getMCPKey(): string { return "agentix"; }
}
