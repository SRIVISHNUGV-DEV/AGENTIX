"use client";

// API base. Default is EMPTY (same-origin) so all calls hit "/api/..." on the
// dashboard's own port. next.config.js rewrites "/api/*" to the API server's
// actual (possibly dynamic) port, discovered from AGENTIX_HOME/runtime.json at
// dashboard startup. This keeps the browser port-agnostic — it never needs to
// know where the backend landed. Set NEXT_PUBLIC_API_URL only to point the
// dashboard at a remote/non-default API host.
export const API = process.env.NEXT_PUBLIC_API_URL || "";

// Local API token (R-5): the per-run X-Agentix-Token the API server
// requires on state-changing routes (and sensitive GETs). The owner
// pastes it once in Settings; it lives in dashboard-origin localStorage
// (readable only by scripts on this origin) and is sent as a header on
// every API call. Without it, state-changing dashboard actions get a 403
// telling the owner where to find the token.
const LOCAL_TOKEN_KEY = "agentix_local_token";

export function getLocalToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LOCAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setLocalToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem(LOCAL_TOKEN_KEY, token);
    else localStorage.removeItem(LOCAL_TOKEN_KEY);
  } catch {}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getLocalToken();
  if (token) headers["X-Agentix-Token"] = token;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers, ...((options?.headers as Record<string, string>) || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export async function fetchJSON<T>(path: string): Promise<T> {
  return request<T>(path);
}

export async function postJSON<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function putJSON<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteJSON<T>(path: string, body?: any): Promise<T> {
  return request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined });
}

export const EXPLORER = "https://sepolia.basescan.org";

export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

export function explorerAddress(addr: string) {
  return `${EXPLORER}/address/${addr}`;
}

export function explorerBlock(block: number | string) {
  return `${EXPLORER}/block/${block}`;
}

export function truncate(addr: string, chars = 6): string {
  if (!addr) return "—";
  return addr.length > chars + 4 ? `${addr.slice(0, chars)}...${addr.slice(-4)}` : addr;
}
