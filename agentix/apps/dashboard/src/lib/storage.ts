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

export function getAgentKey(): AgentKey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AGENT_KEY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAgentKey(key: AgentKey | null) {
  if (typeof window === "undefined") return;
  if (key) {
    localStorage.setItem(AGENT_KEY_KEY, JSON.stringify(key));
  } else {
    localStorage.removeItem(AGENT_KEY_KEY);
  }
}
