/**
 * Session Key Service
 *
 * Manages session keys for autonomous agent execution:
 * - Key generation (server-side for storage)
 * - Double encryption (user wallet + backend master key)
 * - Session validation and limit checking
 */

import crypto from "crypto"
import { Wallet } from "ethers"
import { initDB } from "../db"
import { AppError } from "../utils/errors"

// Backend master key for encryption (from env)
// SECURITY: Throw error in production if key not set
function getBackendMasterKey(): string {
  const key = process.env.SESSION_ENCRYPTION_KEY
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(500, "SESSION_ENCRYPTION_KEY must be set in production environment")
    }
    // Only allow default key in development
    return "default-master-key-change-in-production"
  }
  return key
}
const BACKEND_MASTER_KEY = getBackendMasterKey()

export interface AgentSession {
  id: string
  externalAgentId: number
  agentWalletAddress: string
  sessionKeyEncrypted: string
  sessionKeyPublic: string
  sessionIdOnChain: string
  dailySpendLimit: bigint
  dailyTxLimit: number
  expiresAt: number
  revoked: boolean
  createdAt: number
}

export interface SessionValidation {
  valid: boolean
  error?: string
  session?: AgentSession
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encryptData(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)

  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")

  const authTag = cipher.getAuthTag()

  // Return: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decryptData(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(":")
  if (parts.length !== 3) {
    throw new AppError(400, "Invalid encrypted data format")
  }

  const iv = Buffer.from(parts[0], "hex")
  const authTag = Buffer.from(parts[1], "hex")
  const ciphertext = parts[2]

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(ciphertext, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}

/**
 * Derive encryption key from backend master key and session ID
 */
function deriveEncryptionKey(sessionId: string): Buffer {
  return crypto.createHash("sha256")
    .update(BACKEND_MASTER_KEY)
    .update(sessionId)
    .digest()
}

/**
 * Generate a new session key pair
 */
export function generateSessionKeyPair(): { privateKey: string; publicKey: string } {
  const wallet = Wallet.createRandom()
  return {
    privateKey: wallet.privateKey,
    publicKey: wallet.address
  }
}

export class SessionKeyService {

