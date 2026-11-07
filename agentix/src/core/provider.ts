import { ethers } from "ethers";
import { loadConfig } from "./config";
import { logger } from "./logger";

const FALLBACK_FAILSAFE_MS = 30_000;

let _provider: ethers.JsonRpcProvider | null = null;
let _fallbackProvider: ethers.JsonRpcProvider | null = null;
let _signer: ethers.Wallet | null = null;
let _primaryFailedAt = 0;

/**
 * Build a fresh JsonRpcProvider for one RPC URL on the configured chain.
 * Low-level constructor: callers that need a throwaway probe provider use this; shared use goes through getProvider.
 * @param rpcUrl — the endpoint URL; an empty or unreachable URL still constructs (failures surface on first call).
 * @returns A new provider bound to config.chainId.
 * @throws Throws only if loadConfig fails.
 * Maps to: internal — getProvider / checkRpcConnection (provider construction).
 */
function _createProvider(rpcUrl: string): ethers.JsonRpcProvider {
  const config = loadConfig();
  return new ethers.JsonRpcProvider(rpcUrl, config.chainId);
}

/**
 * Pick the first fallback RPC URL (rotation list minus primary, else the legacy single fallback).
 * The failover target getProvider switches to for 30s after the primary fails.
 * @returns The fallback URL, or null when no fallback is configured.
 * @throws Never throws.
 * Maps to: internal — getProvider / markPrimaryFailed (failover selection).
 */
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

/**
 * List every fallback RPC URL (rotation list minus primary, plus the legacy fallback), deduplicated.
 * For exhaustive retries: checkRpcConnection walks this list until one endpoint answers.
 * @returns The fallback URLs in config order; [] when none are configured.
 * @throws Never throws.
 * Maps to: internal — checkRpcConnection (fallback rotation).
 */
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

/**
 * Return the shared RPC provider, switching to the fallback for 30s after a primary failure.
 * The single choke point for chain reads: every module shares this instance, so failover is process-wide.
 * @returns The primary provider, or the fallback provider while the primary is in its 30s failsafe window.
 * @throws Throws when no RPC URL is configured at all.
 * Maps to: internal — every contract read/write path (contract-calls, event-indexer, bundler, price-oracle).
 * Side effects: caches the provider (and fallback provider) in module memory.
 */
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

/**
 * Record that the primary RPC just failed, starting its 30s fallback window.
 * Call from any catch path that observed a primary failure; getProvider then serves the fallback until the window lapses.
 * @returns Nothing.
 * @throws Never throws.
 * Maps to: internal — callWithFallback / checkRpcConnection (failure signalling).
 * Side effects: sets the module-level failure timestamp; logs a warning.
 */
export function markPrimaryFailed(): void {
  _primaryFailedAt = Date.now();
  const fallbackUrl = _getFallbackUrl();
  if (fallbackUrl) {
    logger.warn("provider", `Primary RPC failed, using fallback (${fallbackUrl}) for ${FALLBACK_FAILSAFE_MS / 1000}s`);
  } else {
    logger.warn("provider", "Primary RPC failed, no fallback configured");
  }
}

/**
 * Clear the primary-failure flag so getProvider serves the primary again.
 * Called on the next primary success (or by a successful connection probe).
 * @returns Nothing.
 * @throws Never throws.
 * Maps to: internal — callWithFallback / checkRpcConnection (recovery signalling).
 */
export function resetPrimaryFailure(): void {
  _primaryFailedAt = 0;
}

/**
 * Run an RPC call against the primary, retrying once against the fallback on failure.
 * The two-attempt shape for single reads: a primary success also clears any recorded failure.
 * @param primary — the call against the shared provider; its failure is what triggers failover.
 * @param fallback — the same call rebuilt against a fallback provider; its failure propagates to the caller.
 * @returns The primary's result, or the fallback's when the primary threw.
 * @throws Throws the fallback's error when both attempts fail.
 * Maps to: internal — getBalance / getBlockTimestamp (single-read failover).
 * Side effects: marks the primary failed on a primary error (30s fallback window).
 */
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

/**
 * Return the process-wide signing wallet, creating it on first use.
 * The server-side signer for admin writes: never use it for user wallet operations (those go through the bundler).
 * @param privateKey — when given, always builds a fresh wallet from it instead of returning the cached signer.
 * @returns The cached wallet, or a new one bound to the shared provider.
 * @throws Throws when no private key is available (no argument and no AGENTIX_PRIVATE_KEY/PRIVATE_KEY env).
 * Maps to: internal — sendContractTransaction / bundler (server-side signing).
 * Security: the key comes from env or an explicit argument — never hardcode or log it.
 */
export function getSigner(privateKey?: string): ethers.Wallet {
  if (_signer && !privateKey) return _signer;
  const pk = privateKey || process.env.AGENTIX_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error("No private key available. Set AGENTIX_PRIVATE_KEY env or pass --key");
  const provider = getProvider();
  _signer = new ethers.Wallet(pk, provider);
  return _signer;
}

