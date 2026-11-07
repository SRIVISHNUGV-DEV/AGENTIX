import { checkRpcConnection, getProvider, getBalance, resetProviders } from "../core/provider";
import { loadConfig, saveConfig } from "../core/config";
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

/**
 * Test (and optionally switch to) an RPC endpoint.
 * When a URL is given it is persisted to config AND the cached provider
 * singleton is reset, so the next getProvider() actually uses the new URL —
 * without the reset the --url flag would silently have no effect.
 * @param rpcUrl - Optional endpoint to switch to and persist; omit to test the currently configured one.
 * @returns RpcResult with connected, chainId, blockNumber and the effective rpcUrl; success:false + error when unreachable.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_rpc_test / CLI 'agentix rpc test'.
 * Side effects: persists config + resets the provider singleton when rpcUrl is given; one RPC call either way.
 */
export async function testRpcConnection(rpcUrl?: string): Promise<RpcResult> {
  try {
    if (rpcUrl) {
      const config = loadConfig();
      config.rpcUrl = rpcUrl;
      saveConfig(config);
      // CRITICAL: reset the cached provider singleton so the next getProvider()
      // call creates a new JsonRpcProvider with the updated URL. Without this,
      // the --url flag has no effect (provider stays cached from a prior call).
      resetProviders();
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

/**
 * Current RPC status: connected or not, on which chain, at which block.
 * Read-only status — unlike testRpcConnection it never persists anything or
 * resets the provider.
 * @returns RpcResult with connected, chainId, blockNumber and the configured rpcUrl; success:false only on an unexpected failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: internal — status/health displays (agentix_health).
 * Side effects: one RPC call.
 */
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

/**
 * Native ETH balance of an address on the configured chain.
 * @param address - Address to query; an invalid address makes getBalance throw, surfaced as success:false.
 * @returns RpcResult with balance as an ETH decimal string; success:false + error on failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: internal — balance reads behind wallet/fund flows.
 * Side effects: one RPC call.
 */
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
