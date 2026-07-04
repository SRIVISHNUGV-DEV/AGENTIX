import { describe, it, expect, beforeAll } from "vitest";

describe("13. Organization Flow Tests", () => {
  let AuthorityService: any, OrganizationService: any;

  beforeAll(async () => {
    const authMod = await import("../packages/services/authority-service");
    const orgMod = await import("../packages/services/organization-service");
    AuthorityService = authMod.getAuthorityService();
    OrganizationService = orgMod.getOrganizationService();
  });

  it("submit organization request", async () => {
    const addr = `0x${Buffer.from(Math.random().toString(36)).toString("hex").padStart(40, "0").slice(0, 40)}`;
    const result = await AuthorityService.submitRequest("Release Test Org", addr, "");
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("lists pending requests", () => {
    const requests = AuthorityService.listPending();
    expect(Array.isArray(requests)).toBe(true);
  });

  it("get a specific request", () => {
    const pending = AuthorityService.listPending();
    if (pending.length > 0) {
      const req = AuthorityService.getRequest(pending[0].id);
      expect(req).toBeDefined();
    }
  });

  it("organization list is accessible", () => {
    const orgs = OrganizationService.list();
    expect(Array.isArray(orgs)).toBe(true);
  });

  it("organization count is numeric", () => {
    const count = OrganizationService.count();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
