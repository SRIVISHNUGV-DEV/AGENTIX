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

/**
 * Load (or lazily create) the 32-byte machine-local master secret for session-key encryption.
 * AGENTIX_KEYSTORE_SECRET (>=32 chars) wins over the file, so operators can supply a KMS/vault secret.
 * @returns The 32-byte secret; a fresh one is generated and persisted 0600 on first use.
 * @throws Throws on disk I/O failure when the secret must be created or read.
 * Maps to: internal — encryptKey / decryptKey (AES-256-GCM key).
 * Side effects: creates AGENTIX_HOME/keys/master.key (0600) on first use.
 * Security: anyone holding this secret can decrypt every stored session key — it must never leave this machine.
 */
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

/**
 * AES-256-GCM-encrypt a session private key under the master secret.
 * Fresh random 12-byte IV per call, so identical keys encrypt differently every time.
 * @param privateKey — the plaintext key; never log the input or the output blob's plaintext.
 * @returns Base64 of iv[12] || authTag[16] || ciphertext.
 * @throws Throws when the master secret cannot be loaded.
 * Maps to: internal — persistSessionKey (encrypts before storing).
 * Security: GCM authentication means tampered blobs fail loudly in decryptKey instead of decrypting to garbage.
 */
function encryptKey(privateKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterSecret(), iv);
  const ct = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Reverse encryptKey: decrypt a stored session private key blob.
 * The GCM auth tag is verified first, so a tampered blob is rejected rather than silently decrypted.
 * @param blob — base64 iv || authTag || ciphertext, exactly as encryptKey produced it.
 * @returns The plaintext private key.
 * @throws Throws on malformed base64, a short blob, or GCM auth failure (tampering / wrong master secret).
 * Maps to: internal — loadSessionKey (decrypts on demand for runtime signing).
 * Security: the returned plaintext key must live in memory only and never be logged or persisted in clear.
 */
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
 * Generate a fresh secp256k1 session keypair for one session.
 * The private key is NOT stored here — call persistSessionKey once the session id exists.
 * @returns { address, privateKey } — the address is what gets registered on-chain as the sessionKey.
 * @throws Never throws in practice (ethers random wallet generation).
 * Maps to: contract SessionManager.createSession (the address is registered as the session's sessionKey).
 * Security: the private key is returned exactly once; the caller must hand it to the agent or persist it encrypted — never log it.
 */
export function generateSessionKey(): GeneratedSessionKey {
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}

/**
 * Encrypt and store a session's private key, bound to its session id.
 * Re-storing overwrites the prior blob, so calling it twice for one session is safe but replaces the key.
 * @param sessionId — the session this key belongs to; must already exist (used as the DB key).
 * @param address — the session key's public address (registered on-chain).
 * @param privateKey — plaintext key; encrypted before it touches the DB.
 * @returns Nothing.
 * @throws Throws on DB failure; callers must not proceed as if the key were stored.
 * Maps to: internal — session creation flow (stores the key generated by generateSessionKey).
 * Side effects: upserts one row in session_keys.
 * Security: only the GCM-encrypted blob is stored; the plaintext must not be logged.
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
 * Returns null for sessions whose key was never stored (externally self-custodied agents) — that is normal, not an error.
 * @param sessionId — the session to load; unknown ids return null.
 * @returns { address, privateKey } on success, or null when no key is stored or decryption fails.
 * @throws Never throws — decryption failures are logged and return null.
 * Maps to: internal — bundler signing (runtime-signing agents decrypt on demand).
 * Security: the returned plaintext key must live in memory only and never be logged.
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

/**
 * Delete a session's stored key, e.g. when the session is revoked.
 * Deleting the row is the exposure minimiser: a revoked session's key must not linger encrypted on disk.
 * @param sessionId — the session whose key to delete; unknown ids are a silent no-op.
 * @returns Nothing.
 * @throws Throws on DB failure; callers should retry or log, since the key would otherwise survive revocation.
 * Maps to: internal — session revoke path (contract SessionManager.revokeSession counterpart).
 * Side effects: deletes one row from session_keys.
 */
export function purgeSessionKey(sessionId: string): void {
  runExecute("DELETE FROM session_keys WHERE session_id = ?", sessionId);
}
