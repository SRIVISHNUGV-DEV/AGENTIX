import { describe, it, expect, beforeAll } from "vitest";

describe("15. AI Harness Tests", () => {
  let HarnessManager: any;
  let harnessMod: any;

  beforeAll(async () => {
    harnessMod = await import("../packages/core/harness-adapter");
    HarnessManager = harnessMod.getHarnessManager();
  });

  it("returns singleton instance", () => {
    const m1 = HarnessManager;
    const m2 = harnessMod.getHarnessManager();
    expect(m1).toBe(m2);
  });

  it("scanAll returns results for all adapters", async () => {
    const result = await HarnessManager.scanAll();
    expect(result).toBeDefined();
    expect(result.harnesses).toBeDefined();
    expect(Array.isArray(result.harnesses)).toBe(true);
    expect(result.harnesses.length).toBe(5);
    expect(typeof result.totalDetected).toBe("number");
    expect(typeof result.totalConnected).toBe("number");
  });

  it("healthCheckAll returns results", async () => {
    const result = await HarnessManager.healthCheckAll();
    expect(result).toBeDefined();
  });

  it("getAdapters returns 5 adapters", () => {
    const adapters = HarnessManager.getAdapters();
    expect(adapters.length).toBe(5);
  });

  it("getAdapter returns correct adapter", () => {
    const adapter = HarnessManager.getAdapter("claude-code");
    expect(adapter).toBeDefined();
  });

  it("getAdapter returns undefined for unknown", () => {
    const adapter = HarnessManager.getAdapter("nonexistent");
    expect(adapter).toBeUndefined();
  });

  it("all adapter IDs are present", () => {
    const adapters = HarnessManager.getAdapters();
    const ids = adapters.map((a: any) => a.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("mimocode");
    expect(ids).toContain("opencode");
    expect(ids).toContain("github-copilot");
    expect(ids).toContain("hermes");
  });
});
