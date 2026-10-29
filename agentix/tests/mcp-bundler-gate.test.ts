/**
 * mcp-bundler-gate.test.ts — live MCP stdio tests for R-4 (bundler_send now
 * passes through assessBundlerOp) and R-10 (plan approval requires an owner
 * attestation).
 *
 * The MCP server calls main() at import, so it is exercised as a real
 * subprocess over stdio JSON-RPC, never imported. It inherits the vitest
 * AGENTIX_HOME (.agentix-test) from setup.ts; the plan and wallet rows are
 * inserted into that DB BEFORE the server spawns (no concurrent writes).
 * Every assertion stops at a gate that needs no chain.
 */
import { describe, it, expect } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { ethers } from "ethers";

const AGENTIX_DIR = process.cwd();
const OWNER = ethers.Wallet.createRandom();
const WALLET = "0x5555555555555555555555555555555555555555";
const NO_POLICY_WALLET = "0x6666666666666666666666666666666666666666";
const PLAN_ID = "plan_mcp_test_001";

async function seedDb(): Promise<void> {
  const { runExecute } = await import("../src/core/database");
  runExecute("INSERT OR REPLACE INTO wallets (wallet_address, owner_address) VALUES (?, ?)", WALLET, OWNER.address);
  runExecute("INSERT OR REPLACE INTO wallets (wallet_address, owner_address) VALUES (?, ?)", NO_POLICY_WALLET, OWNER.address);
  const now = Math.floor(Date.now() / 1000);
  runExecute(
    `INSERT OR REPLACE INTO execution_plans
     (plan_id, content_hash, intent_json, steps_json, policy_json, capability_graph_json, simulation_json,
      risk_score, risk_category, risk_json, explanation_json, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    PLAN_ID,
    "testhash",
    JSON.stringify({ action: "wallet_execute", normalizedAction: "wallet_execute", params: {}, agent: { walletAddress: WALLET } }),
    "{}",
    "{}",
    "{}",
    "{}",
    10,
    "LOW",
    JSON.stringify({ score: 10, category: "LOW", requiresApproval: true }),
    '"test plan"',
    "APPROVAL_REQUIRED",
    now,
    now + 3600
  );
}

type RpcResponse = { jsonrpc: string; id?: number; result?: any; error?: any };

class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending: Array<{ id: number; resolve: (r: RpcResponse) => void; reject: (e: Error) => void }> = [];
  private nextId = 1;

  constructor() {
    this.proc = spawn("bun", ["x", "tsx", "src/mcp/server.ts"], {
      cwd: AGENTIX_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        let msg: RpcResponse;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // Tolerate any non-JSON log line on stdout.
        }
        if (typeof msg.id === "number") {
          const p = this.pending.find((x) => x.id === msg.id);
          if (p) {
            this.pending = this.pending.filter((x) => x !== p);
            p.resolve(msg);
          }
        }
      }
    });
    this.proc.stderr?.on("data", () => {});
  }

  send(obj: any): void {
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  call(method: string, params: any): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.push({ id, resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => reject(new Error(`timeout waiting for response to id ${id}`)), 20000);
    });
  }

  async initialize(): Promise<void> {
    const r = await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agentix-test", version: "0" },
    });
    if (r.error) throw new Error(`initialize failed: ${JSON.stringify(r.error)}`);
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  kill(): void {
    try {
      this.proc.kill("SIGTERM");
    } catch {}
  }
}

describe("live MCP: bundler gate + plan attestation", { timeout: 60000 }, () => {
  it("gates bundler_send and requires owner attestation for plan approval", async () => {
    await seedDb();
    const client = new McpClient();
    try {
      await client.initialize();

      // R-4: a bundler send for a wallet with NO owner policy must be
      // denied by the gate — before any key handling. The pre-fix code
      // would instead report "No signing key" (keystore miss), because
      // it never assessed the op.
      const gated = await client.call("tools/call", {
        name: "agentix_bundler_send",
        arguments: {
          sender: NO_POLICY_WALLET,
          target: "0x7777777777777777777777777777777777777777",
          value: "0",
          calldata: "0x",
        },
      });
      const gatedText = JSON.stringify(gated.result ?? gated.error);
      expect(gatedText).toContain("Owner policy");

      // R-10: plan approval without an attestation is refused.
      const noAttest = await client.call("tools/call", {
        name: "agentix_approve_plan",
        arguments: { planId: PLAN_ID },
      });
      expect(JSON.stringify(noAttest.result ?? noAttest.error)).toContain("attestation");

      // R-10: the same approval WITH a valid owner attestation succeeds.
      const sig = await OWNER.signMessage(ethers.toUtf8Bytes(`agentix-plan-approve:${PLAN_ID}`));
      const attested = await client.call("tools/call", {
        name: "agentix_approve_plan",
        arguments: { planId: PLAN_ID, ownerAttestation: sig },
      });
      expect(JSON.stringify(attested.result ?? attested.error)).toContain("APPROVED");
    } finally {
      client.kill();
    }
  });
});
