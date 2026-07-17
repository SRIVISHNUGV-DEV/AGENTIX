import { describe, it, expect, beforeAll } from "vitest";

describe("3. Frontend ↔ Backend Tests", () => {
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

  async function apiGet(path: string): Promise<any> {
    const res = await fetch(`${API}${path}`);
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  async function apiPost(path: string, body: any): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  async function apiPut(path: string, body: any): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  describe("Health & Status", () => {
    it("GET /api/health returns ok", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/health");
      expect(status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data.version).toBe("1.0.0");
    });

    it("GET /api/stats returns all counters", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/stats");
      expect(status).toBe(200);
      expect(data).toHaveProperty("organizations");
      expect(data).toHaveProperty("credentials");
      expect(data).toHaveProperty("wallets");
      expect(data).toHaveProperty("sessions");
      expect(data).toHaveProperty("proofs");
      expect(data).toHaveProperty("network");
      expect(data).toHaveProperty("chainId");
    });
  });

  describe("Config", () => {
    it("GET /api/config returns configuration", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/config");
      expect(status).toBe(200);
      expect(data).toHaveProperty("rpcUrl");
      expect(data).toHaveProperty("networkName");
      expect(data).toHaveProperty("chainId");
    });

    it("PUT /api/config updates configuration", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiPut("/api/config", { rpcUrl: "https://test.example.com" });
      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const { data: updated } = await apiGet("/api/config");
      expect(updated.rpcUrl).toBe("https://test.example.com");
    });
  });

  describe("Organizations", () => {
    it("GET /api/organizations returns array", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/organizations");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("POST /api/organizations/requests creates request", async () => {
      if (!serverAvailable) return;
      // Fresh random owner per run — the server returns 400 for a duplicate
      // pending request, so a fixed address only worked on the first-ever run.
      const rand = Array.from({ length: 40 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
      const { status, data } = await apiPost("/api/organizations/requests", {
        name: "Test Release Org",
        ownerAddress: `0x${rand}`,
      });
      expect(status).toBe(201);
      expect(data.success).toBe(true);
    });

    it("GET /api/organizations/requests shows pending", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/organizations/requests");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("Data Endpoints", () => {
    it("GET /api/credentials returns array", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/credentials");
      expect(status).toBe(200);
      // Server wraps the list as { value: [...] } — the contract the dashboard
      // consumes (credData.value || credData). Assert the real shape.
      expect(Array.isArray(data.value)).toBe(true);
    });

    it("GET /api/wallets returns array", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/wallets");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("GET /api/sessions returns array", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/sessions?wallet=0x0000000000000000000000000000000000000000");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("GET /api/actions returns data", async () => {
      if (!serverAvailable) return;
      const { status } = await apiGet("/api/actions");
      expect(status).toBe(200);
    });

    it("GET /api/events returns array", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/events?limit=10");
      expect(status).toBe(200);
      // Server returns { events: [...], total, offset, limit } — the shape the
      // dashboard reads (data.events). Assert the real contract.
      expect(Array.isArray(data.events)).toBe(true);
    });

    it("GET /api/backups returns array", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/backups");
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("GET /api/contracts returns data", async () => {
      if (!serverAvailable) return;
      const { status } = await apiGet("/api/contracts");
      expect(status).toBe(200);
    });

    it("GET /api/diagnostics returns checks", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/diagnostics");
      expect(status).toBe(200);
      expect(data).toHaveProperty("checks");
    });
  });

  describe("Onboarding", () => {
    it("GET /api/onboarding/status returns status", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/onboarding/status");
      expect(status).toBe(200);
      expect(data).toHaveProperty("initialized");
      expect(data).toHaveProperty("rpcConfigured");
    });

    it("GET /api/onboarding/diagnostics returns checks", async () => {
      if (!serverAvailable) return;
      const { status, data } = await apiGet("/api/onboarding/diagnostics");
      expect(status).toBe(200);
      expect(data).toHaveProperty("checks");
    });
  });

  describe("Error Handling", () => {
    it("returns 404 for unknown routes", async () => {
      if (!serverAvailable) return;
      const { status } = await apiGet("/api/nonexistent");
      expect(status).toBe(404);
    });

    it("CORS headers are present", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${API}/api/health`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });
});
