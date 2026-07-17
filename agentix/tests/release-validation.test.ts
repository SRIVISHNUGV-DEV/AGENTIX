import { describe, it, expect, beforeAll, afterAll } from "vitest";

let serverProcess: any;
const API = "http://localhost:3001";

beforeAll(async () => {
  try {
    const res = await fetch(`${API}/api/health`);
    if (res.ok) return;
  } catch {}

  const { spawn } = await import("child_process");
  const { existsSync } = await import("fs");
  const { join } = await import("path");
  // Launch the server portably: resolve the tsx CLI directly instead of relying on
  // `npx` being on PATH (it is not under bun, which caused `spawn npx ENOENT` and a
  // false NO-GO verdict even when the app was healthy).
  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.cjs");
  const useTsx = existsSync(tsxCli);
  serverProcess = spawn(
    process.execPath,
    useTsx
      ? [tsxCli, "src/runtime/server.ts"]
      : ["--import", "tsx", "src/runtime/server.ts"],
    {
      cwd: process.cwd(),
      stdio: "pipe",
      env: { ...process.env, AGENTIX_HOME: process.env.AGENTIX_HOME },
    }
  );

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 10000);
    serverProcess.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes("AgentIX API running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.stderr?.on("data", (data: Buffer) => {
      if (data.toString().includes("AgentIX API running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

describe("RELEASE VALIDATION: GO / NO-GO", () => {
  const results: { suite: string; status: "PASS" | "FAIL"; details: string }[] = [];

  async function check(suite: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.push({ suite, status: "PASS", details: "" });
    } catch (e: any) {
      // Record for the end-of-run banner, then RE-THROW so vitest actually fails.
      // Previously this swallowed failures, making every test false-green and the
      // GO/NO-GO gate meaningless.
      results.push({ suite, status: "FAIL", details: e.message });
      throw e;
    }
  }

  describe("G1: System Health", () => {
    it("API server responds", async () => {
      await check("API Health", async () => {
        const res = await fetch(`${API}/api/health`);
        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data.status).toBe("ok");
      });
    });

    it("Stats endpoint works", async () => {
      await check("Stats", async () => {
        const res = await fetch(`${API}/api/stats`);
        expect(res.ok).toBe(true);
      });
    });
  });

  describe("G2: All Endpoints Respond", () => {
    const endpoints = [
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/stats" },
      { method: "GET", path: "/api/config" },
      { method: "GET", path: "/api/organizations" },
      { method: "GET", path: "/api/organizations/requests" },
      { method: "GET", path: "/api/credentials" },
      { method: "GET", path: "/api/wallets" },
      { method: "GET", path: "/api/sessions?wallet=0x0000000000000000000000000000000000000000" },
      { method: "GET", path: "/api/proofs" },
      { method: "GET", path: "/api/actions" },
      { method: "GET", path: "/api/events?limit=5" },
      { method: "GET", path: "/api/backups" },
      { method: "GET", path: "/api/contracts" },
      { method: "GET", path: "/api/diagnostics" },
      { method: "GET", path: "/api/onboarding/status" },
      { method: "GET", path: "/api/onboarding/diagnostics" },
      { method: "GET", path: "/api/onboarding/harnesses" },
    ];

    for (const ep of endpoints) {
      it(`${ep.method} ${ep.path}`, async () => {
        await check(`${ep.method} ${ep.path}`, async () => {
          const res = await fetch(`${API}${ep.path}`, { method: ep.method });
          expect(res.ok).toBe(true);
        });
      });
    }
  });

  describe("G3: Core Services", () => {
    it("OrganizationService works", async () => {
      await check("OrganizationService", async () => {
        const { getOrganizationService } = await import("../packages/services/organization-service");
        const svc = getOrganizationService();
        expect(svc.list()).toBeDefined();
        expect(svc.count()).toBeGreaterThanOrEqual(0);
      });
    });

    it("CredentialService works", async () => {
      await check("CredentialService", async () => {
        const { getCredentialService } = await import("../packages/services/credential-service");
        const svc = getCredentialService();
        expect(svc.list()).toBeDefined();
      });
    });

    it("WalletService works", async () => {
      await check("WalletService", async () => {
        const { getWalletService } = await import("../packages/services/wallet-service");
        const svc = getWalletService();
        expect(svc.list()).toBeDefined();
      });
    });

    it("SessionService works", async () => {
      await check("SessionService", async () => {
        const { getSessionService } = await import("../packages/services/session-service");
        const svc = getSessionService();
        expect(svc.listByWallet("0x0000000000000000000000000000000000000000")).toBeDefined();
      });
    });

    it("ProofService works", async () => {
      await check("ProofService", async () => {
        const { getProofService } = await import("../packages/services/proof-service");
        const svc = getProofService();
        expect(svc.list()).toBeDefined();
      });
    });

    it("AuthorityService works", async () => {
      await check("AuthorityService", async () => {
        const { getAuthorityService } = await import("../packages/services/authority-service");
        const svc = getAuthorityService();
        expect(svc.listPending()).toBeDefined();
      });
    });
  });

  describe("G4: Event Bus", () => {
    it("EventBus functional", async () => {
      await check("EventBus", async () => {
        const { EventBus } = await import("../packages/core/eventbus");
        const bus = new EventBus();
        let received = false;
        bus.on("HealthCheckRun", () => { received = true; });
        await bus.emit({ type: "HealthCheckRun", data: { timestamp: Date.now() } });
        expect(received).toBe(true);
      });
    });
  });

  describe("G5: Merkle Trees", () => {
    it("Merkle tree operations work", async () => {
      await check("MerkleTree", async () => {
        const { buildMerkleTree, getMerkleProof, verifyProof, hashLeaf, initMerkleCrypto } =
          await import("../src/utils/merkle");
        // Poseidon must be initialized before any hashing; leaves are a Map<key,value>
        // and hashLeaf takes (key, value) — the previous 1-arg string form was stale.
        await initMerkleCrypto();
        const leaves = new Map<bigint, bigint>();
        leaves.set(0n, 100n);
        leaves.set(1n, 101n);
        leaves.set(2n, 102n);
        const tree = buildMerkleTree(leaves, 10);
        expect(tree.root).toBeDefined();
        const leafHash = hashLeaf(1n, 101n);
        const proof = getMerkleProof(tree.layers, 1, 10);
        const valid = verifyProof(leafHash, proof.pathElements, proof.pathIndices, tree.root, 10);
        expect(valid).toBe(true);
      });
    });
  });

  describe("G6: Database Integrity", () => {
    it("SQLite integrity check", async () => {
      await check("SQLite", async () => {
        const { getDatabase } = await import("../src/core/database");
        const db = getDatabase();
        const integrity = db.pragma("integrity_check", { simple: true });
        expect(integrity).toBe("ok");
      });
    });
  });

  describe("G7: Zero Silent Failures", () => {
    it("unknown routes return 404", async () => {
      await check("404 Handling", async () => {
        const res = await fetch(`${API}/api/nonexistent`);
        expect(res.status).toBe(404);
      });
    });

    it("CORS headers present", async () => {
      await check("CORS", async () => {
        const res = await fetch(`${API}/api/health`);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      });
    });
  });

  afterAll(() => {
    console.log("\n" + "=".repeat(70));
    console.log("         AGENTIX V1 — RELEASE VALIDATION REPORT");
    console.log("=".repeat(70));

    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    const total = results.length;

    for (const r of results) {
      const icon = r.status === "PASS" ? "✓" : "✗";
      const detail = r.details ? ` — ${r.details}` : "";
      console.log(`  ${icon} ${r.suite}${detail}`);
    }

    console.log("=".repeat(70));
    console.log(`  TOTAL: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log("=".repeat(70));

    if (failed === 0) {
      console.log("\n  ╔══════════════════════════════════════╗");
      console.log("  ║          VERDICT: GO                ║");
      console.log("  ║   AgentIX V1 is production ready    ║");
      console.log("  ╚══════════════════════════════════════╝\n");
    } else {
      console.log("\n  ╔══════════════════════════════════════╗");
      console.log("  ║          VERDICT: NO-GO             ║");
      console.log("  ║   Fix failing tests before release  ║");
      console.log("  ╚══════════════════════════════════════╝\n");
    }
  });
});
