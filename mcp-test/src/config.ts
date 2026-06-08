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
  verifier: process.env.VERIFIER_ADDRESS || "0xa9ED81d44847729a7C8D33907BaDFb767ac9AC48",
  credentialRegistry: process.env.CREDENTIAL_REGISTRY_ADDRESS || "0xb1841A44b57904849898EaA956b1C01a182e4F95",
  sessionManager: process.env.SESSION_MANAGER_ADDRESS || "0x58E1D578ecd41e0D2639BA1C3C8E4795A8F6Ee7a",
  capabilityRegistry: process.env.CAPABILITY_REGISTRY_ADDRESS || "0x7Ebb4E2574613D73a1DC112E129f2c3b20b75Bb9",
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS || "0xc7522D29E63f2a2cdEdeC405093920D2FC3B95d7",
  agentWalletFactory: process.env.AGENT_WALLET_FACTORY_ADDRESS || "0x7689B8C445fAd670b03A0f68A912f5e93131138b",
  entryPoint: process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
}
