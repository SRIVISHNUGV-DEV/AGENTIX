import * as crypto from "crypto"
import { ethers } from "ethers"
import { initDB } from "../../db"
import { AppError } from "../../utils/errors"

const RPC_URL = process.env.RPC_URLS || process.env.RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY?.trim() || ""

function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new AppError(500, "ENCRYPTION_KEY required for wallet decryption", false)
  }
  if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    throw new AppError(500, "ENCRYPTION_KEY must be 64 hex characters", false)
  }
  return Buffer.from(ENCRYPTION_KEY, "hex")
}

function decryptPrivateKey(encrypted: string): string {
  if (!encrypted.startsWith("ENC:")) return encrypted

  const parts = encrypted.split(":")
  if (parts.length !== 4) throw new Error("Invalid encrypted key format")

  const [, ivHex, authTagHex, encryptedData] = parts
  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encryptedData, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

interface AgentWalletEntry {
  id: number
  externalAgentId: number
  walletAddress: string
  encryptedKey: string
  dailyLimit: string
  isActive: boolean
}

export class WalletManager {
  private wallets: Map<number, ethers.Wallet> = new Map()
  private provider: ethers.JsonRpcProvider

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL)
  }

  async getWalletForAgent(agentId: number): Promise<ethers.Wallet> {
    const cached = this.wallets.get(agentId)
    if (cached) return cached

    const db = await initDB()
    const entry: AgentWalletEntry | undefined = await db.get(
      `SELECT id, external_agent_id, wallet_address, wallet_private_key_encrypted, daily_limit, is_active
       FROM agent_funding_accounts
       WHERE external_agent_id = ? AND is_active = 1
       ORDER BY id ASC
       LIMIT 1`,
      agentId
    )

    if (!entry) {
      throw new AppError(404, `No active funding account for agent ${agentId}`)
    }

    const privateKey = decryptPrivateKey(entry.encryptedKey)
    const wallet = new ethers.Wallet(privateKey, this.provider)

    if (wallet.address.toLowerCase() !== entry.walletAddress.toLowerCase()) {
      throw new AppError(500, "Decrypted key does not match stored address", false)
    }

    this.wallets.set(agentId, wallet)
    return wallet
  }

  async getAgentDailySpent(agentId: number): Promise<number> {
    const db = await initDB()
    const today = new Date().toISOString().split("T")[0]

    const row = await db.get(
      `SELECT COALESCE(SUM(CAST(details->>'value' AS FLOAT)), 0) as spent
       FROM covenant_spending_log
       WHERE agent_id = ? AND DATE(created_at) = ?`,
      agentId,
      today
    )

    return row?.spent || 0
  }

  async checkDailyLimit(agentId: number, amount: number): Promise<{
    allowed: boolean
    dailyLimit: number
    spentToday: number
    error?: string
  }> {
    const db = await initDB()
    const entry = await db.get(
      `SELECT daily_limit FROM agent_funding_accounts
       WHERE external_agent_id = ? AND is_active = 1
       LIMIT 1`,
      agentId
    )

    if (!entry) {
      return { allowed: false, dailyLimit: 0, spentToday: 0, error: "No funding account" }
    }

    const dailyLimit = Number(entry.daily_limit) || 0
    if (dailyLimit === 0) {
      return { allowed: true, dailyLimit: 0, spentToday: 0 }
    }

    const spentToday = await this.getAgentDailySpent(agentId)

    if (spentToday + amount > dailyLimit) {
      return {
        allowed: false,
        dailyLimit,
        spentToday,
        error: `Daily limit exceeded: $${spentToday} spent of $${dailyLimit}`
      }
    }

    return { allowed: true, dailyLimit, spentToday }
  }

  async logSpending(
    agentId: number,
    orgId: number,
    action: string,
    value: number,
    txHash?: string
  ): Promise<void> {
    const db = await initDB()
    await db.run(
      `INSERT INTO covenant_spending_log
       (agent_id, org_id, action, value, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      agentId,
      orgId,
      action,
      value,
      txHash || null,
      Math.floor(Date.now() / 1000)
    )
  }

  async removeWallet(agentId: number): Promise<void> {
    this.wallets.delete(agentId)
  }
}