  /**
   * Create a new session for an agent
   */
  async createSession(params: {
    externalAgentId: number
    agentWalletAddress: string
    sessionKeyPrivate: string
    sessionKeyPublic: string
    sessionIdOnChain: string
    dailySpendLimit?: bigint
    dailyTxLimit?: number
    expiresInSeconds?: number
  }): Promise<AgentSession> {
    const db = await initDB()

    // Generate session ID
    const sessionId = crypto.randomUUID()

    // Encrypt the private key with backend key
    const encryptionKey = deriveEncryptionKey(sessionId)
    const encryptedKey = encryptData(params.sessionKeyPrivate, encryptionKey)

    // Set defaults
    const dailySpendLimit = params.dailySpendLimit || BigInt("100000000000000000") // 0.1 ETH
    const dailyTxLimit = params.dailyTxLimit || 10
    const expiresAt = Math.floor(Date.now() / 1000) + (params.expiresInSeconds || 7 * 24 * 60 * 60) // 7 days

    // Check for existing session
    const existing = await db.get(
      `SELECT id FROM agent_sessions WHERE external_agent_id = ? AND revoked = 0 AND expires_at > ?`,
      params.externalAgentId,
      Math.floor(Date.now() / 1000)
    )

    if (existing) {
      throw new AppError(400, "Agent already has an active session. Revoke it first.")
    }

    // Insert session
    await db.run(
      `INSERT INTO agent_sessions (
        id, external_agent_id, agent_wallet_address, session_key_encrypted,
        session_key_public, session_id_on_chain, daily_spend_limit,
        daily_tx_limit, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      params.externalAgentId,
      params.agentWalletAddress.toLowerCase(),
      encryptedKey,
      params.sessionKeyPublic,
      params.sessionIdOnChain,
      dailySpendLimit.toString(),
      dailyTxLimit,
      expiresAt
    )

    return {
      id: sessionId,
      externalAgentId: params.externalAgentId,
      agentWalletAddress: params.agentWalletAddress,
      sessionKeyEncrypted: encryptedKey,
      sessionKeyPublic: params.sessionKeyPublic,
      sessionIdOnChain: params.sessionIdOnChain,
      dailySpendLimit,
      dailyTxLimit,
      expiresAt,
      revoked: false,
      createdAt: Math.floor(Date.now() / 1000)
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AgentSession | null> {
    const db = await initDB()
    const row = await db.get(
      `SELECT * FROM agent_sessions WHERE id = ?`,
      sessionId
    )

    if (!row) return null

    return {
      id: row.id,
      externalAgentId: row.external_agent_id,
      agentWalletAddress: row.agent_wallet_address,
      sessionKeyEncrypted: row.session_key_encrypted,
      sessionKeyPublic: row.session_key_public,
      sessionIdOnChain: row.session_id_on_chain,
      dailySpendLimit: BigInt(row.daily_spend_limit),
      dailyTxLimit: row.daily_tx_limit,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      createdAt: row.created_at
    }
  }

  /**
   * Get active session for an agent
   */
  async getSessionForAgent(externalAgentId: number): Promise<AgentSession | null> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)

    const row = await db.get(
      `SELECT * FROM agent_sessions
       WHERE external_agent_id = ? AND revoked = 0 AND expires_at > ?`,
      externalAgentId,
      now
    )

    if (!row) return null

    return {
      id: row.id,
      externalAgentId: row.external_agent_id,
      agentWalletAddress: row.agent_wallet_address,
      sessionKeyEncrypted: row.session_key_encrypted,
      sessionKeyPublic: row.session_key_public,
      sessionIdOnChain: row.session_id_on_chain,
      dailySpendLimit: BigInt(row.daily_spend_limit),
      dailyTxLimit: row.daily_tx_limit,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      createdAt: row.created_at
    }
  }

  /**
   * Unlock session key (decrypt and return private key)
   * Called when user connects runtime with signature
   */
  async unlockSession(sessionId: string): Promise<{ privateKey: string; session: AgentSession }> {
    const session = await this.getSession(sessionId)

    if (!session) {
      throw new AppError(404, "Session not found")
    }

    // Validate session
    const validation = await this.validateSessionForExecution(sessionId, session.agentWalletAddress, session.externalAgentId, BigInt(0))
    if (!validation.valid) {
      throw new AppError(403, validation.error || "Session validation failed")
    }

    // Decrypt the session key
    const encryptionKey = deriveEncryptionKey(sessionId)
    const privateKey = decryptData(session.sessionKeyEncrypted, encryptionKey)

    return { privateKey, session }
  }

  /**
   * Validate session for execution
   */
  async validateSessionForExecution(
    sessionId: string,
    walletAddress: string,
    agentId: number,
    value: bigint
  ): Promise<SessionValidation> {
    const session = await this.getSession(sessionId)

    if (!session) {
      return { valid: false, error: "Session not found" }
    }

    // Check wallet binding
    if (session.agentWalletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return { valid: false, error: "Session not authorized for this wallet" }
    }

    // Check agent binding
    if (session.externalAgentId !== agentId) {
      return { valid: false, error: "Session not authorized for this agent" }
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (now > session.expiresAt) {
      return { valid: false, error: "Session expired" }
    }

    // Check revocation
    if (session.revoked) {
      return { valid: false, error: "Session revoked" }
    }

    // Check daily limits
    const usage = await this.getTodayUsage(sessionId)
    if (usage.spendUsed + value > session.dailySpendLimit) {
      return { valid: false, error: "Daily spend limit exceeded" }
    }
    if (usage.txCount >= session.dailyTxLimit) {
      return { valid: false, error: "Daily transaction limit exceeded" }
    }

    return { valid: true, session }
  }

  /**
   * Get today's usage for a session
   */
  async getTodayUsage(sessionId: string): Promise<{ spendUsed: bigint; txCount: number }> {
    const db = await initDB()
    // Use PostgreSQL DATE format: YYYY-MM-DD
    const today = new Date().toISOString().split("T")[0]

    const row = await db.get(
      `SELECT spend_used, tx_count FROM session_usage WHERE session_id = ? AND usage_date = ?`,
      sessionId,
      today
    )

    if (!row) {
      return { spendUsed: BigInt(0), txCount: 0 }
    }

    return {
      spendUsed: BigInt(row.spend_used),
      txCount: row.tx_count
    }
  }

  /**
   * Record usage after successful execution
   */
  async recordUsage(sessionId: string, value: bigint): Promise<void> {
    const db = await initDB()
    // Use PostgreSQL DATE format: YYYY-MM-DD
    const today = new Date().toISOString().split("T")[0]

    // Upsert usage
    await db.run(
      `INSERT INTO session_usage (session_id, usage_date, spend_used, tx_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(session_id, usage_date)
       DO UPDATE SET
         spend_used = spend_used + ?,
         tx_count = tx_count + 1`,
      sessionId,
      today,
      value.toString(),
      value.toString()
    )
  }

  /**
   * Revoke a session
   */
  async revokeSession(sessionId: string): Promise<void> {
    const db = await initDB()

    // Check if session exists
    const existing = await db.get(
      `SELECT id FROM agent_sessions WHERE id = ?`,
      sessionId
    )

    if (!existing) {
      throw new AppError(404, "Session not found")
    }

    await db.run(
      `UPDATE agent_sessions SET revoked = 1 WHERE id = ?`,
      sessionId
    )
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)

    const result = await db.run(
      `DELETE FROM agent_sessions WHERE expires_at < ? AND revoked = 0`,
      now
    )

    return result.changes || 0
  }
}
