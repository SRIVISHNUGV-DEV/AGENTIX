import { describe, it, expect } from "vitest";

describe("21. Chaos Engineering Tests", () => {
  describe("Database Corruption Recovery", () => {
    it("database integrity check passes", async () => {
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();
      const integrity = db.pragma("integrity_check", { simple: true });
      expect(integrity).toBe("ok");
    });

    it("WAL mode recovers after checkpoint", async () => {
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();
      db.pragma("wal_checkpoint(TRUNCATE)");
      const mode = db.pragma("journal_mode", { simple: true });
      expect(mode).toBe("wal");
    });
  });

  describe("Event Bus Resilience", () => {
    it("handles rapid emit without crash", async () => {
      const { EventBus } = await import("../packages/core/eventbus");
      const bus = new EventBus();

      for (let i = 0; i < 100; i++) {
        await bus.emit({ type: "ActionExecuted", data: { agent: `a${i}`, tool: "test", intent: "test", sessionId: "s1", walletAddress: "0x0", riskLevel: "LOW", txHash: "", success: true, timestamp: Date.now() } });
      }

      expect(bus.getHistory().length).toBe(100);
    });

    it("handler errors don't crash bus", async () => {
      const { EventBus } = await import("../packages/core/eventbus");
      const bus = new EventBus();
      bus.on("CredentialIssued", () => { throw new Error("Chaos"); });

      await expect(
        bus.emit({ type: "CredentialIssued", data: { credentialId: "c1", organizationId: "o1", agentId: "a1", timestamp: Date.now() } })
      ).resolves.not.toThrow();
    });
  });

  describe("Invalid Data Handling", () => {
    it("services handle null/undefined gracefully", async () => {
      const { getWalletService } = await import("../packages/services/wallet-service");
      const svc = getWalletService();

      expect(svc.get(null as any)).toBeUndefined();
      expect(svc.get(undefined as any)).toBeUndefined();
      expect(svc.get("")).toBeUndefined();
    });

    it("services handle malformed addresses", async () => {
      const { getWalletService } = await import("../packages/services/wallet-service");
      const svc = getWalletService();
      expect(svc.get("not-an-address")).toBeUndefined();
      expect(svc.listByOwner("invalid")).toEqual([]);
    });
  });

  describe("Concurrent Operations", () => {
    it("handles concurrent database writes", async () => {
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();
      db.exec("CREATE TABLE IF NOT EXISTS chaos_concurrent (id TEXT PRIMARY KEY, value TEXT)");

      const promises = Array.from({ length: 20 }, (_, i) =>
        new Promise<void>((resolve) => {
          try {
            db.prepare("INSERT OR REPLACE INTO chaos_concurrent (id, value) VALUES (?, ?)").run(`row-${i}`, `val-${i}`);
          } catch {}
          resolve();
        })
      );

      await Promise.all(promises);
      const count = db.prepare("SELECT COUNT(*) as c FROM chaos_concurrent").get() as any;
      expect(count.c).toBe(20);
      db.exec("DROP TABLE chaos_concurrent");
    });
  });

  describe("Memory Pressure", () => {
    it("large history doesn't leak memory", async () => {
      const { EventBus } = await import("../packages/core/eventbus");
      const bus = new EventBus();

      for (let i = 0; i < 1100; i++) {
        await bus.emit({ type: "ActionExecuted", data: { agent: `a${i}`, tool: "test", intent: "test", sessionId: "s1", walletAddress: "0x0", riskLevel: "LOW", txHash: "", success: true, timestamp: Date.now() } });
      }

      expect(bus.getHistory().length).toBeLessThanOrEqual(1000);
    });
  });
});
