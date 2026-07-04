import { describe, it, expect, beforeAll } from "vitest";

describe("11. Session Tests", () => {
  let SessionService: any;

  beforeAll(async () => {
    const mod = await import("../packages/services/session-service");
    SessionService = mod.getSessionService();
  });

  it("lists sessions by wallet", () => {
    const sessions = SessionService.listByWallet("0x0000000000000000000000000000000000000000");
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("count is numeric", () => {
    const count = SessionService.count();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("get returns undefined for non-existent", () => {
    const session = SessionService.get("nonexistent-session");
    expect(session).toBeUndefined();
  });

  it("validate returns false for non-existent session", () => {
    const result = SessionService.validate("nonexistent", "0x0000000000000000000000000000000000000000");
    expect(result.valid).toBe(false);
  });
});
