import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function loadDotenv(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(__dirname, "..", ".env"),
    join(__dirname, "..", "..", ".env"),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
      if (!process.env[key]) process.env[key] = val
    }
  }
}

loadDotenv()

export const CHAIN_ID = Number(process.env.CHAIN_ID || "84532")
export const NETWORK_NAME = process.env.NETWORK_NAME || "sepolia"
export const RPC_URL = process.env.RPC_URL || "https://base-sepolia.g.alchemy.com/v2/demo"
export const HTTP_PORT = parseInt(process.env.PORT || process.env.MCP_HTTP_PORT || "3100", 10)
export const PACKAGE_NAME = process.env.npm_package_name || "agentix-mcp-test"
export const PACKAGE_VERSION = process.env.npm_package_version || "0.2.0"
export const CLI_NAME = "amt"

export const CONTRACT_ADDRESSES = {
  verifier: process.env.VERIFIER_ADDRESS || "0x6cBbB06df8Ddc8D28992F5149C755aAe0E0EB61f",
  credentialRegistry: process.env.CREDENTIAL_REGISTRY_ADDRESS || "0x83e0e671c0D31a288B93B9F04B7c4e116a065F5c",
  sessionManager: process.env.SESSION_MANAGER_ADDRESS || "0xcC0a3400397F8A54e54DA2c7A703bC5B27354C58",
  capabilityRegistry: process.env.CAPABILITY_REGISTRY_ADDRESS || "0xA5624939Fd99ed689Bc564FB2a09B3bc59198297",
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS || "0xa52e7C76811FAAC1514712eb0137d8f1631202DA",
  agentWalletFactory: process.env.AGENT_WALLET_FACTORY_ADDRESS || "0x6313d16266FB2e60c8Ef142274e317878ba71677",
  entryPoint: process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
}
