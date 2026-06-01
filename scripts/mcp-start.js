#!/usr/bin/env node

/**
 * Agentix MCP Server — universal launcher
 *
 * Works on Windows, macOS, and Linux with just Node.js 18+.
 * Uses tsx to run TypeScript directly — no build step needed.
 *
 * Usage:
 *   node scripts/mcp-start.js
 *
 * Or after npm install:
 *   npm run start:mcp
 */

import { existsSync, readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

function loadEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(ROOT, "backend", ".env"),
    resolve(ROOT, ".env"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const content = readFileSync(p, "utf8")
      let count = 0
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const value = trimmed.slice(eq + 1).trim()
        if (!process.env[key]) {
          process.env[key] = value
          count++
        }
      }
      console.error(`[agentix] Loaded ${count} vars from ${p}`)
      return
    }
  }
  console.error("[agentix] No .env found — using existing environment")
}

function checkPrereqs() {
  const missing = []

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    missing.push("DATABASE_URL (PostgreSQL connection string)")
  }
  if (!process.env.RPC_URL) {
    missing.push("RPC_URL (Ethereum RPC endpoint)")
  }
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = "0000000000000000000000000000000000000000000000000000000000000000"
    console.error("[agentix] WARNING: Using default ENCRYPTION_KEY — not suitable for production")
  }
  if (!process.env.SESSION_ENCRYPTION_KEY) {
    process.env.SESSION_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  }

  if (missing.length > 0) {
    console.error("[agentix] Missing required environment variables:")
    for (const m of missing) console.error(`  - ${m}`)
    console.error("[agentix] Create a backend/.env file (see backend/.env.example)")
    if (!process.env.DATABASE_URL) {
      console.error("[agentix] PostgreSQL is REQUIRED. Start it with Docker:")
      console.error('  docker run -e POSTGRES_USER=agentix -e POSTGRES_PASSWORD=agentix-secret -e POSTGRES_DB=agentix -p 5432:5432 postgres:16')
    }
  }
}

function printBanner() {
  const banner = `
╔══════════════════════════════════════════════════════════════╗
║                    AGENTIX MCP SERVER                       ║
║  Trust Infrastructure for Autonomous AI Agents              ║
║                                                            ║
║  30 MCP tools • 8 smart contracts • ZK proofs • ERC-4337   ║
╚══════════════════════════════════════════════════════════════╝
  `
  console.error(banner)
  console.error(`  Database:   ${(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").split("@")[1] || "not set"}`)
  console.error(`  Chain:      Sepolia (${process.env.CHAIN_ID || "11155111"})`)
  console.error(`  MCP:        http://localhost:${process.env.PORT || "3001"}/mcp`)
  console.error(`  Health:     http://localhost:${process.env.PORT || "3001"}/health`)
  console.error(`  Tools:      http://localhost:${process.env.PORT || "3001"}/tools`)
  console.error()
}

function findTsx(): string {
  const candidates = [
    resolve(ROOT, "node_modules", ".bin", "tsx"),
    resolve(ROOT, "backend", "node_modules", ".bin", "tsx"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
    if (existsSync(p + ".exe")) return p + ".exe"
    if (existsSync(p + ".cmd")) return p + ".cmd"
  }
  return "npx tsx"
}

async function main() {
  loadEnv()
  checkPrereqs()
  printBanner()

  const entryPoint = resolve(ROOT, "backend", "src", "index.ts")
  const tsx = findTsx()
  const nodeArgs = process.execArgv.filter(a => a.startsWith("--"))
  const userArgs = process.argv.slice(2)

  const child = spawn(process.execPath, [...nodeArgs, tsx, entryPoint, ...userArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: process.env.PORT || "3001",
    },
    cwd: resolve(ROOT, "backend"),
  })

  child.on("exit", (code) => process.exit(code ?? 0))
  child.on("error", (err) => {
    console.error("[agentix] Failed to start:", err.message)
    console.error("[agentix] Try: npm install")
    process.exit(1)
  })
}

main()
