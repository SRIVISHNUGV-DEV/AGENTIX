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

const PORT = parseInt(process.env.AGENTIX_DASHBOARD_PORT || "3001", 10);

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
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
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

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // ── Health & Status ──────────────────────────────────────────────
    if (path === "/api/health") {
      return json(res, { status: "ok", version: "1.0.0", uptime: process.uptime() });
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
      return json(res, {
        initialized: existsSync(join(process.cwd(), "dist", "src", "index.js")),
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
      const result = await initializeFullRuntime(body.rpcUrl);
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
      const body = await parseBody(req);
      const svc = getAuthorityService();
      const result = await svc.submitRequest(body.name, body.ownerAddress, body.eip712Signature || "");
      return json(res, result, result.success ? 201 : 400);
    }

    if (path.startsWith("/api/organizations/requests/") && req.method === "POST") {
      const id = path.split("/").pop();
      const body = await parseBody(req);
      const svc = getAuthorityService();
      if (body.action === "approve") {
        const result = svc.approveRequest(id!);
        return json(res, result, result.success ? 200 : 400);
      } else if (body.action === "reject") {
        const result = svc.rejectRequest(id!);
        return json(res, result, result.success ? 200 : 400);
      }
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
      const body = await parseBody(req);
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

    // ── Wallets ──────────────────────────────────────────────────────
    if (path === "/api/wallets" && req.method === "GET") {
      const svc = getWalletService();
      return json(res, svc.list());
    }

    if (path === "/api/wallets" && req.method === "POST") {
      const body = await parseBody(req);
      const { createWallet } = await import("../tools/wallet");
      const result = await createWallet(body.ownerAddress);
      return json(res, result, result.success ? 201 : 400);
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
      const validation = guard.validate(body.ownerAddress);
      if (!validation.valid) {
        return json(res, { success: false, error: validation.error }, 400);
      }
      recordWalletInDB(body.walletAddress, body.ownerAddress, body.txHash);
      return json(res, { success: true, walletAddress: body.walletAddress }, 201);
    }

    if (path === "/api/wallets/execute-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const adapter = await import("../blockchain/adapter");
      const tx = adapter.encodeWalletExecute(body.walletAddress, body.to, body.value || "0", body.data || "0x");
      return json(res, { success: true, data: tx.data, chainId: tx.chainId });
    }

    if (path === "/api/wallets/whitelist-tx" && req.method === "POST") {
      const body = await parseBody(req);
      const adapter = await import("../blockchain/adapter");
      const tx = adapter.encodeWhitelistSelector(body.walletAddress, body.target, body.selector, body.allowed);
      return json(res, { success: true, data: tx.data, chainId: tx.chainId });
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
      const { ethers } = await import("ethers");
      // Build the execute() calldata for the wallet
      const iface = new ethers.Interface(["function execute(address target, uint256 value, bytes calldata data) external"]);
      const callData = iface.encodeFunctionData("execute", [body.userOp.target, body.userOp.value, body.userOp.calldata || "0x"]);
      const fullUserOp = buildSessionUserOp(body.userOp.sender, callData, body.userOp.sessionId, body.agentPrivateKey);
      const result = await bundleUserOp(fullUserOp);
      return json(res, result, result.success ? 200 : 400);
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
            body.sessionKey || body.walletAddress,
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

    if (path === "/api/sessions" && req.method === "POST") {
      const body = await parseBody(req);
      const svc = getSessionService();
      const session = svc.create(
        body.walletAddress,
        body.sessionKey || body.ownerAddress,
        body.organizationId,
        1,
        body.dailySpendLimit || "0.1",
        body.dailyTxLimit || 10,
        body.expiry || Math.floor(Date.now() / 1000) + 30 * 86400
      );
      return json(res, { success: true, session }, 201);
    }

    if (path === "/api/sessions" && req.method === "DELETE") {
      const body = await parseBody(req);
      const svc = getSessionService();
      const result = svc.revoke(body.sessionId, body.walletAddress);
      return json(res, result, result.success ? 200 : 400);
    }

    // ── Proofs ───────────────────────────────────────────────────────
    if (path === "/api/proofs" && req.method === "GET") {
      const svc = getProofService();
      return json(res, svc.list(50));
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

    // ── Capabilities ──────────────────────────────────────────────────
    if (path === "/api/capabilities" && req.method === "GET") {
      const caps = runQuery("SELECT * FROM capabilities ORDER BY created_at DESC");
      return json(res, caps);
    }

    if (path === "/api/capabilities" && req.method === "POST") {
      const body = await parseBody(req);
      const { ethers } = await import("ethers");
      const capId = `cap_${ethers.hexlify(ethers.randomBytes(16)).slice(2)}`;
      const hash = ethers.keccak256(ethers.toUtf8Bytes(body.name || ""));
      runExecute(
        "INSERT INTO capabilities (capability_id, organization_id, name, description, hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, unixepoch())",
        capId, body.organizationId || "global", body.name || "", body.description || "", hash
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
      const body = await parseBody(req);
      const { ethers } = await import("ethers");
      const delId = `del_${ethers.hexlify(ethers.randomBytes(16)).slice(2)}`;
      runExecute(
        "INSERT INTO delegations (delegation_id, organization_id, delegator, delegatee, scope, max_value, expiry, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())",
        delId, body.organizationId || "global", body.delegator || "", body.delegatee || "", body.scope || "", body.maxValue || "0", body.expiry || Math.floor(Date.now() / 1000) + 86400 * 30
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
        onchainTxs = rows.map((r: any) => ({
          tx_hash: r.tx_hash,
          wallet_address: r.contract_address,
          to_address: r.contract_address,
          value: '0',
          status: 'confirmed',
          block_number: r.block_number,
          gas_used: null,
          created_at: r.timestamp,
          event_name: r.event_name,
          contract_name: r.contract_name,
          args: JSON.parse(r.args || '{}'),
          source: 'onchain',
        }));
      } catch {}

      // Merge and deduplicate by tx_hash
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const tx of [...onchainTxs, ...localTxs]) {
        const key = tx.tx_hash;
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(tx);
        } else if (!key) {
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

    // ── Contracts ────────────────────────────────────────────────────
    if (path === "/api/contracts" && req.method === "GET") {
      const guard = getProxyGuard();
      return json(res, guard.listAllProxies());
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
      const body = await parseBody(req);
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

    if (path === "/api/plans" && req.method === "GET") {
      const status = url.searchParams.get("status") || undefined;
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const { getCompiler } = await import("../../packages/compiler");
      const plans = getCompiler().listPlans(status, limit);
      return json(res, plans);
    }

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

    json(res, { error: "Not found" }, 404);
  } catch (e: any) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`AgentIX API running on http://localhost:${PORT}`);

  // Start the on-chain event indexer
  try {
    const { startIndexer } = require("../core/event-indexer");
    startIndexer();
  } catch (e: any) {
    console.warn(`Event indexer failed to start: ${e.message}`);
  }
});
