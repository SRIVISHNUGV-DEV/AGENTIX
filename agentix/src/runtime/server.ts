import http from "http";
import { getDatabase, runQuery, runSingle, runExecute } from "../core/database";
import { getProxyGuard } from "../core/proxy-guard";
import { getEventBus } from "../../packages/core/eventbus";
import { getAuthorityService } from "../../packages/services/authority-service";
import { getOrganizationService } from "../../packages/services/organization-service";
import { getCredentialService } from "../../packages/services/credential-service";
import { getWalletService } from "../../packages/services/wallet-service";
import { getSessionService } from "../../packages/services/session-service";
import { getProofService } from "../../packages/services/proof-service";
import { BackupEngine } from "../../packages/core/backup-engine";
import { loadConfig } from "../core/config";
import { join } from "path";
import type { ZodType } from "zod";
import {
  OrganizationRequestSchema,
  CredentialIssueSchema,
  ConfigUpdateSchema,
  CapabilityCreateSchema,
  DelegationRequestSchema,
  SessionCreateRequestSchema,
  SessionRevokeSchema,
  WalletCreateRequestSchema,
} from "../../packages/shared/schemas";

// Preferred port only — the server asks the OS for a free port near this one at
// startup (see findFreePort below) so it never crashes on EADDRINUSE or steals a
// port owned by an unrelated process. The port it actually lands on is recorded
// in AGENTIX_HOME/runtime.json so the dashboard can discover it.
const PREFERRED_PORT = parseInt(
  process.env.AGENTIX_API_PORT || process.env.AGENTIX_DASHBOARD_PORT || "3001",
  10
);
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const HOST = "127.0.0.1"; // Localhost only — no auth needed
// The port we actually bound to (resolved at startup). Declared here so request
// handlers can reference it; assigned in the async bootstrap block below.
let BOUND_PORT = PREFERRED_PORT;

