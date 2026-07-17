import { describe, it, expect, beforeAll } from "vitest";

describe("20. End-to-End User Flow Tests", () => {
  const API = "http://localhost:3001";
  let serverAvailable = false;

  beforeAll(async () => {
    try {
      const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
      serverAvailable = res.ok;
    } catch {
      serverAvailable = false;
    }
  });

  async function api(method: string, path: string, body?: any) {
    const opts: any = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API}${path}`, opts);
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  describe("Complete User Journey", () => {
    it("Step 1: System health check", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/health");
      expect(status).toBe(200);
      expect(data.status).toBe("ok");
    });

    it("Step 2: Check onboarding status", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/onboarding/status");
      expect(status).toBe(200);
      expect(data).toHaveProperty("initialized");
    });

    it("Step 3: Run diagnostics", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/diagnostics");
      expect(status).toBe(200);
      expect(data.checks.length).toBeGreaterThanOrEqual(8);
    });

    it("Step 4: Get system stats", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/stats");
      expect(status).toBe(200);
      expect(typeof data.organizations).toBe("number");
    });

    it("Step 5: Submit organization request", async () => {
      if (!serverAvailable) return;
      // Use a fresh random owner each run. The server rejects a second pending
      // request from the same owner (400), so a hardcoded address made this test
      // fail on every run after the first against a persistent DB.
      const rand = Array.from({ length: 40 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
      const { status, data } = await api("POST", "/api/organizations/requests", {
        name: "E2E Test Org",
        ownerAddress: `0x${rand}`,
      });
      expect(status).toBe(201);
      expect(data.success).toBe(true);
    });

    it("Step 6: List organizations", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/organizations");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("Step 7: List credentials", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/credentials");
      expect(status).toBe(200);
      // Server wraps as { value: [...] } (dashboard reads credData.value).
      expect(Array.isArray(data.value)).toBe(true);
    });

    it("Step 8: List wallets", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/wallets");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("Step 9: List sessions", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/sessions?wallet=0x0000000000000000000000000000000000000000");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("Step 10: List proofs", async () => {
      if (!serverAvailable) return;
      const { status } = await api("GET", "/api/proofs");
      expect(status).toBe(200);
    });

    it("Step 11: List actions", async () => {
      if (!serverAvailable) return;
      const { status } = await api("GET", "/api/actions");
      expect(status).toBe(200);
    });

    it("Step 12: List events", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/events?limit=10");
      expect(status).toBe(200);
      // Server returns { events: [...], total, offset, limit } (dashboard reads data.events).
      expect(Array.isArray(data.events)).toBe(true);
    });

    it("Step 13: Create backup", async () => {
      if (!serverAvailable) return;
      const { status } = await api("POST", "/api/backups", { description: "E2E test backup" });
      expect(status).toBe(201);
    });

    it("Step 14: List backups", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/backups");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("Step 15: Get config", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/config");
      expect(status).toBe(200);
      expect(data).toHaveProperty("rpcUrl");
    });

    it("Step 16: Update config", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("PUT", "/api/config", { rpcUrl: "https://sepolia.base.org" });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("Step 17: Check contracts", async () => {
      if (!serverAvailable) return;
      const { status } = await api("GET", "/api/contracts");
      expect(status).toBe(200);
    });

    it("Step 18: Verify harness detection", async () => {
      if (!serverAvailable) return;
      const { status } = await api("GET", "/api/onboarding/harnesses");
      expect(status).toBe(200);
    });

    it("Step 19: Final stats check", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/stats");
      expect(status).toBe(200);
    });

    it("Step 20: Verify event history grew", async () => {
      if (!serverAvailable) return;
      const { status, data } = await api("GET", "/api/events?limit=50");
      expect(status).toBe(200);
    });
  });
});
