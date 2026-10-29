/**
 * server-local-token.test.ts — live REST server tests for R-5 (token gate +
 * CORS allowlist), R-8 (relay caller identity), R-7 (x402 key masking +
 * preserve rule), R-13 (session-key omission), R-10 (REST plan approval).
 *
 * Spawns the real server as a subprocess on a scratch AGENTIX_HOME (never
 * the test DB, never port 3001 — port 3101, falling back to the port the
 * server records in runtime.json). No chain interaction: every assertion
 * stops at a gate, a mask, or a denial.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const AGENTIX_DIR = process.cwd();
let proc: ChildProcess | null = null;
let base = "";
let token = "";
let home = "";

async function waitForHealth(port: number, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((x) => setTimeout(x, 500));
  }
  return false;
}

async function startServer(): Promise<void> {
  home = mkdtempSync(join(tmpdir(), "agentix-token-test-"));
  proc = spawn("bun", ["x", "tsx", "src/runtime/server.ts"], {
    cwd: AGENTIX_DIR,
    env: { ...process.env, AGENTIX_HOME: home, AGENTIX_API_PORT: "3101" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});
  // The server records its actual port (3101 unless busy) in runtime.json.
  let port = 3101;
  for (let i = 0; i < 60; i++) {
    const manifest = join(home, "runtime.json");
    if (existsSync(manifest)) {
      try {
        const m = JSON.parse(readFileSync(manifest, "utf-8"));
        if (m.apiPort) {
          port = m.apiPort;
          break;
        }
      } catch {}
    }
    await new Promise((x) => setTimeout(x, 500));
  }
  const ok = await waitForHealth(port);
  if (!ok) throw new Error(`server did not become healthy on port ${port}`);
  base = `http://127.0.0.1:${port}`;
  const tokenFile = join(home, ".local-token");
  if (!existsSync(tokenFile)) throw new Error("server did not write .local-token");
  token = readFileSync(tokenFile, "utf-8").trim();
  expect(token).toMatch(/^[0-9a-f]{64}$/);
}

async function stopServer(): Promise<void> {
  if (proc) {
    proc.kill("SIGTERM");
    await new Promise((x) => setTimeout(x, 1000));
    if (!proc.killed) proc.kill("SIGKILL");
    proc = null;
  }
  if (home) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {}
  }
}

afterAll(async () => {
  await stopServer();
});

const post = (path: string, body: any, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("live server: token gate, CORS, relay identity, key masking", { timeout: 60000 }, () => {
  it("starts and issues a per-run token", async () => {
    await startServer();
    expect(base).toContain("127.0.0.1");
    expect(token.length).toBe(64);
  });

  it("health stays open; state-changing routes require the token", async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    const noToken = await post("/api/policy", { walletAddress: "0x0000000000000000000000000000000000000001" });
    expect(noToken.status).toBe(403);
    const body: any = await noToken.json();
    expect(body.error).toContain("Local token");
  });

  it("CORS: evil origins get no wildcard; the dashboard origin is reflected", async () => {
    const evil = await fetch(`${base}/api/health`, { headers: { Origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).not.toBe("*");
    const dash = await fetch(`${base}/api/health`, { headers: { Origin: "http://localhost:3000" } });
    expect(dash.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const preflight = await fetch(`${base}/api/policy`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("R-8: a bare sessionId relay is rejected; token or key proof passes the identity check", async () => {
    const relay = { userOp: { sender: "0x1111111111111111111111111111111111111111", target: "0x2222222222222222222222222222222222222222", value: "0", calldata: "0x", sessionId: "session-that-does-not-exist" } };
    const bare = await post("/api/bundler/send", relay);
    expect(bare.status).toBe(403);
    expect(((await bare.json()) as any).error).toContain("localhost token");
    // With the token, the identity check passes and the RISK gate denies
    // (unknown session) — a different error, proving the token check passed.
    const withToken = await post("/api/bundler/send", relay, { "X-Agentix-Token": token });
    expect(withToken.status).toBe(403);
    expect(((await withToken.json()) as any).error).toContain("Unknown session");
    // With a caller-supplied key (proof of possession) and NO token, the
    // identity check also passes and the same risk denial follows.
    const withKey = await post("/api/bundler/send", { ...relay, agentPrivateKey: `0x${"42".repeat(32)}` });
    expect(withKey.status).toBe(403);
    expect(((await withKey.json()) as any).error).toContain("Unknown session");
  });

  it("R-10 (REST): plan approval without the token is rejected", async () => {
    const r = await post("/api/plans/approve", { planId: "plan_does_not_exist" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error).toContain("Local token");
  });

  it("R-7: x402 policy never returns the session key, and saving without a key preserves it", async () => {
    const get = async () => {
      const r = await fetch(`${base}/api/x402/policy`, { headers: { "X-Agentix-Token": token } });
      return { status: r.status, body: (await r.json()) as any };
    };
    const noToken = await fetch(`${base}/api/x402/policy`);
    expect(noToken.status).toBe(403);
    const before = await get();
    expect(before.status).toBe(200);
    expect("sessionKey" in before.body).toBe(false);
    expect(typeof before.body.sessionKeyPresent).toBe("boolean");
    const key = `0x${"77".repeat(32)}`;
    const save = await post("/api/x402/policy", { ...before.body, sessionKey: key }, { "X-Agentix-Token": token });
    expect(save.status).toBe(200);
    const afterSave = await get();
    expect("sessionKey" in afterSave.body).toBe(false);
    expect(afterSave.body.sessionKeyPresent).toBe(true);
    // Save again WITHOUT a key: the stored key must survive (the GET
    // masking would otherwise let any dashboard save blank the key).
    const saveBlank = await post("/api/x402/policy", { ...afterSave.body }, { "X-Agentix-Token": token });
    expect(saveBlank.status).toBe(200);
    const afterBlank = await get();
    expect(afterBlank.body.sessionKeyPresent).toBe(true);
  });

  it("R-13: session preparation omits the private key unless selfCustody is explicit", async () => {
    const wallet = "0x3333333333333333333333333333333333333333";
    const plain = await post("/api/sessions/prepare-lightweight", { walletAddress: wallet, expiryDays: 30 }, { "X-Agentix-Token": token });
    expect(plain.status).toBe(200);
    const plainBody: any = await plain.json();
    expect("sessionPrivateKey" in plainBody).toBe(false);
    expect(typeof plainBody.sessionKeyAddress).toBe("string");
    expect(plainBody.runtimeCanSign).toBe(true);
    const self = await post("/api/sessions/prepare-lightweight", { walletAddress: wallet, expiryDays: 30, selfCustody: true }, { "X-Agentix-Token": token });
    expect(self.status).toBe(200);
    const selfBody: any = await self.json();
    expect(typeof selfBody.sessionPrivateKey).toBe("string");
    expect(selfBody.sessionPrivateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
