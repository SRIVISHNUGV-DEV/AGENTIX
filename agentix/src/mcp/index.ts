#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
};

function log(msg: string, color = C.reset) { console.log(`${color}${msg}${C.reset}`); }

// ─── Lazy-loaded modules ──────────────────────────────────────
let _db: any = null;
let _config: any = null;
let _guard: any = null;
let _initDone = false;

function ensureInit() {
  if (_initDone) return;
  _initDone = true;
  try {
    const { ensureDirectories, loadConfig } = require("../core/config.js");
    const { getDatabase } = require("../core/database.js");
    ensureDirectories();
    _config = loadConfig();
    _db = getDatabase();
    _guard = require("../core/proxy-guard.js").getProxyGuard();
  } catch (e: any) {
    console.error(`[agentix-mcp] Init warning: ${e.message}`);
  }
}

function ok(data: any) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
function err(message: string) { return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true }; }

const DASHBOARD_ONLY = "This operation requires the owner's wallet. Use the AgentIX dashboard at http://localhost:3000";

// ─── Tool Definitions (agent-safe: read-only + bundler + keygen) ───

const TOOLS = [
  // READ-ONLY tools
  { name: "agentix_org_list",       description: "List all local organizations", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_org_get",        description: "Get organization details by ID", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },
  { name: "agentix_cred_list",      description: "List credentials for an organization", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },
  { name: "agentix_cred_get",       description: "Get credential details for an agent", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" }, agentId: { type: "number" } }, required: ["organizationId", "agentId"] } },
  { name: "agentix_wallet_info",    description: "Get wallet details: owner, balance, deposit, session manager (read-only)", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },
  { name: "agentix_wallet_balance", description: "Get ETH balance and EntryPoint deposit for a wallet", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },
  { name: "agentix_session_list",   description: "List sessions — filter by walletAddress OR sessionKey (agent's own key)", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" }, sessionKey: { type: "string" } } } },
  { name: "agentix_tree_status",    description: "Get Merkle tree status: roots, epochs, leaf counts", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },
  { name: "agentix_delegation_list",description: "List delegations for an organization", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },
  { name: "agentix_capability_list",description: "List capabilities", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } } } },
  { name: "agentix_proof_list",     description: "List recent proofs", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_backup_list",    description: "List all available backups", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_contracts",      description: "List all proxy contract addresses", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_health",         description: "Run health check: database, tree integrity, configuration", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_diagnostics",    description: "Full system diagnostics", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_protocol_doc",   description: "Get protocol documentation. Topics: organization, credential, session, wallet, tree, trust, proxy, recovery", inputSchema: { type: "object" as const, properties: { topic: { type: "string" } } } },

  // AGENT-AUTONOMOUS tools
  { name: "agentix_keygen",         description: "Generate a new agent key pair. Returns YOUR address and private key. Store the key — the owner adds this address as a sessionKey via the dashboard.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_sessions_mine",  description: "Find all active sessions where YOU are the session key", inputSchema: { type: "object" as const, properties: { sessionKey: { type: "string" } }, required: ["sessionKey"] } },
  { name: "agentix_session_status", description: "Get full session status: limits, remaining spend/tx, expiry, gas balance. Call before submitting a UserOp.", inputSchema: { type: "object" as const, properties: { sessionId: { type: "string" }, walletAddress: { type: "string" } }, required: ["sessionId", "walletAddress"] } },
  { name: "agentix_session_validate", description: "On-chain check: is a session valid for this signer+value?", inputSchema: { type: "object" as const, properties: { sessionId: { type: "string" }, signer: { type: "string" }, value: { type: "string" } }, required: ["sessionId", "signer"] } },
  { name: "agentix_bundler_send",   description: "Submit a session-signed UserOp through the local ERC-4337 bundler. Requires an active lightweight session.", inputSchema: { type: "object" as const, properties: { sender: { type: "string" }, target: { type: "string" }, value: { type: "string" }, calldata: { type: "string" }, sessionId: { type: "string" }, agentPrivateKey: { type: "string" } }, required: ["sender", "target", "sessionId", "agentPrivateKey"] } },
  { name: "agentix_rpc_test",       description: "Test RPC connectivity", inputSchema: { type: "object" as const, properties: { rpcUrl: { type: "string" } } } },

  // DASHBOARD-ONLY (listed so agents know they exist but get a clear redirect)
  { name: "agentix_wallet_create",  description: "⚠ DASHBOARD-ONLY: Deploy a new AgentWallet — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_session_create", description: "⚠ DASHBOARD-ONLY: Create a lightweight session — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_wallet_execute", description: "⚠ DASHBOARD-ONLY: Owner-execute through wallet — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
];

// ─── Handlers ──────────────────────────────────────────────────

const dashboardOnly = new Set(["agentix_wallet_create", "agentix_session_create", "agentix_wallet_execute"]);

const handlers: Record<string, (args: any) => Promise<any>> = {
  agentix_org_list: async () => {
    ensureInit();
    const { listOrganizations } = require("../tools/organization.js");
    return ok({ organizations: await listOrganizations() });
  },
  agentix_org_get: async (a) => {
    ensureInit();
    const { getOrganization } = require("../tools/organization.js");
    const r = await getOrganization(a.organizationId);
    return r.success ? ok(r) : err(r.error || "Not found");
  },
  agentix_cred_list: async (a) => {
    ensureInit();
    const { listCredentials } = require("../tools/credential.js");
    return ok({ credentials: await listCredentials(a.organizationId) });
  },
  agentix_cred_get: async (a) => {
    ensureInit();
    const { getCredential } = require("../tools/credential.js");
    const r = await getCredential(a.organizationId, a.agentId);
    return r.success ? ok(r) : err(r.error || "Not found");
  },
  agentix_wallet_info: async (a) => {
    ensureInit();
    const { getWalletInfo } = require("../tools/wallet.js");
    const r = await getWalletInfo(a.walletAddress);
    return r.success ? ok(r) : err(r.error || "Failed");
  },
  agentix_wallet_balance: async (a) => {
    ensureInit();
    try {
      const { ethers } = require("ethers");
      const { getProvider } = require("../core/provider.js");
      const provider = getProvider();
      const walletAddr = a.walletAddress as string;
      const wallet = new ethers.Contract(walletAddr, ["function getDeposit() view returns (uint256)"], provider);
      const [ethBalance, deposit] = await Promise.all([provider.getBalance(walletAddr), wallet.getDeposit()]);
      return ok({ walletAddress: walletAddr, ethBalance: ethers.formatEther(ethBalance), entryPointDeposit: ethers.formatEther(deposit), readyForBundler: deposit > 0n });
    } catch (e: any) { return err(`Balance check failed: ${e.message}`); }
  },
  agentix_session_list: async (a) => {
    ensureInit();
    const { listWalletSessions } = require("../tools/session.js");
    const walletAddr = a.walletAddress as string | undefined;
    const sessionKey = a.sessionKey as string | undefined;
    if (sessionKey) {
      const all = await listWalletSessions(walletAddr || "");
      const mine = all.filter((s: any) => s.session_key?.toLowerCase() === sessionKey.toLowerCase());
      return ok({ sessions: mine });
    }
    if (walletAddr) return ok({ sessions: await listWalletSessions(walletAddr) });
    return ok({ sessions: await listWalletSessions("") });
  },
  agentix_tree_status: async (a) => {
    ensureInit();
    const { getTreeStatus } = require("../tools/tree.js");
    const r = await getTreeStatus(a.organizationId);
    return r.success ? ok(r) : err(r.error || "Failed");
  },
  agentix_delegation_list: async (a) => {
    ensureInit();
    const { listDelegations } = require("../tools/delegation.js");
    return ok({ delegations: await listDelegations(a.organizationId) });
  },
  agentix_capability_list: async (a) => {
    ensureInit();
    const { listCapabilities } = require("../tools/capability.js");
    return ok({ capabilities: await listCapabilities(a.organizationId) });
  },
  agentix_proof_list: async () => {
    ensureInit();
    const { listProofs } = require("../tools/proof.js");
    return ok({ proofs: await listProofs() });
  },
  agentix_backup_list: async () => {
    ensureInit();
    const { listBackups } = require("../tools/backup.js");
    return ok({ backups: await listBackups() });
  },
  agentix_contracts: async () => {
    ensureInit();
    return ok({ proxies: _guard ? _guard.listAllProxies() : {} });
  },
  agentix_health: async () => {
    ensureInit();
    const { runHealthCheck } = require("../tools/health.js");
    return ok(await runHealthCheck());
  },
  agentix_diagnostics: async () => {
    ensureInit();
    const { runDiagnostics } = require("../tools/diagnostics.js");
    return ok(await runDiagnostics());
  },
  agentix_protocol_doc: async (a) => {
    const { getHelp } = require("../tools/help.js");
    return ok({ documentation: getHelp(a.topic) });
  },
  agentix_rpc_test: async (a) => {
    ensureInit();
    const { testRpcConnection } = require("../tools/rpc-tool.js");
    return ok(await testRpcConnection(a.rpcUrl));
  },

  // Agent-autonomous: keygen
  agentix_keygen: async () => {
    const { ethers } = require("ethers");
    const wallet = ethers.Wallet.createRandom();
    return ok({
      address: wallet.address,
      publicKey: wallet.signingKey.publicKey,
      privateKey: wallet.privateKey,
      warning: "STORE THIS PRIVATE KEY SECURELY. It is YOUR agent identity. The owner will add this address as a sessionKey via the AgentIX dashboard. The private key never leaves your context.",
    });
  },

  // Agent-autonomous: find my sessions
  agentix_sessions_mine: async (a) => {
    ensureInit();
    const myKey = (a.sessionKey as string).toLowerCase();
    const { listWalletSessions } = require("../tools/session.js");
    const all = await listWalletSessions("");
    const mine = all.filter((s: any) => s.session_key?.toLowerCase() === myKey && !s.revoked);
    return ok({ count: mine.length, sessions: mine.map((s: any) => ({ sessionId: s.session_id, walletAddress: s.wallet_address, dailySpendLimit: s.daily_spend_limit, dailyTxLimit: s.daily_tx_limit, expiry: s.expiry })) });
  },

  // Agent-autonomous: session status with gas check
  agentix_session_status: async (a) => {
    ensureInit();
    try {
      const { ethers } = require("ethers");
      const { getProvider } = require("../core/provider.js");
      const config = _config || require("../core/config.js").loadConfig();
      const sm = new ethers.Contract(config.contracts.sessionManager, [
        "function getLightSession(bytes32) view returns (address,address,uint256,uint256,uint256,uint256,uint64,bool)",
        "function getSessionType(bytes32) view returns (uint8)",
      ], getProvider());
      const walletAddr = a.walletAddress as string;
      const sessionId = a.sessionId as string;
      const [sessionData, sessionType] = await Promise.all([
        sm.getLightSession(sessionId).catch(() => null),
        sm.getSessionType(sessionId).catch(() => null),
      ]);
      const wallet = new ethers.Contract(walletAddr, ["function getDeposit() view returns (uint256)"], getProvider());
      const deposit = await wallet.getDeposit().catch(() => 0n);
      const ethBalance = await getProvider().getBalance(walletAddr).catch(() => 0n);

      if (!sessionData || sessionData[7]) {
        return ok({ valid: false, reason: "Session not found or revoked", entryPointDeposit: ethers.formatEther(deposit), ethBalance: ethers.formatEther(ethBalance) });
      }
      const [, key, spendLimit, txLimit, spendUsed, txUsed, expiry, revoked] = sessionData;
      const now = Math.floor(Date.now() / 1000);
      return ok({
        valid: !revoked && Number(expiry) > now,
        sessionId, walletAddress: walletAddr, sessionKey: key,
        limits: { dailySpendLimit: ethers.formatEther(spendLimit), dailyTxLimit: Number(txLimit), dailySpendUsed: ethers.formatEther(spendUsed), dailyTxUsed: Number(txUsed), spendRemaining: ethers.formatEther(spendLimit - spendUsed), txRemaining: Math.max(0, Number(txLimit) - Number(txUsed)) },
        expiry: Number(expiry), expiresInSeconds: Number(expiry) - now, revoked: Boolean(revoked),
        entryPointDeposit: ethers.formatEther(deposit), ethBalance: ethers.formatEther(ethBalance), gasReady: deposit > 0n,
        canSubmit: !revoked && Number(expiry) > now && deposit > 0n && Number(txLimit) > Number(txUsed),
      });
    } catch (e: any) { return err(`Session status check failed: ${e.message}`); }
  },

  // Agent-autonomous: validate session on-chain
  agentix_session_validate: async (a) => {
    ensureInit();
    try {
      const { ethers } = require("ethers");
      const { getProvider } = require("../core/provider.js");
      const config = _config || require("../core/config.js").loadConfig();
      const sm = new ethers.Contract(config.contracts.sessionManager, ["function validateLightweightSession(bytes32,address,uint256) view returns (bool)"], getProvider());
      const valid = await sm.validateLightweightSession(a.sessionId, a.signer, a.value || "0");
      return ok({ valid, sessionId: a.sessionId, signer: a.signer });
    } catch (e: any) { return ok({ valid: false, error: e.reason || e.message }); }
  },

  // Agent-autonomous: bundler submit
  agentix_bundler_send: async (a) => {
    ensureInit();
    try {
      const { ethers } = require("ethers");
      const { bundleUserOp, buildSessionUserOp } = require("../runtime/bundler.js");
      const iface = new ethers.Interface(["function execute(address target, uint256 value, bytes calldata data) external"]);
      const callData = iface.encodeFunctionData("execute", [a.target, a.value || "0", a.calldata || "0x"]);
      const userOp = buildSessionUserOp(a.sender, callData, a.sessionId, a.agentPrivateKey);
      const result = await bundleUserOp(userOp);
      if (!result.success) {
        const msg = result.error || "";
        const code = msg.includes("SessionExpired") ? "ERR_SESSION_EXPIRED" : msg.includes("SessionIsRevoked") ? "ERR_SESSION_REVOKED" : msg.includes("InvalidSigner") ? "ERR_INVALID_SIGNER" : msg.includes("DailySpendLimitExceeded") ? "ERR_SPEND_LIMIT_EXCEEDED" : msg.includes("DailyTxLimitExceeded") ? "ERR_TX_LIMIT_EXCEEDED" : "ERR_BUNDLER_FAILED";
        return ok({ ...result, errorCode: code });
      }
      return ok(result);
    } catch (e: any) {
      const msg = e.message || "";
      const code = msg.includes("SessionExpired") ? "ERR_SESSION_EXPIRED" : msg.includes("InvalidSigner") ? "ERR_INVALID_SIGNER" : "ERR_BUNDLER_FAILED";
      return ok({ success: false, errorCode: code, error: e.message });
    }
  },
};

// ─── CLI Installer ─────────────────────────────────────────────

const SERVER_COMMAND = "npx";
const SERVER_ARGS = ["tsx", join(__dirname, "index.js")];

interface Platform { name: string; id: string; configPath: string | null; detected: boolean; method: "cli" | "json" | "project" }

function detectPlatforms(): Platform[] {
  const home = homedir();
  let claudeCodeAvailable = false;
  try { execSync("claude --version", { stdio: "ignore", timeout: 3000 }); claudeCodeAvailable = true; } catch {}
  return [
    ["Claude Code", "claude-code", join(home, ".claude.json"), claudeCodeAvailable, "cli"],
    ["Cursor", "cursor", join(home, ".cursor", "mcp.json"), existsSync(join(home, ".cursor", "mcp.json")), "json"],
    ["Cline", "cline", join(home, ".cline", "mcp.json"), existsSync(join(home, ".cline", "mcp.json")), "json"],
    ["Windsurf", "windsurf", join(home, ".codeium", "windsurf", "mcp_config.json"), existsSync(join(home, ".codeium", "windsurf", "mcp_config.json")), "json"],
    ["VS Code", "vscode", join(home, ".vscode", "mcp.json"), existsSync(join(home, ".vscode", "mcp.json")), "json"],
    ["Project .mcp.json", "project", join(process.cwd(), ".mcp.json"), true, "project"],
  ].map(([name, id, configPath, detected, method]) => ({ name, id, configPath, detected, method } as Platform));
}

function readJson(p: string): any { return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : { mcpServers: {} }; }
function writeJson(p: string, data: any) { const dir = join(p, ".."); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2) + "\n"); }

