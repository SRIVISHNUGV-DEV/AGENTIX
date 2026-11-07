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

/**
 * Returns the stored per-run local API token, or null when there is none.
 * Read at call time (not cached) so a token pasted in Settings takes effect without a reload.
 * @returns The token string, or null on the server (no window) and when storage is empty/unreadable.
 * @throws Never — storage errors are swallowed and reported as null.
 * Maps to: REST — X-Agentix-Token header attached by request().
 * Side effects: reads dashboard-origin localStorage.
 */
export function getLocalToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LOCAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists (or clears) the per-run local API token used by request().
 * Why it exists: state-changing routes and sensitive GETs return 403 without it.
 * @param token - Token to store; null removes the stored token.
 * @returns void.
 * @throws Never — storage errors are swallowed.
 * Maps to: internal — getLocalToken.
 * Side effects: writes/removes dashboard-origin localStorage.
 * Security: the token is a bearer credential for the local API; it lives in localStorage, so any script on this origin can read it.
 */
export function setLocalToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem(LOCAL_TOKEN_KEY, token);
    else localStorage.removeItem(LOCAL_TOKEN_KEY);
  } catch {}
}

/**
 * Performs one JSON API call with the local token attached and returns the parsed body.
 * The single choke point for every dashboard API call, so auth and error shape stay uniform.
 * @param path - Path starting with `/api/...`, relative to the API base (same-origin by default).
 * @param options - RequestInit; caller headers override the defaults (Content-Type, X-Agentix-Token).
 * @returns The parsed JSON body as T.
 * @throws Error with the server's `error` field (or `HTTP <status>`) on non-2xx; throws if the body is not JSON or fetch fails (backend down) — callers must handle it.
 * Maps to: REST — the Agentix API server route named by `path`.
 * Side effects: network I/O.
 */
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

/**
 * GETs a JSON resource and returns the parsed body.
 * @returns The parsed JSON body as T.
 * @throws Same as request(): server `error` on non-2xx, or a fetch/JSON error when the backend is down.
 * Maps to: REST GET `path` on the Agentix API server.
 * Side effects: network I/O.
 */
export async function fetchJSON<T>(path: string): Promise<T> {
  return request<T>(path);
}

/**
 * POSTs a JSON body and returns the parsed response.
 * @param body - JSON-serializable payload; always stringified, even when the caller passes a primitive.
 * @returns The parsed JSON body as T.
 * @throws Same as request(); note the caller must check `success` on routes that report failure in-band instead of via HTTP status.
 * Maps to: REST POST `path` on the Agentix API server.
 * Side effects: network I/O; usually a state-changing call — needs the local token.
 */
export async function postJSON<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/**
 * PUTs a JSON body and returns the parsed response.
 * @returns The parsed JSON body as T.
 * @throws Same as request().
 * Maps to: REST PUT `path` on the Agentix API server (config updates).
 * Side effects: network I/O; state-changing — needs the local token.
 */
export async function putJSON<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

/**
 * DELETEs with an optional JSON body and returns the parsed response.
 * @param body - Omitted for body-less deletes; sent stringified when provided.
 * @returns The parsed JSON body as T.
 * @throws Same as request().
 * Maps to: REST DELETE `path` on the Agentix API server (session/runtime removal).
 * Side effects: network I/O; destructive — needs the local token.
 */
export async function deleteJSON<T>(path: string, body?: any): Promise<T> {
  return request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined });
}

export const EXPLORER = "https://sepolia.basescan.org";

/**
 * Builds the BaseScan URL for a transaction hash.
 * @param hash - Transaction hash; interpolated verbatim, no validation.
 * @returns The full `https://sepolia.basescan.org/tx/<hash>` URL.
 * Maps to: external — sepolia.basescan.org (Base Sepolia only; wrong network if the dashboard ever points elsewhere).
 */
export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

/**
 * Builds the BaseScan URL for an address.
 * @param addr - Address; interpolated verbatim, no validation.
 * @returns The full `https://sepolia.basescan.org/address/<addr>` URL.
 * Maps to: external — sepolia.basescan.org (Base Sepolia only).
 */
export function explorerAddress(addr: string) {
  return `${EXPLORER}/address/${addr}`;
}

/**
 * Builds the BaseScan URL for a block number.
 * @param block - Block number (or numeric string).
 * @returns The full `https://sepolia.basescan.org/block/<block>` URL.
 * Maps to: external — sepolia.basescan.org (Base Sepolia only).
 */
export function explorerBlock(block: number | string) {
  return `${EXPLORER}/block/${block}`;
}

/**
 * Shortens an address/hash to its first `chars` characters, an ellipsis, and its last 4.
 * @param chars - Leading characters kept; defaults to 6.
 * @returns `"—"` for an empty input; the input unchanged when already short enough to fit.
 * Maps to: internal — every address/hash column in the dashboard sections.
 */
export function truncate(addr: string, chars = 6): string {
  if (!addr) return "—";
  return addr.length > chars + 4 ? `${addr.slice(0, chars)}...${addr.slice(-4)}` : addr;
}
