/**
 * RPC provider registry for Base Sepolia (chain 84532).
 *
 * The runtime NEVER hard-requires a key: it always has a set of public, no-key
 * endpoints to fall back to. A user may optionally plug in an API key from one
 * of the well-known providers below for higher rate limits and reliability.
 *
 * Endpoint URL formats were taken from each provider's official Base Sepolia
 * documentation (see `docs` on each entry). `{KEY}` is substituted with the
 * user's API key; QuickNode additionally needs a per-user subdomain, so it
 * takes the whole endpoint URL rather than just a key.
 */

export interface RpcProvider {
  id: string;
  name: string;
  /** How the user supplies credentials. */
  kind: "key" | "url";
  /**
   * URL template with `{KEY}` placeholder (for kind="key"). Unused for
   * kind="url" providers, where the user pastes the full endpoint.
   */
  urlTemplate?: string;
  /** Short hint shown in the wizard prompt. */
  hint: string;
  /** Where to get a key. */
  signupUrl: string;
  /** Docs page the endpoint format came from. */
  docs: string;
  /** Free tier available without payment. */
  freeTier: boolean;
}

/**
 * Public, no-key Base Sepolia RPC endpoints used as the default and as
 * automatic fallbacks. Ordered by observed reliability. The official Base
 * endpoint is first; the rest provide redundancy if it rate-limits.
 */
export const PUBLIC_RPC_ENDPOINTS: { name: string; url: string }[] = [
  { name: "Base (official)", url: "https://sepolia.base.org" },
  { name: "PublicNode", url: "https://base-sepolia-rpc.publicnode.com" },
  { name: "dRPC", url: "https://base-sepolia.drpc.org" },
  { name: "Ankr (public)", url: "https://rpc.ankr.com/base_sepolia" },
];

/** The default RPC used when the user provides no key. */
export const DEFAULT_PUBLIC_RPC = PUBLIC_RPC_ENDPOINTS[0].url;

/** All public URLs as a plain list (for config `rpcFallbackUrls`). */
export const PUBLIC_RPC_URLS = PUBLIC_RPC_ENDPOINTS.map((e) => e.url);

/**
 * Well-known providers a user can plug in during setup. Formats verified
 * against each provider's Base Sepolia documentation.
 */
export const RPC_PROVIDERS: RpcProvider[] = [
  {
    id: "alchemy",
    name: "Alchemy",
    kind: "key",
    urlTemplate: "https://base-sepolia.g.alchemy.com/v2/{KEY}",
    hint: "Paste your Alchemy API key (the token after /v2/)",
    signupUrl: "https://dashboard.alchemy.com/",
    docs: "https://docs.alchemy.com/reference/base-api-quickstart",
    freeTier: true,
  },
  {
    id: "infura",
    name: "Infura",
    kind: "key",
    urlTemplate: "https://base-sepolia.infura.io/v3/{KEY}",
    hint: "Paste your Infura API key (the project ID after /v3/)",
    signupUrl: "https://app.infura.io/",
    docs: "https://docs.metamask.io/services/reference/base/",
    freeTier: true,
  },
  {
    id: "ankr",
    name: "Ankr",
    kind: "key",
    urlTemplate: "https://rpc.ankr.com/base_sepolia/{KEY}",
    hint: "Paste your Ankr API key (leave blank to use Ankr's public endpoint)",
    signupUrl: "https://www.ankr.com/rpc/",
    docs: "https://www.ankr.com/docs/rpc-service/chains/chains-list/",
    freeTier: true,
  },
  {
    id: "quicknode",
    name: "QuickNode",
    kind: "url",
    hint: "Paste your full QuickNode Base Sepolia HTTPS endpoint URL",
    signupUrl: "https://www.quicknode.com/",
    docs: "https://www.quicknode.com/docs/base",
    freeTier: true,
  },
];

export function getProvider(id: string): RpcProvider | undefined {
  return RPC_PROVIDERS.find((p) => p.id === id);
}

/**
 * Build a concrete RPC URL from a provider id + user-supplied secret.
 * For key-based providers this fills the `{KEY}` template; for url-based
 * providers (QuickNode) the secret IS the full endpoint URL.
 * Returns null if the input is empty (caller should fall back to public).
 */
export function buildRpcUrl(providerId: string, secret: string): string | null {
  const trimmed = (secret || "").trim();
  const provider = getProvider(providerId);
  if (!provider) return null;

  if (provider.kind === "url") {
    return isValidHttpsUrl(trimmed) ? trimmed : null;
  }

  // key-based
  if (!trimmed) {
    // Ankr works without a key via its public endpoint.
    if (provider.id === "ankr") return "https://rpc.ankr.com/base_sepolia";
    return null;
  }
  return provider.urlTemplate!.replace("{KEY}", encodeURIComponent(trimmed));
}

export function isValidHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Probe an RPC endpoint with an eth_chainId call. Resolves to the numeric
 * chain id on success, or null on any failure/timeout. Uses global fetch
 * (Node 18+). Never throws.
 */
export async function probeRpc(url: string, timeoutMs = 5000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (typeof json?.result === "string") {
      return parseInt(json.result, 16);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Given a preferred URL (may be null), return the first endpoint that responds
 * with the expected chain id. Tries the preferred URL first, then each public
 * fallback. Returns the working URL, or the official public endpoint if every
 * probe fails (so the runtime is never left without an RPC configured).
 */
export async function resolveWorkingRpc(
  preferred: string | null,
  expectedChainId = 84532,
  timeoutMs = 5000,
): Promise<{ url: string; verified: boolean; source: string }> {
  const candidates: { url: string; source: string }[] = [];
  if (preferred) candidates.push({ url: preferred, source: "provided" });
  for (const e of PUBLIC_RPC_ENDPOINTS) candidates.push({ url: e.url, source: e.name });

  for (const c of candidates) {
    const chainId = await probeRpc(c.url, timeoutMs);
    if (chainId === expectedChainId) {
      return { url: c.url, verified: true, source: c.source };
    }
  }
  // Nothing responded — still return the official public endpoint so config is valid.
  return { url: DEFAULT_PUBLIC_RPC, verified: false, source: "Base (official, unverified)" };
}