function addToPlatform(configPath: string): boolean {
  const config = readJson(configPath);
  config.mcpServers = config.mcpServers || {};
  if (!config.mcpServers.agentix) config.mcpServers.agentix = { command: SERVER_COMMAND, args: SERVER_ARGS };
  writeJson(configPath, config);
  return true;
}

function addCommand(target?: string) {
  log(`\n  ${C.bold}AgentIX MCP Installer${C.reset}\n`, C.cyan);
  let count = 0;
  for (const p of detectPlatforms()) {
    if (target && p.id !== target) continue;
    if (!p.detected) { log(`  [skip] ${p.name}`); continue; }
    if (p.method === "json" && p.configPath && readJson(p.configPath).mcpServers?.agentix) { log(`  ${C.yellow}[exists]${C.reset} ${p.name}`); count++; continue; }
    let ok = false;
    if (p.id === "claude-code") {
      try { execSync(`claude mcp add --transport stdio --scope user agentix -- ${SERVER_ARGS.join(" ")}`, { stdio: "ignore", timeout: 10000 }); ok = true; } catch { if (p.configPath) ok = addToPlatform(p.configPath); }
    } else if (p.configPath) { ok = addToPlatform(p.configPath); }
    log(ok ? `  ${C.green}[added]${C.reset} ${p.name}` : `  ${C.red}[fail]${C.reset} ${p.name}`);
    if (ok) count++;
  }
  log(count > 0 ? `\n  ${C.green}Installed on ${count} platform(s)${C.reset}\n` : `\n  ${C.yellow}No platforms detected${C.reset}\n`);
}