/**
 * Probe the primary RPC, then each fallback in turn, and report the first that answers.
 * Every provider created here is destroyed before returning: ethers providers hold the event loop open otherwise.
 * @returns { connected, chainId, blockNumber, rpcUrl } on success; { connected: false, error } when nothing answers.
 * @throws Never throws — all probe failures are collected into the returned error string.
 * Maps to: MCP tool agentix_rpc_test (and CLI init --rpc connectivity check).
 * Side effects: creates and destroys throwaway providers (network I/O); marks the primary failed when a fallback wins.
 */
export async function checkRpcConnection(): Promise<{ connected: boolean; chainId?: number; blockNumber?: number; error?: string; rpcUrl?: string }> {
  const config = loadConfig();
  const primaryUrl = config.rpcUrl;
  const fallbackUrl = _getFallbackUrl();

  // Every provider created here is single-use for this probe. An ethers
  // JsonRpcProvider keeps retrying network detection on a 1s loop ("retry
  // in 1s") for as long as it lives, which holds the Node event loop open
  // forever after the probe returns — `init --rpc` used to report
  // "Initialization Complete" and then never exit. Destroy every created
  // provider once the probe is done, on all paths.
  const created: any[] = [];
  /**
   * Destroy every probe provider created by this checkRpcConnection call.
   * Without this, a JsonRpcProvider keeps retrying network detection on a 1s loop and the process never exits.
   * @returns Nothing; destroy failures are swallowed per provider.
   * @throws Never throws.
   * Maps to: internal — checkRpcConnection (cleanup on all return paths).
   * Side effects: destroys the providers in the `created` list.
   */
  const destroyAll = () => {
    for (const p of created) {
      try { p.destroy(); } catch {}
    }
  };

  let result: { connected: boolean; chainId?: number; blockNumber?: number; error?: string; rpcUrl?: string } | undefined;

  // Try primary
  if (primaryUrl) {
    try {
      const provider = _createProvider(primaryUrl);
      created.push(provider);
      const [chainId, blockNumber] = await Promise.all([
        provider.getNetwork().then((n) => Number(n.chainId)),
        provider.getBlockNumber(),
      ]);
      resetPrimaryFailure();
      result = { connected: true, chainId, blockNumber, rpcUrl: primaryUrl };
    } catch (err: any) {
      logger.warn("provider", `Primary RPC failed: ${err.message}`);
    }
  }

  // Try each fallback in the rotation list until one responds.
  if (!result) {
    const fallbackUrls = _getFallbackUrls();
    if (fallbackUrl && !fallbackUrls.includes(fallbackUrl)) fallbackUrls.push(fallbackUrl);
    let lastErr = "";
    for (const url of fallbackUrls) {
      try {
        const fallback = _createProvider(url);
        created.push(fallback);
        const [chainId, blockNumber] = await Promise.all([
          fallback.getNetwork().then((n) => Number(n.chainId)),
          fallback.getBlockNumber(),
        ]);
        markPrimaryFailed();
        result = { connected: true, chainId, blockNumber, rpcUrl: url };
        break;
      } catch (err: any) {
        lastErr = err.message;
        logger.warn("provider", `Fallback RPC failed (${url}): ${err.message}`);
      }
    }
    if (!result) {
      result = fallbackUrls.length
        ? { connected: false, error: `Primary failed; all ${fallbackUrls.length} fallback(s) failed: ${lastErr}` }
        : { connected: false, error: "No RPC URL configured" };
    }
  }

  destroyAll();
  return result;
}

/**
 * Return an address's ETH balance as a decimal string, with fallback retry.
 * Reads via the shared provider first; a primary failure retries once against the fallback RPC.
 * @param address — any hex address; an invalid address throws from the provider call.
 * @returns The balance in ETH (ethers.formatEther), e.g. "1.5".
 * @throws Throws when both primary and fallback reads fail, or no fallback is configured.
 * Maps to: MCP tool agentix_wallet_balance (ETH balance of a wallet).
 */
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

/**
 * Return the latest block's timestamp (unix seconds), with fallback retry.
 * When the chain cannot be read at all it falls back to the local clock — callers must not treat that as chain truth.
 * @returns The latest block timestamp, or Math.floor(Date.now()/1000) when the block has no timestamp.
 * @throws Throws when both primary and fallback reads fail, or no fallback is configured.
 * Maps to: internal — event-indexer (block timestamp fallback for stored events).
 */
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

/**
 * Drop all cached providers and the signer, and clear the primary-failure flag.
 * Test and reconfiguration hook: the next getProvider/getSigner call rebuilds everything from current config.
 * @returns Nothing.
 * @throws Never throws.
 * Maps to: internal — tests (and any config-reload path).
 * Side effects: clears module-level provider/signer caches (does not destroy the old providers).
 */
export function resetProviders(): void {
  _provider = null;
  _fallbackProvider = null;
  _signer = null;
  _primaryFailedAt = 0;
}


