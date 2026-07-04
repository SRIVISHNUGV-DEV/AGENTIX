import { describe, it, expect, beforeAll } from "vitest";

describe("12. Credential Tests", () => {
  let CredentialService: any;

  beforeAll(async () => {
    const mod = await import("../packages/services/credential-service");
    CredentialService = mod.getCredentialService();
  });

  it("lists all credentials", () => {
    const creds = CredentialService.list();
    expect(Array.isArray(creds)).toBe(true);
  });

  it("count is numeric", () => {
    const count = CredentialService.count();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("list with valid org filter returns array", () => {
    const creds = CredentialService.list("test-org-id");
    expect(Array.isArray(creds)).toBe(true);
  });

  it("getById returns null for non-existent", () => {
    const cred = CredentialService.getById("nonexistent-id");
    expect(cred).toBeUndefined();
  });

  it("credential history is accessible", () => {
    const history = CredentialService.getHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});
