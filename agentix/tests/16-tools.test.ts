import { describe, it, expect, beforeAll } from "vitest";

describe("16. Tool Tests", () => {
  describe("fund.ts", () => {
    it("getFundOptions returns options", async () => {
      const { getFundOptions } = await import("../src/tools/fund");
      const result = getFundOptions({ network: "baseSepolia", amount: "10", currency: "USD", country: "US" });
      expect(result).toBeDefined();
      expect(result.options).toBeDefined();
      expect(Array.isArray(result.options)).toBe(true);
      expect(result.options.length).toBeGreaterThan(0);
    });

    it("all options have official links", async () => {
      const { getFundOptions } = await import("../src/tools/fund");
      const result = getFundOptions({ network: "baseSepolia", amount: "10" });
      for (const opt of result.options) {
        expect(opt.officialLink).toBeDefined();
        expect(opt.officialLink).toMatch(/^https:\/\/(www\.)?(moonpay\.com|coinbase\.com|transak\.com|ramp\.network)/);
      }
    });

    it("options have fees", async () => {
      const { getFundOptions } = await import("../src/tools/fund");
      const result = getFundOptions({ network: "baseSepolia", amount: "100" });
      for (const opt of result.options) {
        expect(opt.fees).toBeDefined();
        expect(typeof opt.fees).toBe("string");
      }
    });

    it("getNetworkInfo returns correct info", async () => {
      const { getNetworkInfo } = await import("../src/tools/fund");
      const info = getNetworkInfo("baseSepolia");
      expect(info.name).toBe("Base Sepolia");
      expect(info.testnet).toBe(true);
    });

    it("includes disclaimer", async () => {
      const { getFundOptions } = await import("../src/tools/fund");
      const result = getFundOptions({ network: "baseSepolia", amount: "10" });
      expect(result.disclaimer).toBeDefined();
      expect(result.disclaimer.length).toBeGreaterThan(0);
    });
  });

  describe("health.ts", () => {
    it("health check returns result", async () => {
      const { runHealthCheck } = await import("../src/tools/health");
      const result = await runHealthCheck();
      expect(result).toBeDefined();
      expect(result.checks).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
    });
  });

  describe("diagnostics.ts", () => {
    it("diagnostics returns sections", async () => {
      const { runDiagnostics } = await import("../src/tools/diagnostics");
      const result = await runDiagnostics();
      expect(result).toBeDefined();
      expect(result.sections).toBeDefined();
      expect(Array.isArray(result.sections)).toBe(true);
    });
  });

  describe("wizard.ts", () => {
    it("runFullDiagnostics returns sections", async () => {
      const { runFullDiagnostics } = await import("../src/tools/wizard");
      const result = await runFullDiagnostics();
      expect(result).toBeDefined();
      expect(result.sections).toBeDefined();
      expect(Array.isArray(result.sections)).toBe(true);
      expect(result.sections.length).toBeGreaterThanOrEqual(8);
    });

    it("each section has name and status", async () => {
      const { runFullDiagnostics } = await import("../src/tools/wizard");
      const result = await runFullDiagnostics();
      for (const section of result.sections) {
        expect(section).toHaveProperty("name");
        expect(section).toHaveProperty("status");
        expect(["OK", "WARNING", "ERROR", "INFO"]).toContain(section.status);
      }
    });
  });

  describe("config-tool.ts", () => {
    it("getConfig returns config result", async () => {
      const { getConfig } = await import("../src/tools/config-tool");
      const result = getConfig();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe("All tools are importable", () => {
    const toolFiles = [
      "backup", "capability", "config-tool", "credential", "delegation",
      "deployment", "diagnostics", "fund", "health", "help",
      "organization", "proof", "quick", "rpc-tool", "session",
      "tree", "wallet", "wizard",
    ];

    for (const tool of toolFiles) {
      it(`src/tools/${tool}.ts imports successfully`, async () => {
        const mod = await import(`../src/tools/${tool}`);
        expect(mod).toBeDefined();
      });
    }
  });
});
