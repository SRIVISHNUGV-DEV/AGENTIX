import { describe, it, expect } from "vitest";

describe("17. Diagnostics Tests", () => {
  describe("System Diagnostics", () => {
    it("runFullDiagnostics returns all sections", async () => {
      const { runFullDiagnostics } = await import("../src/tools/wizard");
      const result = await runFullDiagnostics();
      expect(result).toBeDefined();
      expect(result.sections).toBeDefined();
      expect(result.sections.length).toBeGreaterThanOrEqual(8);
    });

    it("Node.js check passes", async () => {
      const { runFullDiagnostics } = await import("../src/tools/wizard");
      const result = await runFullDiagnostics();
      const nodeCheck = result.sections.find((s: any) => s.name.includes("Node"));
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck.status).toBe("OK");
    });

    it("SQLite check passes", async () => {
      const { runFullDiagnostics } = await import("../src/tools/wizard");
      const result = await runFullDiagnostics();
      const sqliteCheck = result.sections.find((s: any) => s.name.includes("SQLite"));
      expect(sqliteCheck).toBeDefined();
      expect(sqliteCheck.status).toBe("OK");
    }, 60000);

    it("has overall status", async () => {
      const { runFullDiagnostics } = await import("../src/tools/wizard");
      const result = await runFullDiagnostics();
      expect(result.overall).toBeDefined();
      expect(["OK", "WARNING", "ERROR"]).toContain(result.overall);
    });
  });

  describe("Diagnostics Tool", () => {
    it("runDiagnostics returns sections", async () => {
      const { runDiagnostics } = await import("../src/tools/diagnostics");
      const result = await runDiagnostics();
      expect(result).toBeDefined();
      expect(result.sections).toBeDefined();
      expect(Array.isArray(result.sections)).toBe(true);
    });
  });

  describe("Health Check", () => {
    it("health check returns result", async () => {
      const { runHealthCheck } = await import("../src/tools/health");
      const result = await runHealthCheck();
      expect(result).toBeDefined();
      expect(result.checks).toBeDefined();
    });
  });

  describe("Config Tool", () => {
    it("getConfig returns config", async () => {
      const { getConfig } = await import("../src/tools/config-tool");
      const result = getConfig();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });
});
