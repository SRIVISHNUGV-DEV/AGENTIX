import { checkRpcConnection, getProvider, getBalance } from "../core/provider";
import { loadConfig } from "../core/config";
import { logger } from "../core/logger";

export interface RpcResult {
  success: boolean;
  connected?: boolean;
  chainId?: number;
  blockNumber?: number;
  rpcUrl?: string;
  balance?: string;
  error?: string;
}

export async function testRpcConnection(rpcUrl?: string): Promise<RpcResult> {
  try {
    if (rpcUrl) {
      const config = loadConfig();
      config.rpcUrl = rpcUrl;
    }

    const result = await checkRpcConnection();

    if (result.connected) {
      const config = loadConfig();
      return {
        success: true,
        connected: true,
        chainId: result.chainId,
        blockNumber: result.blockNumber,
        rpcUrl: config.rpcUrl,
      };
    }

    return {
      success: false,
      connected: false,
      error: result.error,
      rpcUrl: rpcUrl || loadConfig().rpcUrl,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getRpcStatus(): Promise<RpcResult> {
  try {
    const config = loadConfig();
    const result = await checkRpcConnection();

    return {
      success: true,
      connected: result.connected,
      chainId: result.chainId,
      blockNumber: result.blockNumber,
      rpcUrl: config.rpcUrl,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getNativeBalance(address: string): Promise<RpcResult> {
  try {
    const balance = await getBalance(address);
    return {
      success: true,
      balance,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
