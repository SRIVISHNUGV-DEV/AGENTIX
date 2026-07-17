import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { ethers } from "ethers";
import { AGENTIX_HOME } from "./config";
import { runExecute, runSingle } from "./database";
import { logger } from "./logger";

/**
 * session-keystore — per-session agent keypairs.
 *
 * WHY: previously the "session key" defaulted to the wallet/owner address, which
 * meant an agent could not sign anything without the owner's private key — no
 * autonomy, no delegation, and the owner key would have to travel to the agent.
 * That defeats the entire session model.
 *
 * NOW: every session gets a freshly generated secp256k1 keypair. The PUBLIC
 * address is registered on-chain as the session's `sessionKey` (SessionManager
 * enforces sessionKey != wallet). The PRIVATE key is what the agent uses to sign
 * UserOps autonomously, bounded by the session's on-chain policy (budget, expiry,
 * targets). The owner key only ever signs the one-time createSession transaction.
 *
 * The private key is encrypted at rest with AES-256-GCM under a machine-local
 * master secret (0600 file under AGENTIX_HOME). The plaintext key is returned to
 * the caller exactly once at creation so an external/self-custody agent can hold
 * it itself; runtime-signing agents can instead have the runtime decrypt on demand.
 */

const MASTER_SECRET_PATH = join(AGENTIX_HOME, "keys", "master.key");

/** Load (or lazily create) the 32-byte machine-local master secret. */
function getMasterSecret(): Buffer {
  // Env override wins — lets operators supply an externally-managed secret
  // (e.g. from a KMS / vault) instead of the on-disk file.
  const envSecret = process.env.AGENTIX_KEYSTORE_SECRET;
  if (envSecret && envSecret.length >= 32) {
    return scryptSync(envSecret, "agentix-session-keystore", 32);
  }

  if (existsSync(MASTER_SECRET_PATH)) {
    const raw = readFileSync(MASTER_SECRET_PATH);
    if (raw.length >= 32) return raw.subarray(0, 32);
  }

  // Generate a fresh 32-byte secret and persist it 0600.
  const secret = randomBytes(32);
  mkdirSync(dirname(MASTER_SECRET_PATH), { recursive: true });
  writeFileSync(MASTER_SECRET_PATH, secret, { mode: 0o600 });
  try {
    chmodSync(MASTER_SECRET_PATH, 0o600);
  } catch {
    /* best-effort on platforms without POSIX perms */
  }
  logger.info("keystore", "Generated new machine-local keystore master secret");
  return secret;
}

/** AES-256-GCM encrypt a private key. Format: base64(iv[12] || authTag[16] || ciphertext). */
function encryptKey(privateKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterSecret(), iv);
  const ct = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Reverse of encryptKey. Throws if the ciphertext was tampered with (GCM auth). */
function decryptKey(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getMasterSecret(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct, undefined, "utf8") + decipher.final("utf8");
}

export interface GeneratedSessionKey {
  /** The session key's public address — this is what gets registered on-chain. */
  address: string;
  /** The plaintext private key. Returned ONCE at generation; never persisted in clear. */
  privateKey: string;
}

/**
 * Generate a fresh session keypair. The private key is NOT stored here — call
 * persistSessionKey once the session_id is known so it can be encrypted at rest.
 */
export function generateSessionKey(): GeneratedSessionKey {
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}

/**
 * Encrypt and store a session's private key, bound to its session_id.
 * Safe to call once per session; re-storing overwrites the prior blob.
 */
export function persistSessionKey(sessionId: string, address: string, privateKey: string): void {
  const enc = encryptKey(privateKey);
  runExecute(
    `INSERT INTO session_keys (session_id, address, encrypted_key, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET address = excluded.address, encrypted_key = excluded.encrypted_key`,
    sessionId,
    address,
    enc,
    Math.floor(Date.now() / 1000)
  );
}

/**
 * Load and decrypt a session's private key for runtime signing.
 * Returns null if the session has no stored key (e.g. externally self-custodied).
 */
export function loadSessionKey(sessionId: string): { address: string; privateKey: string } | null {
  const row = runSingle<{ address: string; encrypted_key: string }>(
    "SELECT address, encrypted_key FROM session_keys WHERE session_id = ?",
    sessionId
  );
  if (!row?.encrypted_key) return null;
  try {
    return { address: row.address, privateKey: decryptKey(row.encrypted_key) };
  } catch (e: any) {
    logger.error("keystore", `Failed to decrypt session key for ${sessionId}: ${e.message}`);
    return null;
  }
}

/** Delete a session's stored key (call on session revoke to minimize exposure). */
export function purgeSessionKey(sessionId: string): void {
  runExecute("DELETE FROM session_keys WHERE session_id = ?", sessionId);
}
