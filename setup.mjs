#!/usr/bin/env node

import readline from "node:readline/promises"
import { randomBytes } from "node:crypto"
import { writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

const chalk = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  blue:   (s) => `\x1b[34m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  gray:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
}

function success(msg) { console.log(chalk.green("✓"), msg) }
function error(msg)   { console.error(chalk.red("✗"), msg) }
function info(msg)    { console.log(chalk.blue("ℹ"), msg) }
function warn(msg)    { console.log(chalk.yellow("⚠"), msg) }
function label(k, v)  { console.log(`  ${chalk.bold(k)}:  ${v}`) }

const genHex = (bytes) => randomBytes(bytes).toString("hex")
const relPath = (abs) => abs.startsWith(__dirname) ? "." + abs.slice(__dirname.length).replace(/\\/g, "/") : abs

async function prompt(label, opts = {}) {
  const d = opts.default ?? ""
  const hint = d ? ` [${chalk.dim(d)}]` : ""
  const result = await rl.question(`  ${chalk.cyan("?")} ${label}${hint}: `)
  return result.trim() || d
}

async function confirm(label, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N"
  const result = await rl.question(`  ${chalk.cyan("?")} ${label} (${hint}): `)
  const r = result.trim().toLowerCase()
  if (!r) return defaultYes
  return r === "y" || r === "yes"
}

async function multiPrompt(label, items) {
  console.log(`\n  ${chalk.cyan("?")} ${label}:`)
  const keys = {}
  for (const item of items) {
    const key = await prompt(`  ${chalk.dim("API key for")} ${chalk.bold(item)}${chalk.dim(" (blank to skip)")}`)
    if (key) keys[item] = key
  }
  return keys
}

async function main() {
  console.log()
  console.log()
  console.log(chalk.bold("  AGENTIX Setup Wizard"))
  console.log(chalk.gray("  Platform for issuing private agent credentials, verifying authorization with ZK proofs, and creating on-chain sessions/wallets for autonomous agents."))
  console.log()
  await rl.question(`  ${chalk.dim("Press Enter to begin...")}`)
  console.log()

  // ── 1. Blockchain ─────────────────────────────────────────────
  console.log(chalk.bold("  Step 1: Blockchain Configuration"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))

  const rpcUrl = await prompt("Alchemy/Infura Base Sepolia RPC URL", { default: "https://base-sepolia.g.alchemy.com/v2/" })
  const privateKey = await prompt("Backend wallet private key (0x...)")
  const bundlerUrl = await prompt("Bundler URL (same as RPC if using Alchemy)", { default: rpcUrl })
  const chainId = await prompt("Chain ID", { default: "84532" })
  const networkName = await prompt("Network name", { default: "sepolia" })
  console.log()

  // ── 2. AI Providers ─────────────────────────────────────────
  console.log(chalk.bold("  Step 2: AI Provider API Keys"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))
  console.log(chalk.gray("  Configure which AI providers your agents will use."))
  console.log(chalk.gray("  Skip any you don't need — add them later via the UI."))
  console.log()

  const providerKeys = await multiPrompt("Enter API keys for each provider", [
    "openai", "anthropic", "gemini", "together",
    "openrouter", "mistral", "cohere", "groq",
  ])
  console.log()

  // ── 3. Docker Services ──────────────────────────────────────
  console.log(chalk.bold("  Step 3: Infrastructure"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))

  const useDocker = await confirm("Use Docker for Postgres & Redis?", true)
  let dbUrl = "postgresql://agentix:agentix-secret@localhost:5432/agentix"
  let redisUrl = "redis://localhost:6379"

  if (!useDocker) {
    dbUrl = await prompt("PostgreSQL DATABASE_URL", { default: dbUrl })
    redisUrl = await prompt("Redis URL", { default: redisUrl })
  }
  const enableProofQueue = await confirm("Enable async proof queue? (requires Redis)", useDocker)
  console.log()

  // ── 4. Encryption ───────────────────────────────────────────
  console.log(chalk.bold("  Step 4: Encryption Keys"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))
  console.log(chalk.gray("  Auto-generating secure random keys..."))
  const encryptionKey = genHex(32)
  const sessionKey = genHex(32)
  const metricsToken = genHex(32)
  success("Encryption key generated")
  success("Session encryption key generated")
  success("Metrics API token generated")
  console.log()

  // ── 5. Frontend ─────────────────────────────────────────────
  console.log(chalk.bold("  Step 5: Frontend Configuration"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))

  const apiUrl = await prompt("Backend API URL", { default: "http://127.0.0.1:3001" })
  console.log()

  // ── 6. Write .env files ─────────────────────────────────────
  const envs = {
    "backend/.env": [
      "# Agentix Backend Configuration (generated by setup.mjs)",
      `PORT=3001`,
      `NODE_ENV=development`,
      `RPC_URL=${rpcUrl}`,
      `CHAIN_ID=${chainId}`,
      `NETWORK_NAME=${networkName}`,
      `PRIVATE_KEY=${privateKey}`,
      `VERIFIER_ADDRESS=0x6cBbB06df8Ddc8D28992F5149C755aAe0E0EB61f`,
      `CREDENTIAL_REGISTRY_ADDRESS=0x83e0e671c0D31a288B93B9F04B7c4e116a065F5c`,
      `SESSION_MANAGER_ADDRESS=0xcC0a3400397F8A54e54DA2c7A703bC5B27354C58`,
      `AGENT_WALLET_FACTORY_ADDRESS=0x6313d16266FB2e60c8Ef142274e317878ba71677`,
      `AGENT_WALLET_IMPLEMENTATION_ADDRESS=0x31448C7ca90c675F7f0631AF8A6a8627758E1e9A`,
      `ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`,
      `CAPABILITY_REGISTRY_ADDRESS=0xA5624939Fd99ed689Bc564FB2a09B3bc59198297`,
      `DELEGATION_MANAGER_ADDRESS=0xa52e7C76811FAAC1514712eb0137d8f1631202DA`,
      `BUNDLER_URL=${bundlerUrl}`,
      `ENCRYPTION_KEY=${encryptionKey}`,
      `SESSION_ENCRYPTION_KEY=${sessionKey}`,
      `DATABASE_URL=${dbUrl}`,
      `DB_POOL_SIZE=20`,
      `DB_SSL_MODE=disable`,
      `DB_CONNECTION_TIMEOUT_MS=10000`,
      `DB_IDLE_TIMEOUT_MS=30000`,
      `DB_STATEMENT_TIMEOUT_MS=60000`,
      `DB_APPLICATION_NAME=agentix-backend`,
      `REDIS_URL=${redisUrl}`,
      `ENABLE_PROOF_QUEUE=${enableProofQueue}`,
      `ENABLE_EVENT_SYNC=true`,
      `CORS_ORIGIN=http://localhost:3000`,
      `METRICS_API_KEY=${metricsToken}`,
      `ALLOW_PRIVATE_AGENT_ENDPOINTS=true`,
      ...Object.entries(providerKeys).map(([p, k]) => `${p.toUpperCase()}_API_KEY=${k}`),
    ].join("\n"),

    "frontend/.env.local": [
      `AGENT_CREDENTIALS_API_URL=${apiUrl}`,
      `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL=${apiUrl}`,
      `NEXT_PUBLIC_CHAIN_ID=${chainId}`,
      `NEXT_PUBLIC_USE_MOCK=false`,
    ].join("\n"),

    "mcp-test/.env": [
      "# Agentix MCP Test Server (generated by setup.mjs)",
      `CHAIN_ID=${chainId}`,
      `NETWORK_NAME=${networkName}`,
      `RPC_URL=${rpcUrl}`,
      `VERIFIER_ADDRESS=0x6cBbB06df8Ddc8D28992F5149C755aAe0E0EB61f`,
      `CREDENTIAL_REGISTRY_ADDRESS=0x83e0e671c0D31a288B93B9F04B7c4e116a065F5c`,
      `SESSION_MANAGER_ADDRESS=0xcC0a3400397F8A54e54DA2c7A703bC5B27354C58`,
      `CAPABILITY_REGISTRY_ADDRESS=0xA5624939Fd99ed689Bc564FB2a09B3bc59198297`,
      `DELEGATION_MANAGER_ADDRESS=0xa52e7C76811FAAC1514712eb0137d8f1631202DA`,
      `AGENT_WALLET_FACTORY_ADDRESS=0x6313d16266FB2e60c8Ef142274e317878ba71677`,
      `ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`,
      `PORT=3100`,
    ].join("\n"),

    "contracts/.env": [
      `RPC_URL=${rpcUrl}`,
      `PRIVATE_KEY=${privateKey}`,
      `CHAIN_ID=${chainId}`,
      `NETWORK_NAME=${networkName}`,
      `ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`,
      `BUNDLER_URL=${bundlerUrl}`,
    ].join("\n"),

    ".env": [
      "# Agentix Monorepo (generated by setup.mjs)",
      `RPC_URL=${rpcUrl}`,
      `PRIVATE_KEY=${privateKey}`,
      `CHAIN_ID=${chainId}`,
    ].join("\n"),
  }

  const existing = Object.keys(envs).filter((p) => existsSync(join(__dirname, p)))
  if (existing.length > 0) {
    warn("Existing files will be overwritten:")
    for (const f of existing) console.log(`    ${chalk.yellow("→")} ${f}`)
    const ok = await confirm("Continue?", true)
    if (!ok) { error("Aborted."); process.exit(0) }
  }
  console.log()

  console.log(chalk.bold("  Writing environment files..."))
  for (const [relPath, content] of Object.entries(envs)) {
    const absPath = join(__dirname, relPath)
    const parent = dirname(absPath)
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    writeFileSync(absPath, content + "\n", "utf-8")
    success(relPath)
  }
  console.log()

  // ── 7. MCP Client Config ────────────────────────────────────
  console.log(chalk.bold("  Step 7: MCP Client Configuration"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))
  info("Compatible with all MCP clients: Claude Desktop, Claude Code, OpenCode, Cursor, VS Code, Windsurf, JetBrains")
  console.log()

  const mcpHttpCmd = `npx tsx ${join(__dirname, "mcp-test", "src", "index.ts")} --http --port 3100`
  const serverConfig = {
    mcpServers: {
      agentix: {
        command: "npx",
        args: ["tsx", join(__dirname, "mcp-test", "src", "index.ts")],
        env: {
          RPC_URL: rpcUrl, CHAIN_ID: chainId, NETWORK_NAME: networkName,
          VERIFIER_ADDRESS: "0x6cBbB06df8Ddc8D28992F5149C755aAe0E0EB61f",
          CREDENTIAL_REGISTRY_ADDRESS: "0x83e0e671c0D31a288B93B9F04B7c4e116a065F5c",
          SESSION_MANAGER_ADDRESS: "0xcC0a3400397F8A54e54DA2c7A703bC5B27354C58",
          CAPABILITY_REGISTRY_ADDRESS: "0xA5624939Fd99ed689Bc564FB2a09B3bc59198297",
          DELEGATION_MANAGER_ADDRESS: "0xa52e7C76811FAAC1514712eb0137d8f1631202DA",
          AGENT_WALLET_FACTORY_ADDRESS: "0x6313d16266FB2e60c8Ef142274e317878ba71677",
          ENTRY_POINT_ADDRESS: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
        },
      },
    },
  }

  const opencodeConfig = {
    mcp: {
      agentix: {
        type: "local",
        command: ["npx", "tsx", join(__dirname, "mcp-test", "src", "index.ts")],
        enabled: true,
        environment: {
          RPC_URL: rpcUrl, CHAIN_ID: chainId, NETWORK_NAME: networkName,
        },
      },
    },
  }

  const allConfigs = {
    "claude-desktop": {
      file: null,
      fileHint: join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json"),
      label: "Claude Desktop",
      content: serverConfig,
    },
    "claude-code": {
      file: join(__dirname, ".mcp.json"),
      label: "Claude Code (project scope)",
      content: serverConfig,
    },
    opencode: {
      file: join(__dirname, "opencode.json"),
      label: "OpenCode",
      content: opencodeConfig,
    },
    cursor: {
      file: join(__dirname, ".cursor/mcp.json"),
      label: "Cursor",
      content: { mcpServers: { agentix: { command: "npx", args: ["tsx", join(__dirname, "mcp-test", "src", "index.ts")] } } },
    },
    "vs-code": {
      file: join(__dirname, ".vscode/mcp.json"),
      label: "VS Code",
      content: { mcpServers: { agentix: { command: "npx", args: ["tsx", join(__dirname, "mcp-test", "src", "index.ts")] } } },
    },
    windsurf: {
      file: join(__dirname, ".windsurf/mcp.json"),
      label: "Windsurf",
      content: { mcpServers: { agentix: { command: "npx", args: ["tsx", join(__dirname, "mcp-test", "src", "index.ts")] } } },
    },
    jetbrains: {
      file: null,
      label: "JetBrains",
      content: { mcpServers: { agentix: { type: "http", url: "http://localhost:3100/mcp" } } },
    },
  }

  const configureMCP = await confirm("Generate MCP config files?", true)
  if (configureMCP) {
    console.log(chalk.gray("  Select platforms (comma-separated, e.g. 1,3,5):"))
    const platforms = Object.entries(allConfigs)
    for (const [i, [, cfg]] of platforms.entries()) {
      console.log(`    ${i + 1}. ${cfg.label}`)
    }
    const selection = await prompt("Choices (or 'all')", { default: "all" })
    console.log()

    const writeConfig = (key, cfg) => {
      if (cfg.file) {
        const parent = dirname(cfg.file)
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
        writeFileSync(cfg.file, JSON.stringify(cfg.content, null, 2) + "\n", "utf-8")
        success(`${cfg.label} → ${relPath(cfg.file)}`)
      } else if (cfg.label === "Claude Desktop") {
        info(`Add this to ${cfg.fileHint}:`)
        console.log(JSON.stringify(cfg.content, null, 2))
      } else if (cfg.label === "JetBrains") {
        info("Settings → Tools → AI Assistant → MCP → Add as JSON:")
        console.log(JSON.stringify(cfg.content))
      }
    }

    const writeAll = selection.trim() === "all"
    for (const [i, [key, cfg]] of platforms.entries()) {
      if (writeAll || selection.split(",").map(s => s.trim()).includes(String(i + 1))) {
        writeConfig(key, cfg)
      }
    }
  }
  console.log()

  // Write reference configs file
  const refPath = join(__dirname, "mcp-configs.json")
  writeFileSync(refPath, JSON.stringify(allConfigs, (k, v) => k === "file" ? undefined : v, 2) + "\n", "utf-8")
  success(`Reference configs → ${relPath(refPath)}`)
  console.log()

  // ── 8. Docker ──────────────────────────────────────────────
  if (useDocker) {
    console.log(chalk.bold("  Step 8: Start Docker Services"))
    console.log(chalk.gray("  ─────────────────────────────────────────"))
    info("PostgreSQL + Redis")
    console.log(chalk.gray("    docker compose up -d"))
    console.log()
  }

  // ── 9. Summary ─────────────────────────────────────────────
  console.log(chalk.bold("  Setup Complete"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))
  label("AI providers configured", String(Object.keys(providerKeys).length))
  label(".env files written", String(Object.keys(envs).length))
  console.log()
  console.log(chalk.bold("  Next Steps"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))
  if (useDocker) {
    info(`Run ${chalk.cyan("docker compose up -d")} (PostgreSQL + Redis)`)
  }
  info(`Run ${chalk.cyan("npm run dev:backend")}`)
  info(`Run ${chalk.cyan("npm run dev:frontend")}`)
  info(`Open ${chalk.cyan("http://localhost:3000")}`)
  console.log()
  console.log(chalk.bold("  MCP Server"))
  console.log(chalk.gray("  ─────────────────────────────────────────"))
  label("Stdio", chalk.cyan("cd mcp-test && npx tsx src/index.ts"))
  label("HTTP",  chalk.cyan("cd mcp-test && npx tsx src/index.ts --http --port 3100"))
  console.log()
  info(`Re-run: ${chalk.cyan("node setup.mjs")} to reconfigure`)
  console.log()

  rl.close()
}

main().catch((err) => {
  console.error("\n  Setup failed:", err)
  process.exit(1)
})
