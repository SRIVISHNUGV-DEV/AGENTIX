import { ethers } from "ethers";
import { loadConfig } from "./config";
import { logger } from "./logger";

const FALLBACK_FAILSAFE_MS = 30_000;

let _provider: ethers.JsonRpcProvider | null = null;
let _fallbackProvider: ethers.JsonRpcProvider | null = null;
let _signer: ethers.Wallet | null = null;
let _primaryFailedAt = 0;

function _createProvider(rpcUrl: string): ethers.JsonRpcProvider {
  const config = loadConfig();
  return new ethers.JsonRpcProvider(rpcUrl, config.chainId);
}

function _getFallbackUrl(): string | null {
  const config = loadConfig();
  // Prefer the first entry of the rotation list that isn't the primary; fall
  // back to the single rpcFallbackUrl for older configs.
  const list = config.rpcFallbackUrls;
  if (Array.isArray(list) && list.length) {
    const alt = list.find((u) => u && u !== config.rpcUrl);
    if (alt) return alt;
  }
  return config.rpcFallbackUrl || null;
}

/** All fallback URLs (rotation list minus primary), for exhaustive retries. */
function _getFallbackUrls(): string[] {
  const config = loadConfig();
  const out: string[] = [];
  if (Array.isArray(config.rpcFallbackUrls)) {
    for (const u of config.rpcFallbackUrls) {
      if (u && u !== config.rpcUrl && !out.includes(u)) out.push(u);
    }
  }
  if (config.rpcFallbackUrl && !out.includes(config.rpcFallbackUrl) && config.rpcFallbackUrl !== config.rpcUrl) {
    out.push(config.rpcFallbackUrl);
  }
  return out;
}

export function getProvider(): ethers.JsonRpcProvider {
  const config = loadConfig();

  // If primary failed recently (<30s), use fallback if available
  if (_primaryFailedAt && Date.now() - _primaryFailedAt < FALLBACK_FAILSAFE_MS) {
    const fallbackUrl = _getFallbackUrl();
    if (fallbackUrl) {
      if (!_fallbackProvider) {
        _fallbackProvider = _createProvider(fallbackUrl);
      }
      return _fallbackProvider;
    }
  }

  if (_provider) return _provider;
  const url = config.rpcUrl;
  if (!url) throw new Error("No RPC URL configured. Run: agentix config set rpcUrl <url>");
  _provider = _createProvider(url);
  return _provider;
}

export function markPrimaryFailed(): void {
  _primaryFailedAt = Date.now();
  const fallbackUrl = _getFallbackUrl();
  if (fallbackUrl) {
    logger.warn("provider", `Primary RPC failed, using fallback (${fallbackUrl}) for ${FALLBACK_FAILSAFE_MS / 1000}s`);
  } else {
    logger.warn("provider", "Primary RPC failed, no fallback configured");
  }
}

export function resetPrimaryFailure(): void {
  _primaryFailedAt = 0;
}

export async function callWithFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  try {
    const result = await primary();
    if (_primaryFailedAt) resetPrimaryFailure();
    return result;
  } catch (err: any) {
    markPrimaryFailed();
    const msg = err?.message || String(err);
    logger.warn("provider", `Primary RPC failed (${msg}), trying fallback...`);
    return await fallback();
  }
}

export function getSigner(privateKey?: string): ethers.Wallet {
  if (_signer && !privateKey) return _signer;
  const pk = privateKey || process.env.AGENTIX_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error("No private key available. Set AGENTIX_PRIVATE_KEY env or pass --key");
  const provider = getProvider();
  _signer = new ethers.Wallet(pk, provider);
  return _signer;
}

export async function checkRpcConnection(): Promise<{ connected: boolean; chainId?: number; blockNumber?: number; error?: string; rpcUrl?: string }> {
  const config = loadConfig();
  const primaryUrl = config.rpcUrl;
  const fallbackUrl = _getFallbackUrl();

  // Try primary
  if (primaryUrl) {
    try {
      const provider = _createProvider(primaryUrl);
      const [chainId, blockNumber] = await Promise.all([
        provider.getNetwork().then((n) => Number(n.chainId)),
        provider.getBlockNumber(),
      ]);
      resetPrimaryFailure();
      return { connected: true, chainId, blockNumber, rpcUrl: primaryUrl };
    } catch (err: any) {
      logger.warn("provider", `Primary RPC failed: ${err.message}`);
    }
  }

  // Try each fallback in the rotation list until one responds.
  const fallbackUrls = _getFallbackUrls();
  if (fallbackUrl && !fallbackUrls.includes(fallbackUrl)) fallbackUrls.push(fallbackUrl);
  let lastErr = "";
  for (const url of fallbackUrls) {
    try {
      const fallback = _createProvider(url);
      const [chainId, blockNumber] = await Promise.all([
        fallback.getNetwork().then((n) => Number(n.chainId)),
        fallback.getBlockNumber(),
      ]);
      markPrimaryFailed();
      return { connected: true, chainId, blockNumber, rpcUrl: url };
    } catch (err: any) {
      lastErr = err.message;
      logger.warn("provider", `Fallback RPC failed (${url}): ${err.message}`);
    }
  }

  if (fallbackUrls.length) {
    return { connected: false, error: `Primary failed; all ${fallbackUrls.length} fallback(s) failed: ${lastErr}` };
  }
  return { connected: false, error: "No RPC URL configured" };
}

export async function getBalance(address: string): Promise<string> {
  const provider = getProvider();
  return callWithFallback(
    async () => ethers.formatEther(await provider.getBalance(address)),
    async () => {
      const fallbackUrl = _getFallbackUrl();
      if (!fallbackUrl) throw new Error("No fallback RPC configured");
      return ethers.formatEther(await _createProvider(fallbackUrl).getBalance(address));
    }
  );
}

export async function getBlockTimestamp(): Promise<number> {
  const provider = getProvider();
  return callWithFallback(
    async () => (await provider.getBlock("latest"))?.timestamp || Math.floor(Date.now() / 1000),
    async () => {
      const fallbackUrl = _getFallbackUrl();
      if (!fallbackUrl) throw new Error("No fallback RPC configured");
      return (await _createProvider(fallbackUrl).getBlock("latest"))?.timestamp || Math.floor(Date.now() / 1000);
    }
  );
}

export function resetProviders(): void {
  _provider = null;
  _fallbackProvider = null;
  _signer = null;
  _primaryFailedAt = 0;
}


