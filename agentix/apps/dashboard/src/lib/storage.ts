"use client";

const HARNESS_WALLETS_KEY = "agentix_harness_wallets";
const AGENT_KEY_KEY = "agentix_agent_key";

export function getHarnessWallets(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(HARNESS_WALLETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setHarnessWallets(wallets: Record<string, string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HARNESS_WALLETS_KEY, JSON.stringify(wallets));
}

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
export function getAgentKey(): AgentKey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AGENT_KEY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

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
