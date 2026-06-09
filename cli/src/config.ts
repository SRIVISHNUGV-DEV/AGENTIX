import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const CONFIG_DIR = join(homedir(), ".agentix")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

export interface CliConfig {
  backendUrl?: string
  chainId?: number
  rpcUrl?: string
  credentialRegistry?: string
  sessionManager?: string
  agents?: Record<number, {
    secret?: string
    orgId?: number
  }>
}

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
  } catch {
    return {}
  }
}

export function saveConfig(config: CliConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function getAgentSecret(agentId: number): bigint | null {
  const config = loadConfig()
  const s = config.agents?.[agentId]?.secret
  return s ? BigInt(s) : null
}

export function storeAgentSecret(agentId: number, secret: bigint, orgId?: number): void {
  const config = loadConfig()
  if (!config.agents) config.agents = {}
  config.agents[agentId] = {
    secret: secret.toString(),
    orgId: orgId ?? config.agents[agentId]?.orgId,
  }
  saveConfig(config)
}