function removeCommand() {
  log(`\n  ${C.yellow}Removing AgentIX MCP...${C.reset}\n`);
  for (const p of detectPlatforms()) {
    if (!p.detected || !p.configPath || !existsSync(p.configPath)) continue;
    const config = readJson(p.configPath);
    if (config.mcpServers?.agentix) { delete config.mcpServers.agentix; writeJson(p.configPath, config); log(`  ${C.green}[removed]${C.reset} ${p.name}`); }
  }
}

function statusCommand() {
  log(`\n  ${C.bold}AgentIX MCP Status${C.reset}\n`, C.cyan);
  for (const p of detectPlatforms()) {
    if (!p.detected) { log(`  [${C.dim}--${C.reset}] ${p.name}`); continue; }
    const installed = p.configPath && existsSync(p.configPath) && readJson(p.configPath).mcpServers?.agentix;
    log(installed ? `  ${C.green}[installed]${C.reset} ${p.name}` : `  [not installed] ${p.name}`);
  }
  log("");
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "add" || cmd === "install") { addCommand(args[1]); return; }
  if (cmd === "remove" || cmd === "uninstall") { removeCommand(); return; }
  if (cmd === "status" || cmd === "check") { statusCommand(); return; }

  console.error("");
  console.error(`${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
  console.error(`${C.cyan}║  AgentIX MCP Server v1.0.0                   ║${C.reset}`);
  console.error(`${C.cyan}║  Agent-safe: read-only + bundler + keygen    ║${C.reset}`);
  console.error(`${C.cyan}║  Owner ops: dashboard at localhost:3000      ║${C.reset}`);
  console.error(`${C.cyan}║  Tools: ${String(TOOLS.length).padEnd(38)}║${C.reset}`);
  console.error(`${C.cyan}╚══════════════════════════════════════════════╝${C.reset}`);
  console.error("");

  const server = new Server(
    { name: "agentix-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;

    if (dashboardOnly.has(name)) {
      return err(DASHBOARD_ONLY);
    }

    const handler = handlers[name];
    if (!handler) return err(`Unknown tool: ${name}`);
    try { return await handler(toolArgs || {}); }
    catch (e: any) { return err(e.message); }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[agentix-mcp] Server running on stdio");
}

main().catch((e) => { console.error("[agentix-mcp] Fatal:", e); process.exit(1); });
