import { describe, it, expect, beforeAll } from "vitest";

describe("10. Wallet Tests", () => {
  let WalletService: any;

  beforeAll(async () => {
    const mod = await import("../packages/services/wallet-service");
    WalletService = mod.getWalletService();
  });

  it("lists all wallets", () => {
    const wallets = WalletService.list();
    expect(Array.isArray(wallets)).toBe(true);
  });

  it("count is numeric", () => {
    const count = WalletService.count();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("get returns undefined for non-existent", () => {
    const wallet = WalletService.get("nonexistent-address");
    expect(wallet).toBeUndefined();
  });

  it("listByOwner returns array", () => {
    const wallets = WalletService.listByOwner("0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC");
    expect(Array.isArray(wallets)).toBe(true);
  });

  it("wallet data has required fields", () => {
    const wallets = WalletService.list();
    for (const w of wallets) {
      expect(w).toHaveProperty("wallet_address");
      expect(w).toHaveProperty("owner_address");
    }
  });
});
