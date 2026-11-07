export interface FiatOnRampOption {
  provider: string;
  logo: string;
  estimatedPrice: string;
  fees: string;
  estimatedETH: string;
  estimatedArrival: string;
  officialLink: string;
  supportedCountries: string[];
  currencies: string[];
}

export interface FundRequest {
  network: string;
  amount: string;
  currency?: string;
  country?: string;
}

export interface FundResult {
  network: string;
  requestedAmount: string;
  currency: string;
  options: FiatOnRampOption[];
  disclaimer: string;
}

const PROVIDERS: FiatOnRampOption[] = [
  {
    provider: "MoonPay",
    logo: "moonpay",
    estimatedPrice: "",
    fees: "2.5% + network fee",
    estimatedETH: "",
    estimatedArrival: "2-10 minutes",
    officialLink: "https://www.moonpay.com",
    supportedCountries: ["US", "EU", "UK", "CA", "AU", "SG", "JP", "BR", "MX"],
    currencies: ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "BRL", "MXN"],
  },
  {
    provider: "Coinbase",
    logo: "coinbase",
    estimatedPrice: "",
    fees: "1.99% + spread",
    estimatedETH: "",
    estimatedArrival: "Instant - 5 minutes",
    officialLink: "https://www.coinbase.com",
    supportedCountries: ["US", "EU", "UK", "CA", "AU", "SG"],
    currencies: ["USD", "EUR", "GBP", "CAD", "AUD", "SGD"],
  },
  {
    provider: "Transak",
    logo: "transak",
    estimatedPrice: "",
    fees: "1.5% - 5.5%",
    estimatedETH: "",
    estimatedArrival: "1-10 minutes",
    officialLink: "https://transak.com",
    supportedCountries: ["US", "EU", "UK", "CA", "AU", "IN", "BR", "NG", "PH"],
    currencies: ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "BRL", "NGN", "PHP"],
  },
  {
    provider: "Ramp",
    logo: "ramp",
    estimatedPrice: "",
    fees: "0.99% - 2.9%",
    estimatedETH: "",
    estimatedArrival: "Instant - 5 minutes",
    officialLink: "https://ramp.network",
    supportedCountries: ["US", "EU", "UK", "CA", "AU", "SG", "JP"],
    currencies: ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY"],
  },
];

const NETWORK_NAMES: Record<string, string> = {
  base: "Base",
  baseSepolia: "Base Sepolia",
  ethereum: "Ethereum",
  ethereumSepolia: "Ethereum Sepolia",
  polygon: "Polygon",
};

/**
 * Ranked fiat on-ramp options for buying ETH on a network.
 * Pure estimate — fee rates and the default $2500 ETH price are hardcoded, no live
 * quotes are fetched, so the numbers are for comparison only and the disclaimer
 * says to verify on the provider's site before buying. AgentIX never executes a purchase.
 * @param request.network - Key such as "baseSepolia" (unknown keys pass through as-is); @param request.amount - Fiat amount as a decimal string; @param request.currency - Defaults to "USD"; @param request.country - When given, providers not supporting it are dropped.
 * @param ethPrice - Optional live ETH price; defaults to 2500 when omitted.
 * @returns FundResult with options sorted cheapest-fee-first (empty when no provider supports the currency/country) plus a verify-before-buying disclaimer.
 * @throws Never throws for well-formed input; a non-numeric amount yields NaN-derived estimates.
 * Maps to: MCP tool agentix_fund / CLI 'agentix fund'.
 * Side effects: none — pure computation over a hardcoded provider list.
 */
export function getFundOptions(request: FundRequest, ethPrice?: number): FundResult {
  const { network, amount, currency = "USD", country } = request;
  const networkName = NETWORK_NAMES[network] || network;

  const amountNum = parseFloat(amount);
  const price = ethPrice || 2500;
  const options: FiatOnRampOption[] = [];

  for (const provider of PROVIDERS) {
    if (country && !provider.supportedCountries.includes(country)) continue;
    if (!provider.currencies.includes(currency)) continue;

    let feeRate = 0.025;
    if (provider.provider === "Coinbase") feeRate = 0.0199;
    else if (provider.provider === "Transak") feeRate = 0.035;
    else if (provider.provider === "Ramp") feeRate = 0.0199;

    const fee = amountNum * feeRate;
    const netAmount = amountNum - fee;
    const ethReceived = (netAmount / price).toFixed(6);

    let networkFee = "0.0001 ETH";
    if (network.includes("Sepolia")) networkFee = "Free (testnet)";

    options.push({
      ...provider,
      estimatedPrice: `$${amountNum.toFixed(2)}`,
      fees: `$${fee.toFixed(2)} (${(feeRate * 100).toFixed(1)}%) + ${networkFee}`,
      estimatedETH: `${ethReceived} ETH`,
      estimatedArrival: provider.estimatedArrival,
      officialLink: `${provider.officialLink}/buy/ETH?network=${network.toLowerCase()}&amount=${amount}&currency=${currency}`,
    });
  }

  options.sort((a, b) => {
    const matchA = a.fees.match(/\$(\d+\.?\d*)/);
    const matchB = b.fees.match(/\$(\d+\.?\d*)/);
    const feeA = matchA ? parseFloat(matchA[1]) : 0;
    const feeB = matchB ? parseFloat(matchB[1]) : 0;
    return feeA - feeB;
  });

  return {
    network: networkName,
    requestedAmount: `$${amount}`,
    currency,
    options,
    disclaimer: "These are recommendations only. Always verify prices and fees on the provider's official website before purchasing. Never share your private keys or seed phrase.",
  };
}

/**
 * Static metadata for a known network: display name, testnet flag, faucet URL when one exists.
 * @param network - Key such as "baseSepolia"; unknown keys return {name: network, testnet: false}.
 * @returns {name, testnet, faucetUrl?} — faucetUrl only for the two Sepolia testnets.
 * @throws Never throws.
 * Maps to: internal — getFundOptions (network display) and funding UI.
 * Side effects: none — pure lookup.
 */
export function getNetworkInfo(network: string): { name: string; testnet: boolean; faucetUrl?: string } {
  const networks: Record<string, { name: string; testnet: boolean; faucetUrl?: string }> = {
    base: { name: "Base", testnet: false },
    baseSepolia: { name: "Base Sepolia", testnet: true, faucetUrl: "https://www.alchemy.com/faucets/base-sepolia" },
    ethereum: { name: "Ethereum", testnet: false },
    ethereumSepolia: { name: "Ethereum Sepolia", testnet: true, faucetUrl: "https://sepoliafaucet.com" },
    polygon: { name: "Polygon", testnet: false },
  };
  return networks[network] || { name: network, testnet: false };
}
