import { BaseHarnessAdapter } from "../base";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export class GitHubCopilotAdapter extends BaseHarnessAdapter {
  readonly id = "github-copilot";
  readonly name = "GitHub Copilot";
  readonly configPath: string;
  readonly mcpConfigPath: string;

  constructor() {
    super();
    this.configPath = this.findConfigPath() || "";
    this.mcpConfigPath = this.findMCPConfigPath() || "";
  }

  protected getConfigDir(): string {
    const os = process.platform;
    if (os === "win32") return join(homedir(), "AppData", "Roaming", "GitHub", "Copilot");
    if (os === "darwin") return join(homedir(), "Library", "Application Support", "GitHub", "Copilot");
    return join(homedir(), ".config", "github-copilot");
  }

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

  protected getMCPKey(): string {
    return "agentix";
  }
}