function json(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

/**
 * Validate a request body against a canonical Zod schema (from packages/shared/schemas —
 * the single source of truth for HTTP-boundary shapes). On failure, writes a 400 with
 * field-level errors and returns null so the caller can early-return. On success, returns
 * the parsed/typed value.
 */
function validateBody<T>(res: http.ServerResponse, schema: ZodType<T>, body: unknown): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    json(res, { success: false, error: "Validation failed", errors }, 400);
    return null;
  }
  return result.data;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${HOST}:${BOUND_PORT}`);
  const path = url.pathname;

  try {
    // ── Health & Status ──────────────────────────────────────────────
    if (path === "/api/health") {
      return json(res, { status: "ok", version: "1.0.0", uptime: process.uptime(), port: BOUND_PORT });
    }

    // Where the runtime is actually listening — lets local clients/tools
    // discover the (possibly dynamic) API port without a hardcoded value.
    if (path === "/api/runtime-info") {
      return json(res, { apiPort: BOUND_PORT, host: HOST, pid: process.pid, version: "1.0.0" });
    }

    if (path === "/api/price" && req.method === "GET") {
      const { getEthUsdPrice } = await import("../core/price-oracle");
      const price = await getEthUsdPrice();
      return json(res, { ethUsd: price, currency: "USD" });
    }

    if (path === "/api/stats") {
      const orgService = getOrganizationService();
      const credService = getCredentialService();
      const walletService = getWalletService();
      const sessionService = getSessionService();
      const proofService = getProofService();
      const config = loadConfig();
      return json(res, {
        organizations: orgService.count(),
        activeOrganizations: orgService.activeCount(),
        credentials: credService.count(),
        wallets: walletService.count(),
        sessions: sessionService.count(),
        proofs: proofService.count(),
        network: config.networkName,
        chainId: config.chainId,
      });
    }

    // ── Onboarding / Wizard ──────────────────────────────────────────
    if (path === "/api/onboarding/status" && req.method === "GET") {
      const config = loadConfig();
      const dbPath = config.database.path;
      const { existsSync } = await import("fs");
      // "initialized" means the local runtime has been set up — i.e. the config
      // file exists and the database is present. Do NOT key this off a build
      // artifact path (dist/src/index.js): that path doesn't exist in the
      // published bundle, so it would falsely report an initialized install as
      // uninitialized and re-trigger onboarding.
      const { getConfigPath } = await import("../core/config");
      return json(res, {
        initialized: existsSync(getConfigPath()) && existsSync(dbPath),
        databaseReady: existsSync(dbPath),
        rpcConfigured: !!config.rpcUrl,
        network: config.networkName,
        chainId: config.chainId,
      });
    }

    if (path === "/api/onboarding/diagnostics" && req.method === "GET") {
      const { runFullDiagnostics } = await import("../tools/wizard");
      const result = await runFullDiagnostics();
      return json(res, result);
    }

    if (path === "/api/onboarding/harnesses" && req.method === "GET") {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const { runExecute } = await import("../core/database");
      const manager = getHarnessManager();
      const scan = await manager.scanAll();

      // Persist each detected/connected harness to the DB
      for (const h of scan.harnesses) {
        const info = h.detect.harness;
        runExecute(
          `INSERT OR REPLACE INTO harnesses (harness_id, display_name, version, capabilities, mcp_version, config_path, status, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
          info.id,
          info.name,
          info.version || "",
          "[]",
          "",
          info.configPath || "",
          info.status
        );
      }

      return json(res, scan);
    }

    if (path === "/api/onboarding/harnesses/connect" && req.method === "POST") {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const result = await manager.connectAll();
      return json(res, result);
    }

    if (path === "/api/onboarding/harnesses/connect" && req.method === "DELETE") {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const body = await parseBody(req);
      const adapter = manager.getAdapter(body.harnessId);
      if (adapter) {
        const result = await adapter.disconnect();
        return json(res, result);
      }
      return json(res, { error: "Harness not found" }, 404);
    }

    if (path === "/api/onboarding/harnesses/health" && req.method === "GET") {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const result = await manager.healthCheckAll();
      return json(res, result);
    }

    if (path === "/api/onboarding/harnesses/repair" && req.method === "POST") {
      const { getHarnessManager } = await import("../../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const results = await manager.repairAll();
      return json(res, { results });
    }

    if (path === "/api/onboarding/init" && req.method === "POST") {
      const body = await parseBody(req);
      const { initializeFullRuntime } = await import("../tools/wizard");
      // Harness wiring is opt-in; the wizard has a dedicated "connect" step that
      // calls /api/onboarding/harnesses/connect explicitly. Plain init must not
      // silently mutate external IDE configs.
      const result = await initializeFullRuntime(body.rpcUrl, body.connectHarnesses === true);
      return json(res, result);
    }

    if (path === "/api/onboarding/fund" && req.method === "POST") {
      const body = await parseBody(req);
      const { getFundOptions } = await import("../tools/fund");
      const result = getFundOptions(body);
      return json(res, result);
    }

    // ── Organizations ────────────────────────────────────────────────
    if (path === "/api/organizations" && req.method === "GET") {
      const svc = getOrganizationService();
      return json(res, svc.list());
    }

    if (path === "/api/organizations/requests" && req.method === "GET") {
      const svc = getAuthorityService();
      return json(res, svc.listPending());
    }

    if (path === "/api/organizations/requests" && req.method === "POST") {
      const raw = await parseBody(req);
      const body = validateBody(res, OrganizationRequestSchema, raw);
      if (!body) return; // 400 already sent
      const svc = getAuthorityService();
      const result = await svc.submitRequest(body.name, body.ownerAddress, raw.eip712Signature || "");
      return json(res, result, result.success ? 201 : 400);
    }

    if (path.startsWith("/api/organizations/requests/") && req.method === "POST") {
      const id = path.split("/").pop();
      const body = await parseBody(req);
      const svc = getAuthorityService();
      if (body.action === "approve") {
        const result = await svc.approveRequest(id!);
        return json(res, result, result.success ? 200 : 400);
      } else if (body.action === "reject") {
        const result = svc.rejectRequest(id!);
        return json(res, result, result.success ? 200 : 400);
      }
      return json(res, { success: false, error: `Unknown action: ${body.action}. Use "approve" or "reject".` }, 400);
    }

    if (path.startsWith("/api/organizations/") && req.method === "GET" && !path.includes("requests")) {
      const id = path.split("/").pop();
      const svc = getOrganizationService();
      const org = svc.get(id!);
      return org ? json(res, org) : json(res, { error: "Not found" }, 404);
    }

    // ── Credentials ──────────────────────────────────────────────────
    if (path === "/api/credentials/oracle" && req.method === "GET") {
      const { getEthUsdPrice } = await import("../core/price-oracle");
      const adapter = await import("../blockchain/adapter");
      try {
        const oracle = await adapter.readOracleState();
        const ethPrice = await getEthUsdPrice();
        return json(res, { ...oracle, ethPrice });
      } catch (e: any) {
        return json(res, { error: e.message }, 500);
      }
    }

    if (path === "/api/credentials" && req.method === "GET") {
      const orgId = url.searchParams.get("orgId");
      const { listCredentials } = await import("../tools/credential");
      return json(res, { value: await listCredentials(orgId || undefined) });
    }

    if (path === "/api/credentials" && req.method === "POST") {
      const raw = await parseBody(req);
      const body = validateBody(res, CredentialIssueSchema, raw);
      if (!body) return; // 400 already sent
      const { issueCredential } = await import("../tools/credential");
      const result = await issueCredential(body);
      return json(res, result, result.success ? 201 : 400);
    }

    if (path === "/api/credentials/next-agent-id" && req.method === "GET") {
      const { getNextAgentId } = await import("../tools/credential");
      return json(res, { agentId: getNextAgentId() });
    }

    if (path === "/api/credentials/next-org-id" && req.method === "GET") {
      const { getNextOrgId } = await import("../tools/credential");
      return json(res, { orgId: getNextOrgId() });
    }

    if (path === "/api/credentials/orgs" && req.method === "GET") {
      const { listOrgsForDropdown } = await import("../tools/credential");
      return json(res, { value: listOrgsForDropdown() });
    }

    // ── Compiler Gateway ────────────────────────────────────────
    if (path === "/api/execute" && req.method === "POST") {
      const body = await parseBody(req);
      const { getCompilerGateway } = await import("../compiler-gateway");
      const gateway = getCompilerGateway();
      const result = await gateway.executeIntent(body.action, body.params, 'rest', body.context);
      return json(res, result, result.success ? 200 : 400);
    }

    if (path === "/api/plans" && req.method === "GET") {
      const { getCompilerGateway } = await import("../compiler-gateway");
      const gateway = getCompilerGateway();
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const status = url.searchParams.get('status') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return json(res, gateway.listPlans(status, limit));
    }

    if (path === "/api/plans/approve" && req.method === "POST") {
      const body = await parseBody(req);
      const { getCompilerGateway } = await import("../compiler-gateway");
      const gateway = getCompilerGateway();
      const plan = gateway.approvePlan(body.planId);
      return json(res, plan || { error: "Plan not found or not in APPROVAL_REQUIRED state" });
    }

    if (path === "/api/plans/reject" && req.method === "POST") {
      const body = await parseBody(req);
      const { getCompilerGateway } = await import("../compiler-gateway");
      const gateway = getCompilerGateway();
      const plan = gateway.rejectPlan(body.planId, body.reason || "Rejected by user");
      return json(res, plan || { error: "Plan not found" });
    }

    if (path === "/api/capability-envelope" && req.method === "POST") {
      const body = await parseBody(req);
      const { getCompilerGateway } = await import("../compiler-gateway");
      const gateway = getCompilerGateway();
      const envelope = await gateway.getCapabilityEnvelope(body.walletAddress, body.sessionId);
      return json(res, envelope);
    }

    // ── Owner Policy ────────────────────────────────────────────
    if (path?.startsWith("/api/policy/") && req.method === "GET") {
      const walletAddress = path.split("/api/policy/")[1];
      const { getOwnerPolicy } = await import("../core/owner-policy");
      return json(res, getOwnerPolicy(walletAddress) || { error: "No policy set" });
    }

    if (path === "/api/policy" && req.method === "POST") {
      const body = await parseBody(req);
      const { setOwnerPolicy } = await import("../core/owner-policy");
      const policy = await setOwnerPolicy(body);
      return json(res, policy, 201);
    }

    if (path === "/api/policy/check" && req.method === "POST") {
      const body = await parseBody(req);
      const { checkPolicy } = await import("../core/owner-policy");
      return json(res, checkPolicy(body.walletAddress, body.action, body.params || {}));
    }

    // ── Wallets ──────────────────────────────────────────────────────
    if (path === "/api/wallets" && req.method === "GET") {
      const svc = getWalletService();
      return json(res, svc.list());
    }

    if (path === "/api/wallets" && req.method === "POST") {
      const raw = await parseBody(req);
      const body = validateBody(res, WalletCreateRequestSchema, raw);
      if (!body) return;
      const { createWallet } = await import("../tools/wallet");
      const result = await createWallet(body.ownerAddress, body.harnessId);
      return json(res, result, result.success ? 201 : 400);
    }

    if (path === "/api/wallets/link" && req.method === "POST") {
      const body = await parseBody(req);
      const { runExecute, runSingle } = await import("../core/database");
      // Check: harness already linked to a DIFFERENT wallet
      const harnessOwner = runSingle("SELECT wallet_address FROM wallets WHERE harness_id = ?", body.harnessId) as any;
      if (harnessOwner && harnessOwner.wallet_address !== body.walletAddress) {
        return json(res, { success: false, error: `Harness "${body.harnessId}" is already linked to wallet ${harnessOwner.wallet_address}` }, 400);
      }
      // Check: wallet already linked to a DIFFERENT harness
      const walletBinding = runSingle("SELECT harness_id FROM wallets WHERE wallet_address = ?", body.walletAddress) as any;
      if (walletBinding && walletBinding.harness_id && walletBinding.harness_id !== body.harnessId) {
        return json(res, { success: false, error: `Wallet is already linked to harness "${walletBinding.harness_id}". Unlink it first.` }, 400);
      }
      // Check: wallet already linked to the SAME harness (idempotent — allow)
      if (walletBinding && walletBinding.harness_id === body.harnessId) {
        return json(res, { success: true });
      }
      runExecute("UPDATE wallets SET harness_id = ? WHERE wallet_address = ?", body.harnessId, body.walletAddress);
      return json(res, { success: true });
    }

    if (path === "/api/wallets/create-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const adapter = await import("../blockchain/adapter");
      const tx = adapter.encodeCreateWallet(body.ownerAddress);
      return json(res, { success: true, ...tx });
    }

    if (path === "/api/wallets/confirm" && req.method === "POST") {
      const body = await parseBody(req);
      const { recordWalletInDB } = await import("../core/tx-builder");
      const { getProxyGuard } = await import("../core/proxy-guard");
      const guard = getProxyGuard();
      const validation = guard.validate(body.walletAddress);
      if (!validation.valid) {
        return json(res, { success: false, error: validation.error }, 400);
      }
      try {
        recordWalletInDB(body.walletAddress, body.ownerAddress, body.txHash, body.harnessId, body.actualToAddress);
      } catch (e: any) {
        return json(res, { success: false, error: e.message }, 400);
      }
      return json(res, { success: true, walletAddress: body.walletAddress }, 201);
    }

    if (path === "/api/wallets/execute-tx" && req.method === "POST") {
      const body = await parseBody(req);
      // Validate target address is a known AgentIX contract
      const { validateTargetAddress } = await import("../core/tx-builder");
      const targetCheck = validateTargetAddress(body.to);
      if (!targetCheck.valid) {
        return json(res, { success: false, error: targetCheck.error }, 403);
      }
      const adapter = await import("../blockchain/adapter");
      const tx = adapter.encodeWalletExecute(body.walletAddress, body.to, body.value || "0", body.data || "0x");
      return json(res, { success: true, data: tx.data, chainId: tx.chainId });
    }

    if (path === "/api/wallets/whitelist-tx" && req.method === "POST") {
      return json(res, { success: false, error: "AgentWallet does not support per-wallet whitelisting. Authorization is handled by SessionManager." }, 400);
    }

    if (path === "/api/wallets/deposit-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const adapter = await import("../blockchain/adapter");
      const tx = adapter.encodeWalletDeposit(body.walletAddress, body.amountEth);
      return json(res, { success: true, data: tx.data, value: tx.value, chainId: tx.chainId });
    }

    // ── Credential Root Update ───────────────────────────────────────
    if (path === "/api/credentials/update-root" && req.method === "POST") {
      const body = await parseBody(req);
      const adapter = await import("../blockchain/adapter");
      try {
        const signerAddr = adapter.getSignerAddress();
        const authorized = await adapter.isIssuer(signerAddr);
        if (!authorized) {
          return json(res, {
            success: false,
            error: `Backend signer ${signerAddr} is not an issuer. Add it via: credReg.addIssuer(${signerAddr})`,
            skipped: true,
          }, 400);
        }
        const result = await adapter.sendRootUpdate(body.root);
        return json(res, { success: true, ...result, root: body.root });
      } catch (e: any) {
        return json(res, { success: false, error: e.message }, 400);
      }
    }

    // ── EntryPoint Deposit ───────────────────────────────────────────
    if (path === "/api/wallets/entrypoint-deposit-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const adapter = await import("../blockchain/adapter");
      const tx = adapter.encodeEntryPointDeposit(body.walletAddress, body.amountEth);
      return json(res, { success: true, ...tx });
    }

    // ── Bundler (ERC-4337 local relay) ───────────────────────────────
    if (path === "/api/bundler/send" && req.method === "POST") {
      const body = await parseBody(req);
      const { bundleUserOp, buildSessionUserOp } = await import("./bundler");
      const { assessBundlerOp } = await import("./bundler-risk-gate");
      const { ethers } = await import("ethers");

      // ── RISK ENFORCEMENT GATE ────────────────────────────────────
      // The relay used to execute any session-signed op with no safety check,
      // bypassing the entire risk engine. Now the same decision logic that gates
      // the compiler/gateway path gates the relay: a DENY stops execution here.
      // Fail-closed — if the op can't be assessed, it isn't relayed.
      const gate = await assessBundlerOp(
        {
          sender: body.userOp.sender,
          target: body.userOp.target,
          value: body.userOp.value ?? "0",
          calldata: body.userOp.calldata,
          sessionId: body.userOp.sessionId,
        },
        { ownerApprovalAttestation: body.ownerApprovalAttestation, userOpHash: body.userOpHash }
      );
      if (!gate.allowed) {
        return json(res, {
          success: false,
          blocked: true,
          error: gate.reason,
          risk: { decision: gate.decision, score: gate.score, category: gate.category, topDrivers: gate.topDrivers },
        }, 403);
      }

      // Resolve the signing key. Preferred path: the runtime loads the session's
      // dedicated key from the encrypted keystore and signs autonomously — the
      // client never handles a private key. Fallback: an external/self-custody
      // agent may still pass agentPrivateKey directly.
      let agentPrivateKey: string | undefined = body.agentPrivateKey;
      if (!agentPrivateKey && body.userOp.sessionId) {
        const { loadSessionKey } = await import("../core/session-keystore");
        const stored = loadSessionKey(body.userOp.sessionId);
        if (stored) agentPrivateKey = stored.privateKey;
      }
      if (!agentPrivateKey) {
        return json(res, {
          success: false,
          error: "No signing key: session has no stored key and no agentPrivateKey was provided.",
        }, 400);
      }

      // Build the execute() calldata for the wallet
      const iface = new ethers.Interface(["function execute(address target, uint256 value, bytes calldata data) external"]);
      const callData = iface.encodeFunctionData("execute", [body.userOp.target, body.userOp.value, body.userOp.calldata || "0x"]);
      const fullUserOp = await buildSessionUserOp(body.userOp.sender, callData, body.userOp.sessionId, agentPrivateKey);
      const result = await bundleUserOp(fullUserOp);
      return json(res, { ...result, risk: { decision: gate.decision, score: gate.score } }, result.success ? 200 : 400);
    }

    // ── Debug: Simulate a tx to get revert reason ─────────────────────
    if (path === "/api/debug/simulate" && req.method === "POST") {
      const body = await parseBody(req);
      try {
        const { ethers } = await import("ethers");
        const provider = (await import("../core/provider")).getProvider();
        // Simulate the call from the owner's perspective to match wallet.execute(onlyOwnerOrEntryPoint)
        await provider.call({
          from: body.from,
          to: body.to,
          data: body.data,
          value: body.value || "0x0",
        });
        return json(res, { success: true, reason: null });
      } catch (e: any) {
        // Return the full raw error for debugging
        const reason = e.message || String(e);
        const errorData = e.data?.toString() || e.info?.error?.data?.toString() || "";
        return json(res, { success: false, reason, errorData, short: errorData.slice(0, 66) });
      }
    }

    // ── Identity ─────────────────────────────────────────────────────
    if (path.startsWith("/api/identity/") && req.method === "GET") {
      const wallet = path.replace("/api/identity/", "");
      try {
        const { getProvider } = await import("../core/provider");
        const { loadConfig } = await import("../core/config");
        const { ethers } = await import("ethers");
        const config = loadConfig();
        const addr = config.contracts?.agentIdentity;
        if (!addr) return json(res, { identityId: null, wallet });

        const iface = new ethers.Interface([
          "function identityOf(address) view returns (uint256)",
          "function walletOf(uint256) view returns (address)",
          "function isActive(uint256) view returns (bool)",
          "function metadataOf(uint256) view returns (bytes32)",
          "function timestampsOf(uint256) view returns (uint64,uint64)",
        ]);
        const provider = getProvider();
        const contract = new ethers.Contract(addr, iface, provider);
        const identityId: bigint = await contract.identityOf(wallet);
        if (identityId === 0n) return json(res, { identityId: null, wallet });
        const [wAddr, active, metadata, ts] = await Promise.all([
          contract.walletOf(identityId),
          contract.isActive(identityId),
          contract.metadataOf(identityId),
          contract.timestampsOf(identityId),
        ]);
        return json(res, { identityId: identityId.toString(), wallet: wAddr, active, metadataRoot: metadata, createdAt: Number(ts[0]), updatedAt: Number(ts[1]) });
      } catch (e: any) {
        return json(res, { identityId: null, wallet, error: e.message });
      }
    }

    // ── Identity Registration ────────────────────────────────────────
    if (path === "/api/identity/register" && req.method === "POST") {
      const body = await parseBody(req);
      const { registerIdentity } = await import("../tools/identity");
      const result = await registerIdentity(body.walletAddress, body.metadataRoot);
      return json(res, result, result.success ? 201 : 400);
    }

    if (path === "/api/identity/update-metadata" && req.method === "POST") {
      const body = await parseBody(req);
      const { updateMetadata } = await import("../tools/identity");
      const result = await updateMetadata(body.identityId, body.metadataRoot);
      return json(res, result, result.success ? 200 : 400);
    }

    // ── Sessions ─────────────────────────────────────────────────────
    if (path === "/api/sessions" && req.method === "GET") {
      const wallet = url.searchParams.get("wallet");
      const svc = getSessionService();
      if (wallet) {
        return json(res, svc.listByWallet(wallet));
      }
      return json(res, svc.listAll ? svc.listAll() : []);
    }

    if (path === "/api/sessions/all" && req.method === "GET") {
      const svc = getSessionService();
      return json(res, svc.listAll ? svc.listAll() : []);
    }

    // Prepare a lightweight session: returns params + hash-to-sign so the browser signs the EXACT message the contract expects
    if (path === "/api/sessions/prepare-lightweight" && req.method === "POST") {
      const body = await parseBody(req);
      const { ethers } = await import("ethers");
      const config = (await import("../core/config")).loadConfig();
      const sessionId = ethers.hexlify(ethers.randomBytes(32));
      const expiry = Math.floor(Date.now() / 1000) + (body.expiryDays || 30) * 86400;
      const dailySpendLimit = ethers.parseEther(body.dailySpendLimitEth || "0.1");
      const allowedTargets: string[] = body.allowedTargets || [];

      // Generate a DEDICATED session keypair (unless the caller supplies their own
      // address for a self-custody agent). The public address is what the owner
      // signs over and what SessionManager records as the sessionKey — the agent
      // then signs UserOps with the private key autonomously, no owner key shared.
      const { generateSessionKey, persistSessionKey } = await import("../core/session-keystore");
      const externalKey = body.sessionKey && body.sessionKey !== body.walletAddress ? body.sessionKey : null;
      const genKey = externalKey ? null : generateSessionKey();
      const sessionKeyAddress = externalKey || genKey!.address;
      if (genKey) persistSessionKey(sessionId, genKey.address, genKey.privateKey);

      // Compute the exact messageHash the contract will use:
      // keccak256(abi.encode(chainId, this, msg.sender, sessionId, sessionKey, spend, txLimit, expiry, allowedTargets))
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64", "address[]"],
          [
            config.chainId,
            config.contracts.sessionManager, // address(this) on-chain
            body.walletAddress,               // msg.sender (wallet)
            sessionId,
            sessionKeyAddress,
            dailySpendLimit,
            body.dailyTxLimit || 10,
            expiry,
            allowedTargets,
          ]
        )
      );

      return json(res, {
        success: true,
        sessionId,
        expiry,
        dailySpendLimit: dailySpendLimit.toString(),
        messageHash,
        sessionManagerAddress: config.contracts.sessionManager,
        // Dedicated session key — pass sessionKeyAddress back into create-lightweight-tx.
        sessionKeyAddress,
        sessionPrivateKey: genKey ? genKey.privateKey : undefined,
        runtimeCanSign: !!genKey,
      });
    }

    if (path === "/api/sessions/create-lightweight-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const { logger } = await import("../core/logger");
      logger.info("session-tx", `Creating lightweight session: wallet=${body.walletAddress?.slice(0, 10)} sessionKey=${body.sessionKey?.slice(0, 10)} sessionId=${body.sessionId?.slice(0, 20)} expiry=${body.expiry} dailySpend=${body.dailySpendLimitEth} dailyTx=${body.dailyTxLimit}`);
      const adapter = await import("../blockchain/adapter");
      const result = adapter.encodeLightweightSession({
        walletAddress: body.walletAddress,
        sessionKey: body.sessionKey,
        sessionId: body.sessionId,
        expiry: body.expiry,
        dailySpendLimitEth: body.dailySpendLimitEth || "0.1",
        dailyTxLimit: body.dailyTxLimit || 10,
        expiryDays: body.expiryDays || 30,
        ownerSignature: body.ownerSignature || "0x",
        allowedTargets: body.allowedTargets || [],
      });
      // Log the full encoded call for debugging
      logger.info("session-tx", `Encoded session: to=${result.to} data=${result.data.slice(0, 80)}... sessionId=${result.sessionId.slice(0, 20)} expiry=${result.expiry}`);
      return json(res, { success: true, ...result });
    }

    // Prepare a ZK-proof-gated "standard" session. This is the privacy USP path:
    // the agent's credential proof authorizes the session — no owner signature at all.
    // Generates a real Groth16 proof server-side, then returns wallet.execute calldata
    // wrapping createSession(). The browser only relays the tx from the wallet.
    if (path === "/api/sessions/create-standard-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const { logger } = await import("../core/logger");
      const { generateProof } = await import("../tools/proof");
      const adapter = await import("../blockchain/adapter");

      const sessionExpiry = body.sessionExpiry || Math.floor(Date.now() / 1000) + (body.expiryDays || 30) * 86400;
      const sessionNonce = body.sessionNonce ? BigInt(body.sessionNonce) : BigInt(Math.floor(Date.now() / 1000));

      logger.info(
        "session-tx",
        `Preparing ZK session: org=${body.organizationId} agent=${body.agentId} wallet=${String(body.walletAddress).slice(0, 10)} expiry=${sessionExpiry}`
      );

      // 1. Generate the real Groth16 proof (membership + non-revocation + budget/expiry bounds).
      const proofResult = await generateProof(
        body.organizationId,
        body.agentId,
        body.walletAddress,
        sessionExpiry,
        sessionNonce,
        body.maxValue
      );
      if (!proofResult.success || !proofResult.calldata) {
        return json(res, { success: false, error: proofResult.error || "Proof generation failed" }, 400);
      }

      // 2. maxValue must equal publicSignals[2] (the value the proof committed to).
      const maxValue = proofResult.maxValue!;

      // 3. Generate a DEDICATED session keypair. The public address is the on-chain
      //    sessionKey; the agent signs UserOps with the private key autonomously —
      //    the owner key is never shared. Caller may override with an externally
      //    generated key (self-custody agent) by passing body.sessionKey as an address.
      const { generateSessionKey } = await import("../core/session-keystore");
      const externalSessionKey = body.sessionKey && body.sessionKey !== body.walletAddress ? body.sessionKey : null;
      const generatedKey = externalSessionKey ? null : generateSessionKey();
      const sessionKeyAddress = externalSessionKey || generatedKey!.address;

      // 4. Encode wallet.execute(sessionManager, 0, createSession(...proof...)).
      const encoded = adapter.encodeStandardSession({
        walletAddress: body.walletAddress,
        sessionKey: sessionKeyAddress,
        maxValue,
        expiry: sessionExpiry,
        proof: proofResult.calldata,
      });

      // 5. Persist the encrypted private key bound to this session so the runtime
      //    can sign on the agent's behalf. Only when we generated it ourselves.
      if (generatedKey) {
        const { persistSessionKey } = await import("../core/session-keystore");
        persistSessionKey(encoded.sessionId, generatedKey.address, generatedKey.privateKey);
      }

      logger.info(
        "session-tx",
        `Encoded ZK session: to=${encoded.to} sessionId=${encoded.sessionId.slice(0, 20)} nullifier=${String(proofResult.nullifier).slice(0, 20)}`
      );

      return json(res, {
        success: true,
        ...encoded,
        maxValue,
        nullifier: proofResult.nullifier,
        proofHash: proofResult.proofHash,
        activeRoot: proofResult.activeRoot,
        revokedRoot: proofResult.revokedRoot,
        // The dedicated session key. Address is registered on-chain; the private
        // key is returned ONCE for a self-custody agent (also stored encrypted so
        // the runtime can sign). Null when the caller supplied their own key.
        sessionKeyAddress,
        sessionPrivateKey: generatedKey ? generatedKey.privateKey : undefined,
        runtimeCanSign: !!generatedKey,
      });
    }

    if (path === "/api/sessions" && req.method === "POST") {
      const raw = await parseBody(req);
      const body = validateBody(res, SessionCreateRequestSchema, raw);
      if (!body) return;
      const sessionKey = body.sessionKey || body.ownerAddress;
      if (!sessionKey) {
        return json(res, { success: false, error: "Validation failed", errors: ["sessionKey or ownerAddress is required"] }, 400);
      }
      const svc = getSessionService();
      const session = svc.create(
        body.walletAddress,
        sessionKey,
        body.organizationId,
        1,
        body.dailySpendLimit || "0.1",
        body.dailyTxLimit || 10,
        body.expiry || Math.floor(Date.now() / 1000) + 30 * 86400
      );
      return json(res, { success: true, session }, 201);
    }

    if (path === "/api/sessions" && req.method === "DELETE") {
      const raw = await parseBody(req);
      const body = validateBody(res, SessionRevokeSchema, raw);
      if (!body) return;
      const svc = getSessionService();
      const result = svc.revoke(body.sessionId, body.walletAddress);
      // Purge the stored session key on revoke to minimize key exposure — a
      // revoked session can never sign again, so its key is dead weight/risk.
      if (result.success && body.sessionId) {
        try {
          const { purgeSessionKey } = await import("../core/session-keystore");
          purgeSessionKey(body.sessionId);
        } catch { /* non-fatal */ }
      }
      return json(res, result, result.success ? 200 : 400);
    }

    // ── Proofs ───────────────────────────────────────────────────────
    if (path === "/api/proofs" && req.method === "GET") {
      const svc = getProofService();
      return json(res, svc.list(50));
    }

    // ── Runtimes (company self-hosted models) ────────────────────────
    if (path === "/api/runtimes" && req.method === "GET") {
      const orgId = url.searchParams.get("orgId");
      let rows;
      if (orgId) {
        rows = runQuery("SELECT * FROM runtimes WHERE organization_id = ? ORDER BY created_at DESC", orgId);
      } else {
        rows = runQuery("SELECT * FROM runtimes ORDER BY created_at DESC");
      }
      return json(res, rows);
    }

    if (path === "/api/runtimes" && req.method === "POST") {
      const body = await parseBody(req);
      const { generateId } = await import("../../packages/shared/utils");
      const runtimeId = `rt_${generateId()}`;
      runExecute(
        "INSERT INTO runtimes (id, organization_id, name, endpoint, model_name, api_key_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        runtimeId, body.organizationId, body.name, body.endpoint, body.modelName || '', body.apiKeyHash || '', 'active'
      );
      return json(res, { success: true, id: runtimeId }, 201);
    }

    if (path === "/api/runtimes" && req.method === "DELETE") {
      const body = await parseBody(req);
      runExecute("DELETE FROM runtimes WHERE id = ?", body.id);
      return json(res, { success: true });
    }

    if (path === "/api/runtimes/health" && req.method === "POST") {
      const body = await parseBody(req);
      try {
        const resp = await fetch(body.endpoint + "/health", { signal: AbortSignal.timeout(5000) });
        const healthy = resp.ok;
        runExecute("UPDATE runtimes SET status = ?, last_health_check = ? WHERE id = ?",
          healthy ? 'active' : 'unhealthy', Math.floor(Date.now() / 1000), body.id);
        return json(res, { success: true, healthy, status: healthy ? 'active' : 'unhealthy' });
      } catch (e: any) {
        runExecute("UPDATE runtimes SET status = ?, last_health_check = ? WHERE id = ?",
          'unreachable', Math.floor(Date.now() / 1000), body.id);
        return json(res, { success: true, healthy: false, status: 'unreachable', error: e.message });
      }
    }

    // ── Actions ──────────────────────────────────────────────────────
    if (path === "/api/actions" && req.method === "GET") {
      const actions = runQuery("SELECT * FROM agent_actions ORDER BY timestamp DESC LIMIT 100");
      return json(res, actions);
    }

    // ── Events ───────────────────────────────────────────────────────
    if (path === "/api/events" && req.method === "GET") {
      const bus = getEventBus();
      const limit = parseInt(url.searchParams.get("limit") || "100", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const typeFilter = url.searchParams.get("type");
      const contractFilter = url.searchParams.get("contract");
      const fromBlock = url.searchParams.get("fromBlock") ? parseInt(url.searchParams.get("fromBlock")!) : undefined;
      const toBlock = url.searchParams.get("toBlock") ? parseInt(url.searchParams.get("toBlock")!) : undefined;

      // 1. On-chain indexed events
      let onchainEvents: any[] = [];
      try {
        const { getIndexedEvents } = await import("../core/event-indexer");
        const rows = getIndexedEvents({
          contractName: contractFilter || undefined,
          eventName: typeFilter && typeFilter !== "all" ? typeFilter : undefined,
          fromBlock,
          toBlock,
          limit: 500,
        });
        onchainEvents = rows.map((r: any) => ({
          source: "onchain",
          type: r.event_name,
          contractName: r.contract_name,
          contractAddress: r.contract_address,
          blockNumber: r.block_number,
          txHash: r.tx_hash,
          logIndex: r.log_index,
          args: JSON.parse(r.args || "{}"),
          timestamp: r.timestamp,
          _id: `chain-${r.tx_hash}-${r.log_index}`,
        }));
      } catch {}

      // 2. Local DB events (WalletCreated, SessionCreated, etc.)
      let dbEvents: any[] = [];
      try {
        const rows = runQuery("SELECT * FROM events ORDER BY created_at DESC LIMIT 500");
        dbEvents = rows.map((r: any) => ({
          source: "local",
          type: r.event_type,
          data: JSON.parse(r.data || "{}"),
          txHash: r.tx_hash,
          blockNumber: r.block_number,
          timestamp: r.created_at,
          _id: `db-${r.id}`,
        }));
      } catch {}

      // 3. In-memory bus events
      const busEvents = bus.getHistory(1000).map((e: any) => ({
        source: "bus",
        ...e,
        _id: e._id || `bus-${e.type}-${e.timestamp || ""}`,
        timestamp: e.timestamp && e.timestamp > 1e12 ? Math.floor(e.timestamp / 1000) : e.timestamp,
      }));

      // Merge all, deduplicate by _id
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const ev of [...onchainEvents, ...dbEvents, ...busEvents]) {
        const key = ev._id;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(ev);
        }
      }

      // Apply filters
      let filtered = merged;
      if (typeFilter && typeFilter !== "all") {
        filtered = filtered.filter((e: any) => e.type === typeFilter);
      }
      if (contractFilter) {
        filtered = filtered.filter((e: any) =>
          e.contractName === contractFilter ||
          e.source !== "onchain"
        );
      }

      // Sort by timestamp desc
      filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Paginate
      const paged = filtered.slice(offset, offset + limit);

      return json(res, { events: paged, total: filtered.length, offset, limit });
    }

    // ── Events Indexer Control ──────────────────────────────────────
    if (path === "/api/events/indexer/status" && req.method === "GET") {
      const { getIndexerStatus, getIndexedEventStats } = await import("../core/event-indexer");
      return json(res, { ...getIndexerStatus(), ...getIndexedEventStats() });
    }

    if (path === "/api/events/indexer/run" && req.method === "POST") {
      const { runIndexer } = await import("../core/event-indexer");
      const result = await runIndexer();
      return json(res, result);
    }

    if (path === "/api/events/indexer/reindex" && req.method === "POST") {
      const body = await parseBody(req);
      const { reindexFromBlock } = await import("../core/event-indexer");
      const fromBlock = body.fromBlock || 43_500_000; // Default to genesis block
      const result = await reindexFromBlock(fromBlock);
      return json(res, result);
    }

    if (path === "/api/events/indexer/reproduce" && req.method === "POST") {
      const { reproduceLocalState } = await import("../core/event-indexer");
      const result = await reproduceLocalState();
      return json(res, result);
    }

    // ── Capabilities ──────────────────────────────────────────────────
    if (path === "/api/capabilities" && req.method === "GET") {
      const caps = runQuery("SELECT * FROM capabilities ORDER BY created_at DESC");
      return json(res, caps);
    }

    if (path === "/api/capabilities" && req.method === "POST") {
      const raw = await parseBody(req);
      const body = validateBody(res, CapabilityCreateSchema, raw);
      if (!body) return;
      const { ethers } = await import("ethers");
      const capId = `cap_${ethers.hexlify(ethers.randomBytes(16)).slice(2)}`;
      const hash = ethers.keccak256(ethers.toUtf8Bytes(body.name));
      runExecute(
        "INSERT INTO capabilities (capability_id, organization_id, name, description, hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, unixepoch())",
        capId, body.organizationId || "global", body.name, body.description || "", hash
      );
      const bus = getEventBus();
      bus.emit({ type: "CapabilityRegistered", data: { capabilityId: capId, name: body.name } });
      return json(res, { success: true, capabilityId: capId }, 201);
    }

    // ── Delegations ──────────────────────────────────────────────────
    if (path === "/api/delegations" && req.method === "GET") {
      const dels = runQuery("SELECT * FROM delegations ORDER BY created_at DESC");
      return json(res, dels);
    }

    if (path === "/api/delegations" && req.method === "POST") {
      const raw = await parseBody(req);
      const body = validateBody(res, DelegationRequestSchema, raw);
      if (!body) return;
      const { ethers } = await import("ethers");
      const delId = `del_${ethers.hexlify(ethers.randomBytes(16)).slice(2)}`;
      runExecute(
        "INSERT INTO delegations (delegation_id, organization_id, delegator, delegatee, scope, max_value, expiry, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())",
        delId, body.organizationId || "global", body.delegator, body.delegatee, body.scope, body.maxValue || "0", body.expiry || Math.floor(Date.now() / 1000) + 86400 * 30
      );
      return json(res, { success: true, delegationId: delId }, 201);
    }

    // ── Anomalies ────────────────────────────────────────────────────
    if (path === "/api/anomalies" && req.method === "GET") {
      const anomalies: any[] = [];

      // 1. Expired sessions still marked active
      try {
        const expired = runQuery(
          "SELECT session_id, wallet_address, expiry FROM sessions WHERE revoked = 0 AND expiry < unixepoch()"
        );
        for (const s of expired) {
          anomalies.push({
            severity: "medium",
            type: "Expired session",
            description: `Session ${s.session_id.slice(0, 16)}... has expired but was not revoked`,
            affected_resource: s.session_id,
            wallet_address: s.wallet_address,
            detected_at: Math.floor(Date.now() / 1000),
            resolved: false,
          });
        }
      } catch {}

      // 2. Credentials expiring soon (within 7 days)
      try {
        const expiring = runQuery(
          "SELECT credential_id, organization_id, agent_id, expiry FROM credentials WHERE revoked = 0 AND expiry < unixepoch() + 604800 AND expiry > unixepoch()"
        );
        for (const c of expiring) {
          anomalies.push({
            severity: "low",
            type: "Credential expiring",
            description: `Credential for agent #${c.agent_id} in org ${c.organization_id} expires within 7 days`,
            affected_resource: c.credential_id,
            detected_at: Math.floor(Date.now() / 1000),
            resolved: false,
          });
        }
      } catch {}

      // 3. Revoked credentials (potential security events)
      try {
        const revoked = runQuery(
          "SELECT credential_id, organization_id, agent_id, revoked_at FROM credentials WHERE revoked = 1 AND revoked_at > unixepoch() - 86400"
        );
        for (const c of revoked) {
          anomalies.push({
            severity: "high",
            type: "Credential revoked",
            description: `Credential for agent #${c.agent_id} in org ${c.organization_id} was revoked`,
            affected_resource: c.credential_id,
            detected_at: c.revoked_at,
            resolved: true,
          });
        }
      } catch {}

      // 4. Failed agent actions
      try {
        const failed = runQuery(
          "SELECT id, tool, wallet_address, failure_reason, timestamp FROM agent_actions WHERE success = 0 AND timestamp > unixepoch() - 86400"
        );
        for (const a of failed) {
          anomalies.push({
            severity: "medium",
            type: "Action failed",
            description: `Agent action '${a.tool}' failed: ${a.failure_reason || "unknown reason"}`,
            affected_resource: `action_${a.id}`,
            wallet_address: a.wallet_address,
            detected_at: a.timestamp,
            resolved: false,
          });
        }
      } catch {}

      // 5. Wallets without identity
      try {
        const wallets = runQuery("SELECT wallet_address FROM wallets");
        for (const w of wallets) {
          try {
            const config = loadConfig();
            if (!config.contracts?.agentIdentity) continue;
            const { getProvider } = await import("../core/provider");
            const { ethers } = await import("ethers");
            const iface = new ethers.Interface(["function identityOf(address) view returns (uint256)"]);
            const provider = getProvider();
            const contract = new ethers.Contract(config.contracts.agentIdentity, iface, provider);
            const id = await contract.identityOf(w.wallet_address);
            if (id === 0n) {
              anomalies.push({
                severity: "low",
                type: "No identity",
                description: `Wallet ${w.wallet_address.slice(0, 10)}... has no on-chain identity`,
                affected_resource: w.wallet_address,
                detected_at: Math.floor(Date.now() / 1000),
                resolved: false,
              });
            }
          } catch {}
        }
      } catch {}

      // Sort by severity (critical > high > medium > low) then by time
      const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      anomalies.sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9) || (b.detected_at || 0) - (a.detected_at || 0));

      return json(res, anomalies);
    }

    // ── Transactions ────────────────────────────────────────────────
    if (path === "/api/transactions" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);

      // Get locally recorded transactions
      let localTxs: any[] = [];
      try { localTxs = runQuery("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?", limit); } catch {}

      // Get on-chain indexed events that represent transactions
      let onchainTxs: any[] = [];
      try {
        const { getIndexedEvents } = await import("../core/event-indexer");
        const rows = getIndexedEvents({ limit });
        onchainTxs = rows.map((r: any) => {
          const args = JSON.parse(r.args || '{}');
          return {
            tx_hash: r.tx_hash,
            wallet_address: args.wallet || args.walletAddress || args.owner || null,
            to_address: r.contract_address,
            value: '0',
            status: 'confirmed',
            block_number: r.block_number,
            gas_used: null,
            created_at: r.timestamp,
            event_name: r.event_name,
            contract_name: r.contract_name,
            args,
            source: 'onchain',
          };
        });
      } catch {}

      // Merge: local transactions are source of truth (they have correct to_address),
      // on-chain events fill in gaps for txs not recorded locally
      const localByHash = new Map<string, any>();
      for (const tx of localTxs) {
        if (tx.tx_hash) localByHash.set(tx.tx_hash, tx);
      }
      const merged: any[] = [...localTxs];
      for (const tx of onchainTxs) {
        if (tx.tx_hash && !localByHash.has(tx.tx_hash)) {
          merged.push(tx);
        } else if (!tx.tx_hash) {
          merged.push(tx);
        }
      }

      merged.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return json(res, merged.slice(0, limit));
    }

    // ── Backups ──────────────────────────────────────────────────────
    if (path === "/api/backups" && req.method === "GET") {
      const config = loadConfig();
      const engine = new BackupEngine(config.backup.path);
      return json(res, engine.list());
    }

    if (path === "/api/backups" && req.method === "POST") {
      const config = loadConfig();
      const engine = new BackupEngine(config.backup.path);
      const body = await parseBody(req);
      const backup = engine.create(body.description);
      return json(res, backup, 201);
    }

    // ── x402 Payments ────────────────────────────────────────────────
    if (path === "/api/x402/payments" && req.method === "GET") {
      const { getPaymentHistory } = await import("../core/x402-client");
      const limit = parseInt(url.searchParams.get("limit") || "50");
      return json(res, getPaymentHistory(limit));
    }

    if (path === "/api/x402/stats" && req.method === "GET") {
      const { getPaymentStats } = await import("../core/x402-client");
      return json(res, getPaymentStats());
    }

    if (path === "/api/x402/policy" && req.method === "GET") {
      const { getPaymentPolicy } = await import("../core/x402-client");
      return json(res, getPaymentPolicy());
    }

    if (path === "/api/x402/policy" && req.method === "POST") {
      const body = await parseBody(req);
      const { savePaymentPolicy } = await import("../core/x402-client");
      savePaymentPolicy(body);
      return json(res, { success: true });
    }

    if (path === "/api/x402/seller/stats" && req.method === "GET") {
      const { getSellerStats } = await import("../core/x402-seller");
      return json(res, getSellerStats());
    }

    if (path === "/api/x402/seller/routes" && req.method === "GET") {
      const { protectedRoutes } = await import("../core/x402-seller");
      const routes: any[] = [];
      for (const [pattern, config] of protectedRoutes) {
        routes.push({ pattern, ...config });
      }
      return json(res, routes);
    }

    if (path === "/api/x402/seller/routes" && req.method === "POST") {
      const body = await parseBody(req);
      const { protectRoute } = await import("../core/x402-seller");
      protectRoute(body.pattern, { price: body.price, description: body.description, mimeType: body.mimeType });
      return json(res, { success: true });
    }

    if (path === "/api/x402/buy" && req.method === "POST") {
      const body = await parseBody(req);
      const { fetchWithPayment } = await import("../core/x402-client");
      try {
        const { response, payment } = await fetchWithPayment(body.url, {
          method: body.method || "GET",
          headers: body.headers || {},
        }, {
          walletAddress: body.walletAddress, // Agent's ERC-4337 wallet address
          autoPay: body.autoPay !== false,
        });
        const responseBody = await response.text();
        return json(res, {
          success: payment?.success ?? true,
          status: response.status,
          payment,
          body: responseBody,
        });
      } catch (e: any) {
        return json(res, { success: false, error: e.message }, 400);
      }
    }

    if (path === "/api/x402/balance" && req.method === "GET") {
      const walletAddress = url.searchParams.get("wallet");
      if (!walletAddress) return json(res, { error: "wallet param required" }, 400);
      const { getUsdcBalance } = await import("../core/x402-client");
      const balance = await getUsdcBalance(walletAddress);
      return json(res, { wallet: walletAddress, balance });
    }

    if (path === "/api/x402/vouchers/stats" && req.method === "GET") {
      const { getVoucherStats } = await import("../core/x402-voucher");
      return json(res, getVoucherStats());
    }

    if (path === "/api/x402/vouchers/pending" && req.method === "GET") {
      const { getPendingVouchers } = await import("../core/x402-voucher");
      const limit = parseInt(url.searchParams.get("limit") || "50");
      return json(res, getPendingVouchers(limit));
    }

    if (path === "/api/x402/vouchers/settle" && req.method === "POST") {
      const { getPendingVouchers, settleVoucherBatch } = await import("../core/x402-voucher");
      const vouchers = getPendingVouchers();
      if (vouchers.length === 0) return json(res, { success: true, message: "No pending vouchers" });
      const result = await settleVoucherBatch(vouchers);
      return json(res, result);
    }

    if (path === "/api/x402/batch" && req.method === "POST") {
      const body = await parseBody(req);
      const { executeBatchPaid } = await import("../core/x402-batch");
      const { ethers } = await import("ethers");
      try {
        const sessionKeyWallet = new ethers.Wallet(body.sessionKey);
        const result = await executeBatchPaid(
          body.requests,
          body.agentWallet,
          sessionKeyWallet,
          { maxTotalUsd: body.maxTotalUsd, voucherExpirySeconds: body.voucherExpirySeconds }
        );
        return json(res, result);
      } catch (e: any) {
        return json(res, { success: false, error: e.message }, 400);
      }
    }

    // ── Contracts ────────────────────────────────────────────────────
    if (path === "/api/contracts" && req.method === "GET") {
      const guard = getProxyGuard();
      return json(res, guard.listAllProxies());
    }

    // ── Contract Registry (ABI extraction, functions, events, selectors) ──
    if (path === "/api/contracts/registry" && req.method === "GET") {
      const { getContractRegistry } = await import("../core/contract-calls");
      return json(res, getContractRegistry());
    }

    if (path === "/api/contracts/functions" && req.method === "GET") {
      const contractName = url.searchParams.get("contract");
      if (!contractName) return json(res, { error: "Contract name required" }, 400);
      const { extractFunctions, extractEvents, getFunctionSelector } = await import("../core/contract-calls");
      try {
        const functions = extractFunctions(contractName);
        const events = extractEvents(contractName);
        return json(res, {
          contract: contractName,
          functions: functions.map((f) => ({
            name: f.name,
            inputs: f.inputs.map((i) => ({ name: i.name, type: i.type })),
            outputs: f.outputs.map((o) => ({ name: o.name, type: o.type })),
            stateMutability: f.stateMutability,
            selector: getFunctionSelector(contractName, f.name),
          })),
          events: events.map((e) => ({
            name: e.name,
            inputs: e.inputs,
          })),
        });
      } catch (e: any) {
        return json(res, { error: e.message }, 400);
      }
    }

    // ── Typed Contract Call (read) ──────────────────────────────────
    if (path === "/api/contracts/read" && req.method === "POST") {
      const body = await parseBody(req);
      const { callContractRead } = await import("../core/contract-calls");
      try {
        const result = await callContractRead(
          body.contract,
          body.function,
          body.args || [],
          body.address
        );
        return json(res, {
          success: true,
          value: typeof result.value === "bigint" ? result.value.toString() : result.value,
          raw: result.raw,
        });
      } catch (e: any) {
        return json(res, { success: false, error: e.message }, 400);
      }
    }

    // ── Typed Contract Call (prepare write) ─────────────────────────
    if (path === "/api/contracts/prepare-write" && req.method === "POST") {
      const body = await parseBody(req);
      const { prepareContractWrite, prepareWalletWrite } = await import("../core/contract-calls");
      try {
        let tx;
        if (body.contract === "AgentWallet" && body.walletAddress) {
          tx = prepareWalletWrite(body.walletAddress, body.function, body.args || [], { value: body.value });
        } else {
          tx = prepareContractWrite(body.contract, body.function, body.args || [], { value: body.value });
        }
        return json(res, { success: true, ...tx });
      } catch (e: any) {
        return json(res, { success: false, error: e.message }, 400);
      }
    }

    // ── Trees ────────────────────────────────────────────────────────
    if (path === "/api/trees" && req.method === "GET") {
      const orgId = url.searchParams.get("orgId") || "standalone";
      const { getActiveTree } = await import("../trees/active-tree");
      const { getRevokedTree } = await import("../trees/revoked-tree");
      const active = await getActiveTree(orgId);
      const revoked = await getRevokedTree(orgId);
      return json(res, {
        organizationId: orgId,
        activeRoot: active.getRoot(),
        activeEpoch: active.getEpoch(),
        activeLeaves: active.getLeafCount(),
        revokedRoot: revoked.getRoot(),
        revokedEpoch: revoked.getEpoch(),
      });
    }

    if (path === "/api/trees/all" && req.method === "GET") {
      const orgService = getOrganizationService();
      const orgs = orgService.list();
      const { getActiveTree } = await import("../trees/active-tree");
      const { getRevokedTree } = await import("../trees/revoked-tree");

      const results: any[] = [];
      const processed = new Set<string>();

      const standaloneActive = await getActiveTree("standalone");
      const standaloneRevoked = await getRevokedTree("standalone");
      if (standaloneActive.getLeafCount() > 0 || standaloneRevoked.getEpoch() > 0) {
        results.push({
          organizationId: "standalone",
          name: "Standalone (No Org)",
          activeRoot: standaloneActive.getRoot(),
          activeEpoch: standaloneActive.getEpoch(),
          activeLeaves: standaloneActive.getLeafCount(),
          revokedRoot: standaloneRevoked.getRoot(),
          revokedEpoch: standaloneRevoked.getEpoch(),
          revokedLeaves: 0,
        });
      }
      processed.add("standalone");

      for (const org of orgs) {
        if (processed.has(org.id)) continue;
        processed.add(org.id);
        const active = await getActiveTree(org.id);
        const revoked = await getRevokedTree(org.id);
        results.push({
          organizationId: org.id,
          name: org.name,
          activeRoot: active.getRoot(),
          activeEpoch: active.getEpoch(),
          activeLeaves: active.getLeafCount(),
          revokedRoot: revoked.getRoot(),
          revokedEpoch: revoked.getEpoch(),
          revokedLeaves: 0,
        });
      }

      return json(res, { value: results });
    }

    // ── Tree Management ──────────────────────────────────────────────
    if (path === "/api/trees/export" && req.method === "GET") {
      const orgId = url.searchParams.get("orgId") || "standalone";
      const { getActiveTree } = await import("../trees/active-tree");
      const { getRevokedTree } = await import("../trees/revoked-tree");
      const active = await getActiveTree(orgId);
      const revoked = await getRevokedTree(orgId);
      const activeData = await active.exportTree();
      const revokedData = await revoked.exportTree();
      return json(res, { active: JSON.parse(activeData), revoked: JSON.parse(revokedData) });
    }

    if (path === "/api/trees/import" && req.method === "POST") {
      const body = await parseBody(req);
      const { getActiveTree } = await import("../trees/active-tree");
      const { getRevokedTree } = await import("../trees/revoked-tree");
      const active = await getActiveTree(body.organizationId);
      const revoked = await getRevokedTree(body.organizationId);
      if (body.active) await active.importTree(JSON.stringify(body.active));
      if (body.revoked) await revoked.importTree(JSON.stringify(body.revoked));
      return json(res, { success: true, organizationId: body.organizationId });
    }

    if (path === "/api/trees/verify" && req.method === "GET") {
      const orgId = url.searchParams.get("orgId") || "standalone";
      const { getActiveTree } = await import("../trees/active-tree");
      const { getRevokedTree } = await import("../trees/revoked-tree");
      const active = await getActiveTree(orgId);
      const revoked = await getRevokedTree(orgId);
      const activeVerification = active.verifyConsistency();
      const revokedVerification = revoked.verifyConsistency();
      const snapshotIntegrity = active.verifySnapshotIntegrity();
      return json(res, {
        organizationId: orgId,
        active: activeVerification,
        revoked: revokedVerification,
        snapshot: snapshotIntegrity,
        valid: activeVerification.valid && revokedVerification.valid && snapshotIntegrity.valid,
      });
    }

    if (path === "/api/trees/snapshots" && req.method === "GET") {
      const orgId = url.searchParams.get("orgId") || "standalone";
      const { getActiveTree } = await import("../trees/active-tree");
      const active = await getActiveTree(orgId);
      const snapshots = active.listSnapshots();
      return json(res, { organizationId: orgId, snapshots });
    }

    if (path === "/api/trees/rebuild" && req.method === "POST") {
      const body = await parseBody(req);
      const { getActiveTree } = await import("../trees/active-tree");
      const { getRevokedTree } = await import("../trees/revoked-tree");
      const active = await getActiveTree(body.organizationId);
      const revoked = await getRevokedTree(body.organizationId);
      // Force rebuild from credentials
      await active.initialize();
      await revoked.initialize();
      return json(res, { 
        success: true, 
        organizationId: body.organizationId,
        activeRoot: active.getRoot(),
        activeLeaves: active.getLeafCount(),
        revokedRoot: revoked.getRoot(),
        revokedCount: revoked.getRevokedCount(),
      });
    }

    // ── Diagnostics ──────────────────────────────────────────────────
    if (path === "/api/diagnostics" && req.method === "GET") {
      const { runFullDiagnostics } = await import("../tools/wizard");
      const result = await runFullDiagnostics();
      return json(res, result);
    }

    // ── Config ───────────────────────────────────────────────────────
    if (path === "/api/config" && req.method === "GET") {
      const config = loadConfig();
      return json(res, config);
    }

    if (path === "/api/config" && req.method === "PUT") {
      const raw = await parseBody(req);
      const body = validateBody(res, ConfigUpdateSchema, raw);
      if (!body) return;
      const { saveConfig } = await import("../core/config");
      saveConfig(body);
      return json(res, { success: true });
    }

    // ── Compiler ─────────────────────────────────────────────────────
    if (path === "/api/compile" && req.method === "POST") {
      const body = await parseBody(req);
      const { getCompiler } = await import("../../packages/compiler");
      const compiler = getCompiler();
      const contractAddresses = loadConfig().contracts as Record<string, string>;
      const result = await compiler.compile(body, {
        walletAddress: body.walletAddress,
        sessionId: body.sessionId,
        agentIdentityId: body.identityId,
        organizationId: body.organizationId,
      }, contractAddresses);
      return json(res, result);
    }

    // NOTE: `GET /api/plans` (list) is handled earlier via the compiler gateway.
    // This block only handles plan-detail / lifecycle sub-routes.
    if (path.startsWith("/api/plans/") && req.method === "GET") {
      const planId = path.split("/api/plans/")[1];
      if (!planId) return json(res, { error: "Plan ID required" }, 400);
      const { getCompiler } = await import("../../packages/compiler");
      const plan = getCompiler().getPlan(planId);
      if (!plan) return json(res, { error: "Plan not found" }, 404);
      return json(res, plan);
    }

    if (path.startsWith("/api/plans/") && path.endsWith("/approve") && req.method === "POST") {
      const planId = path.split("/api/plans/")[1].replace("/approve", "");
      const { getCompiler } = await import("../../packages/compiler");
      const plan = getCompiler().approvePlan(planId);
      if (!plan) return json(res, { error: "Plan not found or not in APPROVAL_REQUIRED state" }, 400);
      return json(res, plan);
    }

    if (path.startsWith("/api/plans/") && path.endsWith("/reject") && req.method === "POST") {
      const planId = path.split("/api/plans/")[1].replace("/reject", "");
      const body = await parseBody(req);
      const { getCompiler } = await import("../../packages/compiler");
      const plan = getCompiler().rejectPlan(planId, body.reason || "Rejected by user");
      if (!plan) return json(res, { error: "Plan not found" }, 404);
      return json(res, plan);
    }

    if (path === "/api/execute-plan" && req.method === "POST") {
      const body = await parseBody(req);
      const { getCompiler } = await import("../../packages/compiler");
      const plan = getCompiler().executePlan(body.planId);
      if (!plan) return json(res, { error: "Plan not found or not in APPROVED state" }, 400);
      return json(res, { planId: plan.planId, status: plan.status, message: "Plan marked for execution" });
    }

    if (path === "/api/compiler/cache/prune" && req.method === "POST") {
      const { getCompiler } = await import("../../packages/compiler");
      const removed = getCompiler().pruneCache();
      return json(res, { removed });
    }

    // ── ZK Proofs ────────────────────────────────────────────────────
    if (path === "/api/proofs/generate" && req.method === "POST") {
      const body = await parseBody(req);
      const { generateProof } = await import("../tools/proof");
      const sessionNonce = body.sessionNonce ? BigInt(body.sessionNonce) : BigInt(Math.floor(Date.now() / 1000));
      const sessionExpiry = body.sessionExpiry || Math.floor(Date.now() / 1000) + 86400;
      const result = await generateProof(
        body.organizationId,
        body.agentId,
        body.walletAddress,
        sessionExpiry,
        sessionNonce,
        body.maxValue
      );
      return json(res, result, result.success ? 200 : 400);
    }

    if (path === "/api/proofs/verify" && req.method === "POST") {
      const body = await parseBody(req);
      const { verifyProof } = await import("../tools/proof");
      const result = await verifyProof(body.proofHash);
      return json(res, result);
    }

    if (path === "/api/proofs/artifacts" && req.method === "GET") {
      const { verifyArtifacts, verifyIntegrity, loadManifest, ZKEY_PATH, WASM_PATH, VK_PATH, MANIFEST_PATH } =
        await import("../core/zk-prover");
      const { existsSync } = await import("fs");
      const art = verifyArtifacts();
      const integ = verifyIntegrity();
      const manifest = loadManifest();
      return json(res, {
        ok: art.ok,
        missing: art.missing,
        integrity: {
          ok: integ.ok,
          manifestUsed: integ.manifestUsed,
          errors: integ.errors,
          checks: integ.checks,
        },
        manifest: manifest
          ? { circuit: manifest.circuit, curve: manifest.curve, nPublic: manifest.nPublic, generatedAt: manifest.generatedAt }
          : null,
        paths: { zkey: ZKEY_PATH, wasm: WASM_PATH, vk: VK_PATH, manifest: MANIFEST_PATH },
        zkeyExists: existsSync(ZKEY_PATH),
        wasmExists: existsSync(WASM_PATH),
        vkExists: existsSync(VK_PATH),
      });
    }

    json(res, { error: "Not found" }, 404);
  } catch (e: any) {
    // Log the full error server-side, but return a generic message to the client.
    // Leaking raw internals (e.g. SQL constraint text) is an info-disclosure risk
    // and unhelpful to callers. A correlation id ties the response to the log line.
    const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    console.error(`[${errorId}] ${req.method} ${req.url}:`, e?.stack || e?.message || e);
    json(res, { error: "Internal server error", errorId }, 500);
  }
});

