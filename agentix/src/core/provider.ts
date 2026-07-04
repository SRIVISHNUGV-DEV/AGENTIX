import { ethers } from "ethers";
import { loadConfig } from "./config";
import { logger } from "./logger";

let _provider: ethers.JsonRpcProvider | null = null;
let _signer: ethers.Wallet | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (_provider) return _provider;
  const config = loadConfig();
  if (!config.rpcUrl) throw new Error("RPC URL not configured. Run: agentix config set rpcUrl <url>");
  _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  return _provider;
}

export function getSigner(privateKey?: string): ethers.Wallet {
  if (_signer && !privateKey) return _signer;
  const pk = privateKey || process.env.AGENTIX_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error("No private key available. Set AGENTIX_PRIVATE_KEY env or pass --key");
  const provider = getProvider();
  _signer = new ethers.Wallet(pk, provider);
  return _signer;
}

export async function checkRpcConnection(): Promise<{ connected: boolean; chainId?: number; blockNumber?: number; error?: string }> {
  try {
    const provider = getProvider();
    const [chainId, blockNumber] = await Promise.all([
      provider.getNetwork().then((n) => Number(n.chainId)),
      provider.getBlockNumber(),
    ]);
    return { connected: true, chainId, blockNumber };
  } catch (e: any) {
    return { connected: false, error: e.message };
  }
}

export async function getBalance(address: string): Promise<string> {
  const provider = getProvider();
  const bal = await provider.getBalance(address);
  return ethers.formatEther(bal);
}

export async function getBlockTimestamp(): Promise<number> {
  const provider = getProvider();
  const block = await provider.getBlock("latest");
  return block?.timestamp || Math.floor(Date.now() / 1000);
}
