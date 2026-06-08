import { existsSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const SERVER_COMMAND = "npx"
const SERVER_ARGS = ["-y", "agentix-mcp-test"]

function log(msg: string) {
  console.error(`[agentix-mcp-test:postinstall] ${msg}`)
}

function readJson(path: string): any {
  if (!existsSync(path)) return { mcpServers: {} }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return { mcpServers: {} }
  }
}

function writeJson(path: string, data: any): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
}

const CONFIG_PATHS: Record<string, string> = {
  "Claude Desktop (Windows)": join(homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  "Claude Desktop (macOS)": join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  "Claude Desktop (Linux)": join(homedir(), ".config", "Claude", "claude_desktop_config.json"),
}

log("Checking for Claude Desktop config...")

let installed = false
for (const [label, configPath] of Object.entries(CONFIG_PATHS)) {
  if (!existsSync(configPath)) continue
  const config = readJson(configPath)
  if (config.mcpServers?.agentix) {
    log(`${label}: already configured`)
    installed = true
    continue
  }
  config.mcpServers = config.mcpServers || {}
  config.mcpServers.agentix = {
    command: SERVER_COMMAND,
    args: SERVER_ARGS,
  }
  writeJson(configPath, config)
  log(`${label}: configured ✓`)
  installed = true
}

if (!installed) {
  log("No Claude Desktop config found. Run `amt add` to configure manually.")
} else {
  log("Done.")
}
