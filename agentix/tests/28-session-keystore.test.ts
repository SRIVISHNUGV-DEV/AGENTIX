/**
 * 28-session-keystore.test.ts — proves per-session agent keypairs.
 *
 * The fix: sessions no longer reuse the owner/wallet address as the "session key"
 * (which gave zero autonomy). Each session now gets its own generated keypair; the
 * public address goes on-chain, the private key is encrypted at rest and lets the
 * agent sign autonomously within the session's policy.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";

describe("session keystore — per-session agent keys", () => {
  let ks: typeof import("../src/core/session-keystore");

  beforeAll(async () => {
    // Deterministic master secret for the test run.
    process.env.AGENTIX_KEYSTORE_SECRET = "test-master-secret-that-is-long-enough-32b";
    ks = await import("../src/core/session-keystore");
  });

  it("generates a fresh keypair distinct from any wallet/owner address", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const k1 = ks.generateSessionKey();
    const k2 = ks.generateSessionKey();
    expect(ethers.isAddress(k1.address)).toBe(true);
    expect(k1.address.toLowerCase()).not.toBe(wallet.toLowerCase());
    // Each call is unique — not derived from the wallet.
    expect(k1.address).not.toBe(k2.address);
    expect(k1.privateKey).not.toBe(k2.privateKey);
    // The private key actually controls the address.
    expect(new ethers.Wallet(k1.privateKey).address).toBe(k1.address);
  });

  it("encrypts at rest and round-trips the exact private key", () => {
    const sessionId = "0x" + "ab".repeat(32);
    const key = ks.generateSessionKey();
    ks.persistSessionKey(sessionId, key.address, key.privateKey);

    const loaded = ks.loadSessionKey(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.address).toBe(key.address);
    expect(loaded!.privateKey).toBe(key.privateKey);
    // Loaded key signs as the same address — proves it's usable for autonomous signing.
    expect(new ethers.Wallet(loaded!.privateKey).address).toBe(key.address);
  });

  it("does not store the private key in cleartext", async () => {
    const sessionId = "0x" + "cd".repeat(32);
    const key = ks.generateSessionKey();
    ks.persistSessionKey(sessionId, key.address, key.privateKey);

    const { runSingle } = await import("../src/core/database");
    const row = runSingle<{ encrypted_key: string }>(
      "SELECT encrypted_key FROM session_keys WHERE session_id = ?",
      sessionId
    );
    expect(row).toBeTruthy();
    // The stored blob must not contain the plaintext private key.
    expect(row!.encrypted_key).not.toContain(key.privateKey);
    expect(row!.encrypted_key).not.toContain(key.privateKey.slice(2));
  });

  it("purges the key on revoke so a revoked session can never sign", () => {
    const sessionId = "0x" + "ef".repeat(32);
    const key = ks.generateSessionKey();
    ks.persistSessionKey(sessionId, key.address, key.privateKey);
    expect(ks.loadSessionKey(sessionId)).not.toBeNull();

    ks.purgeSessionKey(sessionId);
    expect(ks.loadSessionKey(sessionId)).toBeNull();
  });

  it("returns null for an unknown session (no key leaks)", () => {
    expect(ks.loadSessionKey("0x" + "00".repeat(32))).toBeNull();
  });
});
