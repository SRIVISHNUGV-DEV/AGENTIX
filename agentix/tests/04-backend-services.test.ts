import { describe, it, expect, beforeAll } from "vitest";

describe("4. Backend / Service Tests", () => {
  let OrganizationService: any, CredentialService: any, WalletService: any;
  let SessionService: any, ProofService: any, AuthorityService: any;

  beforeAll(async () => {
    const orgMod = await import("../packages/services/organization-service");
    const credMod = await import("../packages/services/credential-service");
    const walletMod = await import("../packages/services/wallet-service");
    const sessionMod = await import("../packages/services/session-service");
    const proofMod = await import("../packages/services/proof-service");
    const authMod = await import("../packages/services/authority-service");

    OrganizationService = orgMod.getOrganizationService();
    CredentialService = credMod.getCredentialService();
    WalletService = walletMod.getWalletService();
    SessionService = sessionMod.getSessionService();
    ProofService = proofMod.getProofService();
    AuthorityService = authMod.getAuthorityService();
  });

  describe("OrganizationService", () => {
    it("lists organizations", () => {
      const orgs = OrganizationService.list();
      expect(Array.isArray(orgs)).toBe(true);
    });

    it("counts organizations", () => {
      const count = OrganizationService.count();
      expect(typeof count).toBe("number");
    });

    it("counts active organizations", () => {
      const count = OrganizationService.activeCount();
      expect(typeof count).toBe("number");
      expect(count).toBeLessThanOrEqual(OrganizationService.count());
    });
  });

  describe("CredentialService", () => {
    it("lists credentials", () => {
      const creds = CredentialService.list();
      expect(Array.isArray(creds)).toBe(true);
    });

    it("counts credentials", () => {
      const count = CredentialService.count();
      expect(typeof count).toBe("number");
    });

    it("lists with org filter", () => {
      const creds = CredentialService.list("nonexistent-org");
      expect(Array.isArray(creds)).toBe(true);
      expect(creds.length).toBe(0);
    });
  });

  describe("WalletService", () => {
    it("lists wallets", () => {
      const wallets = WalletService.list();
      expect(Array.isArray(wallets)).toBe(true);
    });

    it("counts wallets", () => {
      const count = WalletService.count();
      expect(typeof count).toBe("number");
    });

    it("lists by owner returns array", () => {
      const wallets = WalletService.listByOwner("0x0000000000000000000000000000000000000000");
      expect(Array.isArray(wallets)).toBe(true);
    });
  });

  describe("SessionService", () => {
    it("lists sessions by wallet", () => {
      const sessions = SessionService.listByWallet("0x0000000000000000000000000000000000000000");
      expect(Array.isArray(sessions)).toBe(true);
    });

    it("counts sessions", () => {
      const count = SessionService.count();
      expect(typeof count).toBe("number");
    });
  });

  describe("ProofService", () => {
    it("lists proofs", () => {
      const proofs = ProofService.list();
      expect(Array.isArray(proofs)).toBe(true);
    });

    it("counts proofs", () => {
      const count = ProofService.count();
      expect(typeof count).toBe("number");
    });

    it("verify non-existent proof returns false", () => {
      const result = ProofService.verify("nonexistent-hash");
      expect(result.valid).toBe(false);
    });
  });

  describe("AuthorityService", () => {
    it("lists pending requests", () => {
      const requests = AuthorityService.listPending();
      expect(Array.isArray(requests)).toBe(true);
    });

    it("submits an organization request", async () => {
      const addr = `0x${Date.now().toString(16).padStart(40, "0")}`;
      const result = await AuthorityService.submitRequest("Test Authority Org", addr, "");
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it("rejects duplicate submissions within rate limit window", async () => {
      const addr = `0x${(Date.now() + 1).toString(16).padStart(40, "0")}`;
      const result1 = await AuthorityService.submitRequest("Org A", addr, "");
      const result2 = await AuthorityService.submitRequest("Org B", addr, "");
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
    });
  });
});
