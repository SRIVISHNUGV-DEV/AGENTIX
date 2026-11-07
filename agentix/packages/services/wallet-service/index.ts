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
   * Inserts a wallet row directly in the local DB (deprecated shim — no factory contract call).
   * WHY: backwards-compatible local-only creation; new callers must use src/tools/wallet.ts createWallet(), which deploys via the factory with ProxyGuard validation.
   * @deprecated Use src/tools/wallet.ts createWallet() instead.
   * @param walletAddress Deployed wallet address; stored verbatim, no format check.
   * @param ownerAddress Owner address; stored verbatim.
   * @param organizationId Owning org id, or undefined (stored as NULL).
   * @param agentId Agent id, or undefined (stored as NULL); 0 is treated as absent.
   * @param entryPoint ERC-4337 EntryPoint address, or undefined (stored as NULL).
   * @returns The created wallet row, re-read from the DB.
   * @throws Throws on DB errors (e.g. a duplicate wallet address if a uniqueness constraint exists).
   * Maps to: internal — src/tools/wallet.ts createWallet (canonical implementation); event WalletCreated.
   * Side effects: inserts a row into wallets and emits WalletCreated. No on-chain deployment happens here — the address must already exist.
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

  /**
   * Fetches one wallet by address.
   * WHY: the read path for every flow that needs a wallet's owner, org, or entry point before acting on its behalf.
   * @returns The wallet, or undefined when no row matches.
   * @throws Throws on DB errors.
   * Maps to: internal — src/tools/wallet.ts createWallet (rows it creates); WalletService.listByOwner (single-row form).
   * Side effects: none (read-only).
   */
  get(walletAddress: string): Wallet | undefined {
    return runSingleCamel<Wallet>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress);
  }

  /**
   * Lists all wallets, newest first.
   * WHY: the operator's wallet inventory across all owners and orgs.
   * @returns All wallets ordered by created_at descending; empty array when none exist. No limit — large deployments return everything.
   * @throws Throws on DB errors.
   * Maps to: internal — WalletService.listByOwner (unfiltered form).
   * Side effects: none (read-only).
   */
  list(): Wallet[] {
    return runQueryCamel<Wallet>("SELECT * FROM wallets ORDER BY created_at DESC");
  }

  /**
   * Lists one owner's wallets, newest first.
   * WHY: the per-owner wallet inventory — what an owner controls and which orgs/agents each wallet belongs to.
   * @returns The owner's wallets ordered by created_at descending; empty array when the owner has none.
   * @throws Throws on DB errors.
   * Maps to: internal — WalletService.list (owner-scoped form).
   * Side effects: none (read-only).
   */
  listByOwner(ownerAddress: string): Wallet[] {
    return runQueryCamel<Wallet>("SELECT * FROM wallets WHERE owner_address = ? ORDER BY created_at DESC", ownerAddress);
  }

  /**
   * Counts all wallets.
   * WHY: the cheap cardinality check for dashboards and health checks.
   * @returns The row count, 0 when none.
   * @throws Throws on DB errors.
   * Maps to: internal — WalletService.list (count form).
   * Side effects: none (read-only).
   */
  count(): number {
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM wallets");
    return r?.count || 0;
  }
}

let _svc: WalletService | null = null;
/**
 * Returns the process-wide singleton WalletService.
 * WHY: one service per process — all wallet reads share the same event-bus subscription surface.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — WalletService (module-level accessor).
 * Side effects: creates the singleton on first call.
 */
export function getWalletService(): WalletService {
  if (!_svc) _svc = new WalletService();
  return _svc;
}
