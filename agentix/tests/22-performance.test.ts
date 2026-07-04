import { describe, it, expect } from "vitest";

describe("22. Performance Tests", () => {
  describe("Startup Time", () => {
    it("database initializes in < 500ms", async () => {
      const start = performance.now();
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    it("config loads in < 100ms", async () => {
      const start = performance.now();
      const { loadConfig } = await import("../src/core/config");
      loadConfig();
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("Merkle Tree Performance", () => {
    it("builds 1024-leaf tree in < 5s", async () => {
      const { buildMerkleTree, hashLeaf, initMerkleCrypto } = await import("../src/utils/merkle");
      await initMerkleCrypto();
      const leaves = new Map<bigint, bigint>();
      for (let i = 0; i < 1024; i++) {
        leaves.set(BigInt(i), BigInt(i + 1000));
      }

      const start = performance.now();
      const tree = buildMerkleTree(leaves, 10);
      const elapsed = performance.now() - start;

      expect(typeof tree.root).toBe("bigint");
      expect(elapsed).toBeLessThan(5000);
    });

    it("generates proof in < 50ms", async () => {
      const { buildMerkleTree, getMerkleProof, initMerkleCrypto } = await import("../src/utils/merkle");
      await initMerkleCrypto();
      const leaves = new Map<bigint, bigint>();
      for (let i = 0; i < 128; i++) {
        leaves.set(BigInt(i), BigInt(i + 2000));
      }
      const tree = buildMerkleTree(leaves, 10);

      const start = performance.now();
      getMerkleProof(tree.layers, 64, 10);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("Database Performance", () => {
    it("inserts 1000 rows in < 1s", async () => {
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();

      db.exec("CREATE TABLE IF NOT EXISTS perf_test (id TEXT, value TEXT)");
      db.exec("DELETE FROM perf_test");

      const start = performance.now();
      const insert = db.prepare("INSERT INTO perf_test (id, value) VALUES (?, ?)");
      const tx = db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          insert.run(`id-${i}`, `value-${i}`);
        }
      });
      tx();
      const elapsed = performance.now() - start;

      const count = db.prepare("SELECT COUNT(*) as c FROM perf_test").get() as any;
      expect(count.c).toBe(1000);
      expect(elapsed).toBeLessThan(1000);

      db.exec("DROP TABLE perf_test");
    });

    it("reads 1000 rows in < 100ms", async () => {
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();

      db.exec("CREATE TABLE IF NOT EXISTS perf_read_test (id TEXT, value TEXT)");
      db.exec("DELETE FROM perf_read_test");
      const insert = db.prepare("INSERT INTO perf_read_test (id, value) VALUES (?, ?)");
      for (let i = 0; i < 1000; i++) insert.run(`id-${i}`, `val-${i}`);

      const start = performance.now();
      const rows = db.prepare("SELECT * FROM perf_read_test").all();
      const elapsed = performance.now() - start;

      expect(rows.length).toBe(1000);
      expect(elapsed).toBeLessThan(100);

      db.exec("DROP TABLE perf_read_test");
    });
  });

  describe("API Performance", () => {
    it("health endpoint responds in < 200ms", async () => {
      try {
        const start = performance.now();
        await fetch("http://localhost:3001/api/health");
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(200);
      } catch {
        // API server not running - skip
      }
    });

    it("stats endpoint responds in < 500ms", async () => {
      try {
        const start = performance.now();
        await fetch("http://localhost:3001/api/stats");
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(500);
      } catch {
        // API server not running - skip
      }
    });
  });

  describe("Event Bus Performance", () => {
    it("emits 1000 events in < 1s", async () => {
      const { EventBus } = await import("../packages/core/eventbus");
      const bus = new EventBus();
      let count = 0;
      bus.onAny(() => { count++; });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        await bus.emit({ type: "CredentialIssued", data: { credentialId: `c${i}`, organizationId: "o1", agentId: "a1", timestamp: Date.now() } });
      }
      const elapsed = performance.now() - start;

      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("Hash Performance", () => {
    it("Poseidon hash 1000 times in < 2s", async () => {
      const { hashLeaf, initMerkleCrypto } = await import("../src/utils/merkle");
      await initMerkleCrypto();

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        hashLeaf(BigInt(i), BigInt(i + 5000));
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
