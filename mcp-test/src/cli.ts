import { execSync } from "child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { PACKAGE_NAME, CLI_NAME } from "./config.js"

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
}

function log(msg: string, color = C.reset) {
  console.log(`${color}${msg}${C.reset}`)
}

const SERVER_COMMAND = "npx"
const SERVER_ARGS = ["-y", PACKAGE_NAME]

interface Platform {
  name: string
  id: string
  configPath: string | null
  detected: boolean
  installed: boolean
  method: "cli" | "json" | "project"
}

function getClaudeCodeConfigPath(): string | null {
  const home = homedir()
  const p = join(home, ".claude.json")
  return existsSync(p) ? p : join(home, ".claude", "config.json")
}

function getOpenClaudeConfigPath(): string | null {
  const p = join(homedir(), ".openclaude", "config.json")
  return existsSync(p) ? p : null
}

function getCursorConfigPath(): string | null {
  const p = join(homedir(), ".cursor", "mcp.json")
  return existsSync(p) ? p : null
}

function getClineConfigPath(): string | null {
  const p = join(homedir(), ".cline", "mcp.json")
  return existsSync(p) ? p : null
}

function getWindsurfConfigPath(): string | null {
  const p = join(homedir(), ".codeium", "windsurf", "mcp_config.json")
  return existsSync(p) ? p : null
}