// Discover a free port near PREFERRED_PORT, bind there, and publish the actual
// port to the runtime manifest so the dashboard (and any other local client)
// can find the API without a hardcoded port.
(async () => {
  const { findFreePort, writeRuntimeManifest } = await import("../core/ports");
  try {
    BOUND_PORT = await findFreePort(PREFERRED_PORT, HOST);
  } catch {
    BOUND_PORT = PREFERRED_PORT; // fall back to preferred; listen() will surface any error
  }

  server.listen(BOUND_PORT, HOST, () => {
    if (BOUND_PORT !== PREFERRED_PORT) {
      console.log(
        `AgentIX API: preferred port ${PREFERRED_PORT} was busy, using ${BOUND_PORT} instead.`
      );
    }
    console.log(`AgentIX API running on http://${HOST}:${BOUND_PORT}`);

    // Record where we actually landed so the dashboard can proxy /api to us.
    try {
      writeRuntimeManifest({ apiPort: BOUND_PORT, host: HOST, apiPid: process.pid });
    } catch (e: any) {
      console.warn(`Could not write runtime manifest: ${e.message}`);
    }

    // Start the on-chain event indexer
    try {
      const { startIndexer } = require("../core/event-indexer");
      startIndexer();
    } catch (e: any) {
      console.warn(`Event indexer failed to start: ${e.message}`);
    }
  });

  server.on("error", (e: any) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        `AgentIX API could not bind port ${BOUND_PORT} (in use). ` +
          `Set AGENTIX_API_PORT to a free port and retry.`
      );
    } else {
      console.error(`AgentIX API server error: ${e.message}`);
    }
    process.exit(1);
  });
})();

// Graceful shutdown: stop the polling indexer, stop accepting connections, and
// close the SQLite handle so WAL is checkpointed cleanly. Without this, Ctrl+C
// left the indexer interval dangling and the DB potentially mid-write.
let _shuttingDown = false;
function shutdown(signal: string) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    const { stopIndexer } = require("../core/event-indexer");
    stopIndexer();
  } catch { /* indexer may not have started */ }

  // Force-exit if the close hangs (e.g. a stuck keep-alive socket).
  const forceTimer = setTimeout(() => {
    console.warn("Shutdown timed out, forcing exit.");
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  // Clear the runtime manifest so stale port info doesn't mislead the dashboard
  // after we're gone.
  try {
    const { clearRuntimeManifest } = require("../core/ports");
    clearRuntimeManifest();
  } catch { /* best-effort */ }

  server.close(() => {
    try {
      const { closeDatabase } = require("../core/database");
      closeDatabase();
    } catch { /* db may already be closed */ }
    clearTimeout(forceTimer);
    console.log("Shutdown complete.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
