import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { Wallet } from "../../shared/types";

/**
 * WalletService — Thin read-only wrapper around the database.
 *
 * WRITE operations (create) are delegated to src/tools/wallet.ts
 * which is the CANONICAL implementation. It handles:
 * - ProxyGuard validation
 * - Factory contract interaction
 * - Event persistence
 *
 * This service only provides read operations for the MCP server and tests.
 *
 * @deprecated This service will be removed in V2. Use src/tools/wallet.ts directly.
 */
export class WalletService {
  private bus = getEventBus();

  /**
   * @deprecated Use src/tools/wallet.ts createWallet() instead.
   */
  create(walletAddress: string, ownerAddress: string, organizationId?: string, agentId?: number, entryPoint?: string): Wallet {
    const now = Math.floor(Date.now() / 1000);
    runExecute(
      "INSERT INTO wallets (wallet_address, owner_address, organization_id, agent_id, entry_point, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      walletAddress, ownerAddress, organizationId || null, agentId || null, entryPoint || null, now
    );
    const wallet = runSingleCamel<Wallet>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress)!;
    this.bus.emit({ type: "WalletCreated", data: { walletAddress, ownerAddress } });
    return wallet;
  }

  get(walletAddress: string): Wallet | undefined {
    return runSingleCamel<Wallet>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress);
  }

  list(): Wallet[] {
    return runQueryCamel<Wallet>("SELECT * FROM wallets ORDER BY created_at DESC");
  }

  listByOwner(ownerAddress: string): Wallet[] {
    return runQueryCamel<Wallet>("SELECT * FROM wallets WHERE owner_address = ? ORDER BY created_at DESC", ownerAddress);
  }

  count(): number {
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM wallets");
    return r?.count || 0;
  }
}

let _svc: WalletService | null = null;
export function getWalletService(): WalletService {
  if (!_svc) _svc = new WalletService();
  return _svc;
}
