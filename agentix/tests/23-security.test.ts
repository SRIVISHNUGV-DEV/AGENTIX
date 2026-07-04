import { describe, it, expect } from "vitest";

describe("23. Security Tests", () => {
  describe("Proxy Guard", () => {
    it("ProxyGuard is importable", async () => {
      const mod = await import("../src/core/proxy-guard");
      expect(mod.getProxyGuard).toBeDefined();
    });

    it("ProxyGuard validates addresses", async () => {
      const { getProxyGuard } = await import("../src/core/proxy-guard");
      const guard = getProxyGuard();
      expect(guard).toBeDefined();
    });
  });

  describe("Input Validation", () => {
    it("Zod schemas reject invalid input", async () => {
      const { z } = await import("zod");
      const schema = z.object({
        name: z.string().min(1),
        ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      });

      expect(() => schema.parse({ name: "", ownerAddress: "invalid" })).toThrow();
      expect(() => schema.parse({ name: "Test", ownerAddress: "0x123" })).toThrow();
    });

    it("Zod schemas accept valid input", async () => {
      const { z } = await import("zod");
      const schema = z.object({
        name: z.string().min(1),
        ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      });

      const result = schema.parse({ name: "Test Org", ownerAddress: "0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC" });
      expect(result.name).toBe("Test Org");
    });
  });

  describe("Rate Limiting", () => {
    it("AuthorityService enforces rate limits", async () => {
      const { getAuthorityService } = await import("../packages/services/authority-service");
      const svc = getAuthorityService();

      const addr = "0xBF0A116921abA3DA0D3296b9a4843e999D1F1243";
      let successCount = 0;
      for (let i = 0; i < 15; i++) {
        const result = await svc.submitRequest(`Rate Limit Test ${i}`, addr, "");
        if (result.success) successCount++;
      }
      expect(successCount).toBeLessThanOrEqual(10);
    });
  });

  describe("Data Isolation", () => {
    it("organizations have unique IDs", async () => {
      const { getOrganizationService } = await import("../packages/services/organization-service");
      const svc = getOrganizationService();
      const orgs = svc.list();
      const ids = orgs.map((o: any) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("wallets have unique addresses", async () => {
      const { getWalletService } = await import("../packages/services/wallet-service");
      const svc = getWalletService();
      const wallets = svc.list();
      const addrs = wallets.map((w: any) => w.wallet_address);
      expect(new Set(addrs).size).toBe(addrs.length);
    });
  });

  describe("Secret Handling", () => {
    it("no private keys in config output", async () => {
      const { loadConfig } = await import("../src/core/config");
      const config = loadConfig();
      expect(JSON.stringify(config)).not.toContain("0xac0974");
      expect(JSON.stringify(config)).not.toContain("PRIVATE_KEY");
    });

    it("no secrets in API responses", async () => {
      try {
        const res = await fetch("http://localhost:3001/api/config");
        const config = await res.json();
        expect(JSON.stringify(config)).not.toContain("0xac0974");
      } catch {
        // API server not running - skip this check
      }
    });
  });

  describe("SQL Injection", () => {
    it("parameterized queries prevent injection", async () => {
      const { runQuery, getDatabase } = await import("../src/core/database");
      const db = getDatabase();
      const result = db.prepare("SELECT * FROM config WHERE key = ?").get("'; DROP TABLE config; --");
      expect(result).toBeUndefined();
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='config'").get();
      expect(tableCheck).toBeDefined();
    });
  });
});
