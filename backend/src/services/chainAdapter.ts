import { ethers } from "ethers"

export type ChainConfig = {
  chainId: number
  name: string
  rpcUrl: string
  contractAddresses: {
    verifier?: string
    credentialRegistry?: string
    sessionManager?: string
    capabilityRegistry?: string
    delegationManager?: string
    agentWalletFactory?: string
    agentWalletImplementation?: string
    entryPoint?: string
  }
  bundlerUrl?: string
  explorerUrl?: string
  nativeCurrency?: { name: string; symbol: string; decimals: number }
}

export type ChainRegistryEntry = {
  chainId: number
  name: string
  rpcUrls: string[]
  explorerUrl?: string
  nativeCurrency?: { name: string; symbol: string; decimals: number }
  contractAddresses: ChainConfig["contractAddresses"]
  active: boolean
  addedAt: number
}

type ChainConnections = {
  provider: ethers.JsonRpcProvider
  wallet: ethers.Signer
  bundlerUrl?: string
}

const normalizeAddress = (addr: string): string => {
  if (!addr) return ""
  try { return ethers.getAddress(addr.toLowerCase()) }
  catch { return addr }
}

const isRateLimitError = (error: any) => {
  const message = String(error?.message ?? error ?? "")
  return (
    message.includes("\"code\": 429") ||
    message.includes("compute units per second capacity") ||
    message.includes("Too Many Requests") ||
    message.includes("rate limit")
  )
}

function parseUrlList(value: string | undefined): string[] {
  if (!value) return []
  return value.split(",").map(s => s.trim()).filter(Boolean)
}

export class ChainAdapter {
  private connections = new Map<number, ChainConnections>()
  private registry: Map<number, ChainRegistryEntry> = new Map()
  private fallbackRpcUrls: Map<number, string[]> = new Map()
  private healthCheckTimers = new Map<number, ReturnType<typeof setInterval>>()
  private globalSigner: ethers.Wallet | null = null

  constructor() {
    this.loadFromEnvironment()
  }

