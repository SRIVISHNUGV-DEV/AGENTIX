import { AgentClient } from "@agentix/sdk"
import { loadConfig, getAgentSecret, storeAgentSecret } from "./config"

export async function createClient(agentId?: number): Promise<AgentClient> {
  const config = loadConfig()
  const api = config.backendUrl || process.env.AGENTIX_BACKEND_URL || "http://127.0.0.1:3001"
  const client = new AgentClient(api)
  await client.init()

  if (agentId !== undefined) {
    const stored = getAgentSecret(agentId)
    if (stored !== null) {
      client.secret = stored
    } else {
      storeAgentSecret(agentId, client.secret)
    }
  }

  return client
}
