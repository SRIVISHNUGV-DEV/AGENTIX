import { ethers } from "ethers";
import { getProvider } from "./provider";
import { logger } from "./logger";

const CHAINLINK_ETH_USD_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const CHAINLINK_ETH_USD_FEED: Record<number, string> = {
  1: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  11155111: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  8453: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
};

let _cachedPrice: number | null = null;
let _cacheTimestamp: number = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Fetch the ETH/USD price from CoinGecko's public API (last-resort source).
 * Called only after Chainlink and Binance fail; a null here means every source is down.
 * @returns The price in USD, or null on any HTTP, parse, or timeout failure (10s abort).
 * @throws Never throws — all failures log a warning and return null.
 * Maps to: internal — getEthUsdPrice (third fallback).
 * Side effects: one HTTPS request to api.coingecko.com (network I/O).
 */
async function fetchPriceFromCoinGecko(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    const price = data?.ethereum?.usd;
    if (typeof price === "number" && price > 0) {
      logger.info("price-oracle", `CoinGecko ETH/USD = $${price.toFixed(2)}`);
      return price;
    }
    return null;
  } catch (e: any) {
    logger.warn("price-oracle", `CoinGecko fetch failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch the ETH/USD price from Binance's public ticker (second source).
 * Called when Chainlink has no feed or fails for this chain; no API key needed.
 * @returns The ETHUSDT price in USD, or null on any HTTP, parse, or timeout failure (8s abort).
 * @throws Never throws — all failures log a warning and return null.
 * Maps to: internal — getEthUsdPrice (second fallback).
 * Side effects: one HTTPS request to api.binance.com (network I/O).
 */
async function fetchPriceFromBinance(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    const price = parseFloat(data?.price);
    if (!isNaN(price) && price > 0) {
      logger.info("price-oracle", `Binance ETH/USD = $${price.toFixed(2)}`);
      return price;
    }
    return null;
  } catch (e: any) {
    logger.warn("price-oracle", `Binance fetch failed: ${e.message}`);
    return null;
  }
}

/**
 * Read the ETH/USD price from the on-chain Chainlink feed for this chain.
 * Preferred source: trust-minimised (on-chain) and chain-native, when a feed exists.
 * @param chainId — the chain to price on; returns null immediately when no feed is mapped for it.
 * @returns The price in USD (answer scaled by feed decimals), or null when the feed is unknown or the read fails.
 * @throws Never throws — RPC failures log a warning and return null.
 * Maps to: internal — getEthUsdPrice (first source).
 * Side effects: two on-chain read calls (latestRoundData, decimals) via the shared provider.
 */
async function fetchPriceFromChainlink(chainId: number): Promise<number | null> {
  const feedAddress = CHAINLINK_ETH_USD_FEED[chainId];
  if (!feedAddress) return null;

  try {
    const provider = getProvider();
    const feed = new ethers.Contract(ethers.getAddress(feedAddress), CHAINLINK_ETH_USD_ABI, provider);
    const [, answer] = await feed.latestRoundData();
    const decimals = await feed.decimals();
    const price = Number(answer) / Math.pow(10, Number(decimals));
    if (price > 0) {
      logger.info("price-oracle", `Chainlink ETH/USD = $${price.toFixed(2)} (chain ${chainId})`);
      return price;
    }
    return null;
  } catch (e: any) {
    logger.warn("price-oracle", `Chainlink fetch failed (chain ${chainId}): ${e.message}`);
    return null;
  }
}

/**
 * Return the current ETH/USD price, trying Chainlink, then Binance, then CoinGecko.
 * Results are cached 30s; when every source fails it returns the stale cache, and only 0 when there is none.
 * @returns USD per ETH; 0 means no price is available at all — callers must treat 0 as "unknown", not free.
 * @throws Never throws — all source failures degrade to stale cache or 0.
 * Maps to: MCP tool agentix_cred_oracle (ETH price in the credential oracle state).
 * Side effects: caches the price in module memory for 30s; network/RPC I/O on a cache miss.
 */
export async function getEthUsdPrice(): Promise<number> {
  if (_cachedPrice && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedPrice;
  }

  let price: number | null = null;

  try {
    const provider = getProvider();
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    price = await fetchPriceFromChainlink(chainId);
  } catch {}

  if (!price) {
    price = await fetchPriceFromBinance();
  }
  if (!price) {
    price = await fetchPriceFromCoinGecko();
  }

  if (price && price > 0) {
    _cachedPrice = price;
    _cacheTimestamp = Date.now();
    return price;
  }

  if (_cachedPrice) {
    logger.warn("price-oracle", "All sources failed, returning stale cache");
    return _cachedPrice;
  }

  logger.warn("price-oracle", "All sources failed, no cache available");
  return 0;
}

/**
 * Convert an ETH amount to a USD string at a given price.
 * Pure formatting helper for display; never use its output for on-chain amounts.
 * @param ethAmount — ETH as a number or decimal string; unparseable input returns "0.00".
 * @param ethPrice — USD per ETH; a stale or 0 price yields a meaningless result — validate it first.
 * @returns USD with exactly 2 decimals ("0.00" on bad input).
 * @throws Never throws.
 * Maps to: internal — getEthUsdPrice consumers (dashboard / oracle display).
 */
export function ethToUsd(ethAmount: string | number, ethPrice: number): string {
  const eth = typeof ethAmount === "string" ? parseFloat(ethAmount) : ethAmount;
  if (isNaN(eth)) return "0.00";
  return (eth * ethPrice).toFixed(2);
}

/**
 * Convert a USD amount to an ETH string at a given price.
 * Pure formatting helper for display; never use its output for on-chain amounts.
 * @param usdAmount — USD as a number or decimal string; unparseable input returns "0".
 * @param ethPrice — USD per ETH; must be > 0, otherwise returns "0" (avoids divide-by-zero).
 * @returns ETH with exactly 6 decimals ("0" on bad input or non-positive price).
 * @throws Never throws.
 * Maps to: internal — getEthUsdPrice consumers (dashboard / oracle display).
 */
export function usdToEth(usdAmount: string | number, ethPrice: number): string {
  const usd = typeof usdAmount === "string" ? parseFloat(usdAmount) : usdAmount;
  if (isNaN(usd) || ethPrice <= 0) return "0";
  return (usd / ethPrice).toFixed(6);
}
