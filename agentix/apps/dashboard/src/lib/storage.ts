"use client";

const HARNESS_WALLETS_KEY = "agentix_harness_wallets";
const AGENT_KEY_KEY = "agentix_agent_key";

/**
 * Returns the persisted harnessId → walletAddress map.
 * @returns The map, or {} on the server (no window) and when the stored JSON is corrupt.
 * @throws Never — parse/storage errors fall back to {}.
 * Maps to: internal — the harnessWalletMap state in AgentsPage and OrganizationsPage.
 * Side effects: reads localStorage.
 */
export function getHarnessWallets(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(HARNESS_WALLETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persists the harnessId → walletAddress map.
 * @returns void; no-op on the server.
 * Maps to: internal — getHarnessWallets.
 * Side effects: writes localStorage (overwrites the whole map, so callers must pass the complete map).
 */
export function setHarnessWallets(wallets: Record<string, string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HARNESS_WALLETS_KEY, JSON.stringify(wallets));
}

/**
 * Alias of setHarnessWallets, kept so call sites read as a save rather than a setter.
 * @returns void; same behaviour and side effects as setHarnessWallets.
 * Maps to: internal — setHarnessWallets.
 */
export const saveHarnessWallets = setHarnessWallets;

export interface AgentKey {
  address: string;
  privateKey: string;
}

// R-14: the agent key lives in sessionStorage, NOT localStorage. The
// pre-fix code persisted it in localStorage with no expiry — a plaintext
// credential store surviving every session. sessionStorage clears when
// the tab closes, so a stale key stops loading after the session ends.
// setAgentKey also removes any legacy localStorage copy so the old
// plaintext location does not linger.
/**
 * Returns the agent session keypair (address + private key), or null.
 * R-14: the key lives in sessionStorage, NOT localStorage, so it dies with the tab instead of persisting as a plaintext credential.
 * @returns The parsed AgentKey, or null on the server and when nothing (or corrupt JSON) is stored.
 * @throws Never — parse/storage errors fall back to null.
 * Maps to: internal — setAgentKey; used by AgentsPage for bundler execution.
 * Side effects: reads sessionStorage.
 * Security: returns a live private key — callers must never render it outside the one-time secret banner or send it anywhere except the local bundler relay.
 */
export function getAgentKey(): AgentKey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AGENT_KEY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Stores (or clears) the agent session keypair in sessionStorage.
 * Also removes any legacy localStorage copy so the old plaintext location does not linger.
 * @param key - Keypair to store; null clears it from sessionStorage.
 * @returns void; no-op on the server.
 * @throws Never — storage errors are swallowed.
 * Maps to: internal — getAgentKey.
 * Side effects: writes/removes sessionStorage and localStorage.
 * Security: persists a private key — sessionStorage only, cleared when the tab closes.
 */
export function setAgentKey(key: AgentKey | null) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(AGENT_KEY_KEY); } catch {}
  try {
    if (key) {
      sessionStorage.setItem(AGENT_KEY_KEY, JSON.stringify(key));
    } else {
      sessionStorage.removeItem(AGENT_KEY_KEY);
    }
  } catch {}
}
