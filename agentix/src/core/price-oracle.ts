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

export function ethToUsd(ethAmount: string | number, ethPrice: number): string {
  const eth = typeof ethAmount === "string" ? parseFloat(ethAmount) : ethAmount;
  if (isNaN(eth)) return "0.00";
  return (eth * ethPrice).toFixed(2);
}

export function usdToEth(usdAmount: string | number, ethPrice: number): string {
  const usd = typeof usdAmount === "string" ? parseFloat(usdAmount) : usdAmount;
  if (isNaN(usd) || ethPrice <= 0) return "0";
  return (usd / ethPrice).toFixed(6);
}
