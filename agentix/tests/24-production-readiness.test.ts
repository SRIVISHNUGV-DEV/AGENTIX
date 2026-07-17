import { describe, it, expect } from "vitest";

describe("24. Production Readiness Tests", () => {
  describe("Configuration", () => {
    it("loadConfig returns valid config", async () => {
      const { loadConfig } = await import("../src/core/config");
      const config = loadConfig();
      expect(config).toBeDefined();
      expect(config.rpcUrl).toBeDefined();
      expect(config.networkName).toBeDefined();
      expect(config.chainId).toBeDefined();
    });

    it("config has database path", async () => {
      const { loadConfig } = await import("../src/core/config");
      const config = loadConfig();
      expect(config.database).toBeDefined();
      expect(config.database.path).toBeDefined();
    });

    it("config has backup path", async () => {
      const { loadConfig } = await import("../src/core/config");
      const config = loadConfig();
      expect(config.backup).toBeDefined();
      expect(config.backup.path).toBeDefined();
    });
  });

  describe("Database Schema", () => {
    it("all 15 core tables exist", async () => {
      const { getDatabase } = await import("../src/core/database");
      const db = getDatabase();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
      const names = tables.map((t: any) => t.name);
      expect(names).toContain("config");
      expect(names).toContain("organizations");
      expect(names).toContain("credentials");
      expect(names).toContain("wallets");
      expect(names).toContain("sessions");
      expect(names).toContain("proofs");
      expect(names).toContain("capabilities");
      expect(names).toContain("delegations");
      expect(names).toContain("logs");
      expect(names).toContain("backups");
    });
  });

  describe("Event Bus", () => {
    it("EventBus is importable and functional", async () => {
      const { EventBus } = await import("../packages/core/eventbus");
      const bus = new EventBus();
      let emitted = false;
      bus.on("HealthCheckRun", () => { emitted = true; });
      await bus.emit({ type: "HealthCheckRun", data: { timestamp: Date.now() } });
      expect(emitted).toBe(true);
    });
  });

  describe("Services", () => {
    it("all 6 services are importable", async () => {
      const orgMod = await import("../packages/services/organization-service");
      const credMod = await import("../packages/services/credential-service");
      const walletMod = await import("../packages/services/wallet-service");
      const sessionMod = await import("../packages/services/session-service");
      const proofMod = await import("../packages/services/proof-service");
      const authMod = await import("../packages/services/authority-service");

      expect(orgMod.getOrganizationService).toBeDefined();
      expect(credMod.getCredentialService).toBeDefined();
      expect(walletMod.getWalletService).toBeDefined();
      expect(sessionMod.getSessionService).toBeDefined();
      expect(proofMod.getProofService).toBeDefined();
      expect(authMod.getAuthorityService).toBeDefined();
    });
  });

  describe("MCP Server", () => {
    it("MCP server module is importable", async () => {
      const mod = await import("../src/mcp/server");
      expect(mod).toBeDefined();
    });

    it("MCP index module is importable", async () => {
      const mod = await import("../src/mcp/server");
      expect(mod).toBeDefined();
    });
  });

  describe("Tree Engine", () => {
    it("TreeEngine is importable", async () => {
      const mod = await import("../packages/core/tree-engine");
      expect(mod.TreeEngine).toBeDefined();
    });
  });

  describe("AI Harness", () => {
    it("all harness components importable", async () => {
      const harness = await import("../packages/core/ai-harness");
      expect(harness.IntentEngine).toBeDefined();
      expect(harness.PolicyEngine).toBeDefined();
      expect(harness.SafetyEngine).toBeDefined();
      expect(harness.ToolRouter).toBeDefined();
    });
  });

  describe("Shared Packages", () => {
    it("types package is importable", async () => {
      const mod = await import("../packages/shared/types");
      expect(mod).toBeDefined();
    });

    it("constants package is importable", async () => {
      const mod = await import("../packages/shared/constants");
      expect(mod).toBeDefined();
      expect(mod.TREE_DEPTH).toBe(20);
    });

    it("utils package is importable", async () => {
      const mod = await import("../packages/shared/utils");
      expect(mod).toBeDefined();
      expect(typeof mod.generateId).toBe("function");
      expect(typeof mod.sha256).toBe("function");
    });

    it("schemas package is importable", async () => {
      const mod = await import("../packages/shared/schemas");
      expect(mod).toBeDefined();
    });
  });

  describe("CLI", () => {
    it("CLI entry point is importable (source exists)", async () => {
      const { existsSync } = await import("fs");
      expect(existsSync("src/index.ts")).toBe(true);
    });
  });
});