  private loadFromEnvironment() {
    const chainId = Number(process.env.CHAIN_ID || "11155111")
    const name = process.env.NETWORK_NAME || "sepolia"
    const rpcUrls = parseUrlList(process.env.RPC_URLS || process.env.RPC_URL || "http://127.0.0.1:8545")
    const privateKey = process.env.PRIVATE_KEY || ""
    const bundlerUrl = process.env.BUNDLER_URL || process.env.BUNDLER_URLS || ""

    if (privateKey) {
      this.globalSigner = new ethers.Wallet(privateKey)
    }

    this.registerChain({
      chainId,
      name,
      rpcUrls,
      explorerUrl: process.env.EXPLORER_URL || undefined,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      contractAddresses: {
        verifier: normalizeAddress(process.env.VERIFIER_ADDRESS || ""),
        credentialRegistry: normalizeAddress(process.env.CREDENTIAL_REGISTRY_ADDRESS || ""),
        sessionManager: normalizeAddress(process.env.SESSION_MANAGER_ADDRESS || ""),
        capabilityRegistry: normalizeAddress(process.env.CAPABILITY_REGISTRY_ADDRESS || ""),
        delegationManager: normalizeAddress(process.env.DELEGATION_MANAGER_ADDRESS || ""),
        agentWalletFactory: normalizeAddress(process.env.AGENT_WALLET_FACTORY_ADDRESS || ""),
        agentWalletImplementation: normalizeAddress(process.env.AGENT_WALLET_IMPLEMENTATION_ADDRESS || ""),
        entryPoint: normalizeAddress(process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"),
      },
      active: true,
      addedAt: Date.now(),
    })

    const extraRpcUrls = parseUrlList(process.env.EXTRA_RPC_URLS)
    for (const entry of extraRpcUrls) {
      const [cid, ...urlParts] = entry.split("=")
      const cidNum = parseInt(cid, 10)
      if (cidNum && urlParts.length > 0) {
        this.fallbackRpcUrls.set(cidNum, [urlParts.join("=")])
      }
    }
  }

  registerChain(entry: ChainRegistryEntry): void {
    this.registry.set(entry.chainId, entry)
  }

  unregisterChain(chainId: number): void {
    this.registry.delete(chainId)
    this.disconnect(chainId)
  }

  getRegisteredChains(): ChainRegistryEntry[] {
    return Array.from(this.registry.values()).filter(e => e.active)
  }

  getChainConfig(chainId: number): ChainRegistryEntry | undefined {
    return this.registry.get(chainId)
  }

  async getProvider(chainId: number): Promise<ethers.JsonRpcProvider> {
    const existing = this.connections.get(chainId)
    if (existing) return existing.provider

    const entry = this.registry.get(chainId)
    if (!entry) throw new Error(`Chain ${chainId} not registered`)

    const rpcUrls = [...entry.rpcUrls, ...(this.fallbackRpcUrls.get(chainId) || [])]
    if (rpcUrls.length === 0) throw new Error(`No RPC URLs for chain ${chainId}`)

    let lastError: Error | null = null
    for (const url of rpcUrls) {
      try {
        const provider = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true })
        await provider.getBlockNumber()
        const wallet = this.globalSigner
          ? this.globalSigner.connect(provider)
          : ethers.Wallet.createRandom().connect(provider)

        const bundlerUrl = entry.rpcUrls[0] === process.env.BUNDLER_URL
          ? process.env.BUNDLER_URL
          : undefined

        this.connections.set(chainId, { provider, wallet, bundlerUrl })
        this.startHealthCheck(chainId)
        return provider
      } catch (err: any) {
        lastError = err
      }
    }
    throw lastError || new Error(`Failed to connect to chain ${chainId}`)
  }

  async getWallet(chainId: number): Promise<ethers.Signer> {
    if (!this.connections.has(chainId)) {
      await this.getProvider(chainId)
    }
    const conn = this.connections.get(chainId)
    if (!conn) throw new Error(`No connection for chain ${chainId}`)
    return conn.wallet
  }

  getBundlerUrl(chainId: number): string | undefined {
    const conn = this.connections.get(chainId)
    return conn?.bundlerUrl
  }

  getContractAddress(chainId: number, contract: keyof ChainConfig["contractAddresses"]): string | undefined {
    const entry = this.registry.get(chainId)
    return entry?.contractAddresses[contract]
  }

  async withRetry<T>(chainId: number, label: string, operation: () => Promise<T>, attempts = 5): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation()
      } catch (error: any) {
        if (i < attempts - 1 && isRateLimitError(error)) {
          const delay = Math.min(1200 * Math.pow(2, i), 30000)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw error
      }
    }
    throw new Error(`Retry failed for ${label} after ${attempts} attempts`)
  }

  async healthCheck(chainId: number): Promise<{ healthy: boolean; blockNumber?: number; error?: string }> {
    try {
      const provider = await this.getProvider(chainId)
      const blockNumber = await provider.getBlockNumber()
      return { healthy: true, blockNumber }
    } catch (error: any) {
      return { healthy: false, error: error.message }
    }
  }

  async healthCheckAll(): Promise<Record<number, { healthy: boolean; blockNumber?: number; error?: string }>> {
    const results: Record<number, { healthy: boolean; blockNumber?: number; error?: string }> = {}
    for (const chainId of this.registry.keys()) {
      results[chainId] = await this.healthCheck(chainId)
    }
    return results
  }

  private startHealthCheck(chainId: number) {
    if (this.healthCheckTimers.has(chainId)) return
    const timer = setInterval(async () => {
      try {
        const conn = this.connections.get(chainId)
        if (!conn) return
        await conn.provider.getBlockNumber()
      } catch {
        this.connections.delete(chainId)
        this.healthCheckTimers.delete(chainId)
      }
    }, 60000)
    this.healthCheckTimers.set(chainId, timer)
  }

  private disconnect(chainId: number) {
    const timer = this.healthCheckTimers.get(chainId)
    if (timer) { clearInterval(timer); this.healthCheckTimers.delete(chainId) }
    this.connections.delete(chainId)
  }

  destroy() {
    for (const chainId of this.healthCheckTimers.keys()) {
      this.disconnect(chainId)
    }
  }
}

let instance: ChainAdapter | null = null

export function getChainAdapter(): ChainAdapter {
  if (!instance) {
    instance = new ChainAdapter()
  }
  return instance
}
