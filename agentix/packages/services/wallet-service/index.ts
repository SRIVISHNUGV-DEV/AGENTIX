import { runExecute, runSingle, runQuery } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { Wallet } from "../../shared/types";

export class WalletService {
  private bus = getEventBus();

  create(walletAddress: string, ownerAddress: string, organizationId?: string, agentId?: number, entryPoint?: string): Wallet {
    const now = Math.floor(Date.now() / 1000);
    runExecute(
      "INSERT INTO wallets (wallet_address, owner_address, organization_id, agent_id, entry_point, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      walletAddress, ownerAddress, organizationId || null, agentId || null, entryPoint || null, now
    );
    const wallet = runSingle<Wallet>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress)!;
    this.bus.emit({ type: "WalletCreated", data: { walletAddress, ownerAddress } });
    return wallet;
  }

  get(walletAddress: string): Wallet | undefined {
    return runSingle<Wallet>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress);
  }

  list(): Wallet[] {
    return runQuery<Wallet>("SELECT * FROM wallets ORDER BY created_at DESC");
  }

  listByOwner(ownerAddress: string): Wallet[] {
    return runQuery<Wallet>("SELECT * FROM wallets WHERE owner_address = ? ORDER BY created_at DESC", ownerAddress);
  }

  count(): number {
    const r = runSingle<{ count: number }>("SELECT COUNT(*) as count FROM wallets");
    return r?.count || 0;
  }
}

let _svc: WalletService | null = null;
export function getWalletService(): WalletService {
  if (!_svc) _svc = new WalletService();
  return _svc;
}