function getVSCodeConfigPath(): string | null {
  const home = homedir()
  const candidates = [
    join(home, ".vscode", "mcp.json"),
    join(home, "AppData", "Roaming", "Code", "User", "globalStorage", "mcp.json"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function getJetBrainsConfigPath(): string | null {
  const home = homedir()
  const candidates = [
    join(home, "AppData", "Roaming", "JetBrains"),
    join(home, ".config", "JetBrains"),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

function detectPlatforms(): Platform[] {
  let claudeCodeAvailable = false
  try {
    execSync("claude --version", { stdio: "ignore", timeout: 3000 })
    claudeCodeAvailable = true
  } catch {}

  const platforms: Platform[] = [
    {
      name: "Claude Code",
      id: "claude-code",
      configPath: getClaudeCodeConfigPath(),
      detected: claudeCodeAvailable,
      installed: false,
      method: "cli",
    },
    {
      name: "OpenClaude",
      id: "openclaude",
      configPath: getOpenClaudeConfigPath(),
      detected: getOpenClaudeConfigPath() !== null,
      installed: false,
      method: "json",
    },
    {
      name: "Cursor",
      id: "cursor",
      configPath: getCursorConfigPath(),
      detected: getCursorConfigPath() !== null,
      installed: false,
      method: "json",
    },
    {
      name: "Cline",
      id: "cline",
      configPath: getClineConfigPath(),
      detected: getClineConfigPath() !== null,
      installed: false,
      method: "json",
    },
    {
      name: "Windsurf/Codeium",
      id: "windsurf",
      configPath: getWindsurfConfigPath(),
      detected: getWindsurfConfigPath() !== null,
      installed: false,
      method: "json",
    },
    {
      name: "VS Code",
      id: "vscode",
      configPath: getVSCodeConfigPath(),
      detected: getVSCodeConfigPath() !== null,
      installed: false,
      method: "json",
    },
    {
      name: "JetBrains",
      id: "jetbrains",
      configPath: getJetBrainsConfigPath(),
      detected: getJetBrainsConfigPath() !== null,
      installed: false,
      method: "json",
    },
    {
      name: "Project .mcp.json",
      id: "project",
      configPath: join(process.cwd(), ".mcp.json"),
      detected: true,
      installed: existsSync(join(process.cwd(), ".mcp.json")),
      method: "project",
    },
  ]

  return platforms
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
  const dir = join(path, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
}

function isInstalled(config: any, name = "agentix"): boolean {
  return !!config.mcpServers?.[name]
}

function addToPlatform(configPath: string, serverName = "agentix"): boolean {
  const config = readJson(configPath)
  config.mcpServers = config.mcpServers || {}
  if (!isInstalled(config, serverName)) {
    config.mcpServers[serverName] = {
      command: SERVER_COMMAND,
      args: SERVER_ARGS,
    }
  }
  writeJson(configPath, config)
  return true
}

function removeFromPlatform(configPath: string, serverName = "agentix"): boolean {
  if (!existsSync(configPath)) return false
  const config = readJson(configPath)
  if (config.mcpServers?.[serverName]) {
    delete config.mcpServers[serverName]
    writeJson(configPath, config)
    return true
  }
  return false
}

function addToClaudeCode(): boolean {
  try {
    execSync(
      `claude mcp add --transport stdio --scope user agentix -- ${SERVER_ARGS.join(" ")}`,
      { stdio: "ignore", timeout: 10000 }
    )
    return true
  } catch {
    const configPath = getClaudeCodeConfigPath()
    if (!configPath) return false
    return addToPlatform(configPath)
  }
}

function removeFromClaudeCode(): boolean {
  try {
    execSync("claude mcp remove agentix", { stdio: "ignore", timeout: 10000 })
    return true
  } catch {
    const configPath = getClaudeCodeConfigPath()
    if (!configPath || !existsSync(configPath)) return false
    return removeFromPlatform(configPath)
  }
}

function addToProject(): boolean {
  return addToPlatform(join(process.cwd(), ".mcp.json"))
}

function removeFromProject(): boolean {
  return removeFromPlatform(join(process.cwd(), ".mcp.json"))
}

export function addCommand(targetPlatform?: string): void {
  log(`\n  ${C.bold}Agentix MCP Installer${C.reset}\n`, C.cyan)

  const platforms = detectPlatforms()
  log(`  Server config: ${C.cyan}${SERVER_COMMAND}${C.reset} [${SERVER_ARGS.join(", ")}]\n`)

  let count = 0
  for (const p of platforms) {
    if (targetPlatform && p.id !== targetPlatform) continue
    if (!p.detected) {
      log(`  ${C.dim}[skip]${C.reset} ${p.name} — not detected`, C.dim)
      continue
    }

    if (p.method === "json" && p.configPath && isInstalled(readJson(p.configPath))) {
      log(`  ${C.yellow}[exists]${C.reset} ${p.name} — already configured`, C.yellow)
      count++
      continue
    }

    let ok = false
    switch (p.id) {
      case "claude-code":
        ok = addToClaudeCode(); break
      case "project":
        ok = addToProject(); break
      default:
        if (p.configPath) ok = addToPlatform(p.configPath); break
    }

    if (ok) {
      log(`  ${C.green}[added]${C.reset} ${p.name}`, C.green)
      count++
    } else {
      log(`  ${C.red}[fail]${C.reset} ${p.name}`, C.red)
    }
  }

  log(count > 0
    ? `\n  ${C.green}Installed on ${count} platform(s)${C.reset}\n`
    : `\n  ${C.yellow}No platforms detected. Run: ${C.cyan}${CLI_NAME} add project${C.reset}\n`)
}

export function removeCommand(): void {
  log(`\n  Removing Agentix MCP...\n`, C.yellow)
  const platforms = detectPlatforms()
  let count = 0

  for (const p of platforms) {
    if (!p.detected) continue
    let ok = false
    switch (p.id) {
      case "claude-code":
        ok = removeFromClaudeCode(); break
      case "project":
        ok = removeFromProject(); break
      default:
        if (p.configPath) ok = removeFromPlatform(p.configPath); break
    }
    if (ok) {
      log(`  ${C.green}[removed]${C.reset} ${p.name}`, C.green)
      count++
    }
  }

  log(count > 0
    ? `\n  ${C.green}Removed from ${count} platform(s)${C.reset}\n`
    : `  ${C.dim}Nothing to remove.${C.reset}\n`)
}

export function statusCommand(): void {
  log(`\n  ${C.bold}Agentix MCP Status${C.reset}\n`, C.cyan)
  const platforms = detectPlatforms()

  for (const p of platforms) {
    if (!p.detected) {
      log(`  ${C.dim}[--]${C.reset} ${p.name}`, C.dim)
      continue
    }
    let installed = false
    if (p.configPath && existsSync(p.configPath)) {
      installed = isInstalled(readJson(p.configPath))
    }
    const s = installed ? `${C.green}[installed]` : `${C.dim}[not installed]`
    log(`  ${s}${C.reset} ${p.name}`)
  }
  log("")
}

export function helpCommand(): void {
  log(`
  ${C.bold}${CLI_NAME} — Standalone MCP Server for Agentix${C.reset}

  ${C.cyan}Usage:${C.reset}
    ${CLI_NAME} add [platform]    Add to one or all MCP-compatible clients
    ${CLI_NAME} remove            Remove from all clients
    ${CLI_NAME} status            Check installation status
    ${CLI_NAME} start             Start the MCP server
    ${CLI_NAME}                   Start in stdio mode (default)

  ${C.cyan}Platforms:${C.reset}
    claude-code    Claude Code (via CLI or ~/.claude.json)
    openclaude     OpenClaude (~/.openclaude/config.json)
    cursor         Cursor IDE (~/.cursor/mcp.json)
    cline          Cline (~/.cline/mcp.json)
    windsurf       Windsurf/Codeium (~/.codeium/windsurf/mcp_config.json)
    vscode         VS Code (global mcp.json)
    jetbrains      JetBrains IDEs
    project        .mcp.json in current directory

  ${C.cyan}Examples:${C.reset}
    ${CLI_NAME} add                    # Auto-detect & install everywhere
    ${CLI_NAME} add claude-code         # Claude Code only
    ${CLI_NAME} add project             # Local .mcp.json only
    ${CLI_NAME} status                  # See what's installed where

  ${C.cyan}Run with --http for remote transport:${C.reset}
    ${CLI_NAME} --http                  # HTTP mode, port 3100
    ${CLI_NAME} --http --port 8080      # Custom HTTP port

`)
}
