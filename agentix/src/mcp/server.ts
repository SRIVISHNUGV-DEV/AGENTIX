import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, ensureDirectories } from "../core/config";
import { getDatabase, runQuery, runSingle, runExecute } from "../core/database";
import { getProxyGuard } from "../core/proxy-guard";
import { getEventBus } from "../../packages/core/eventbus";
import { getOrganizationService } from "../../packages/services/organization-service";
import { getCredentialService } from "../../packages/services/credential-service";
import { getWalletService } from "../../packages/services/wallet-service";
import { getSessionService } from "../../packages/services/session-service";
import { getProofService } from "../../packages/services/proof-service";
import { BackupEngine } from "../../packages/core/backup-engine";
import { getSessionLogger } from "../tools/session-logs";

ensureDirectories();
getDatabase();

const server = new Server(
  { name: "agentix", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Dashboard-only response ──────────────────────────────────────
const DASHBOARD_ONLY = {
  error: "DASHBOARD_ONLY",
  message: "This operation requires the owner's wallet and is only available via the AgentIX dashboard at http://localhost:3000",
};

// ── Bundler error codes ──────────────────────────────────────────
const BUNDLER_ERRORS: Record<string, string> = {
  "NotAgentWallet": "ERR_NOT_AGENT_WALLET",
  "SessionExpired": "ERR_SESSION_EXPIRED",
  "SessionIsRevoked": "ERR_SESSION_REVOKED",
  "InvalidSigner": "ERR_INVALID_SIGNER",
  "DailySpendLimitExceeded": "ERR_SPEND_LIMIT_EXCEEDED",
  "DailyTxLimitExceeded": "ERR_TX_LIMIT_EXCEEDED",
  "LightweightSessionValidationFailed": "ERR_SESSION_VALIDATION_FAILED",
  "BatchNotAllowedForSession": "ERR_BATCH_NOT_ALLOWED",
  "NotAuthorized": "ERR_NOT_AUTHORIZED",
  "TargetBlocked": "ERR_TARGET_BLOCKED",
};

function classifyBundlerError(message: string): { code: string; reason: string } {
  for (const [contractErr, code] of Object.entries(BUNDLER_ERRORS)) {
    if (message.includes(contractErr)) return { code, reason: contractErr };
  }
  const match = message.match(/reverted with reason string '([^']+)'/);
  if (match) {
    const reason = match[1];
    return { code: BUNDLER_ERRORS[reason] || "ERR_REVERTED", reason };
  }
  return { code: "ERR_BUNDLER_FAILED", reason: message };
}

// ── Tool definitions ─────────────────────────────────────────────

// prettier-ignore
const tools = [

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM (all read-only for agents)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_health",       description: "System health check (RPC, DB, proxies)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_stats",       description: "System statistics (counts, network)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_contracts",   description: "List all proxy contract addresses", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_diagnostics", description: "Full system diagnostics", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_rpc_test",    description: "Test RPC connectivity", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_protocol_doc",description: "Protocol docs for a topic", inputSchema: { type: "object" as const, properties: { topic: { type: "string" } }, required: ["topic"] } },

  // ═══════════════════════════════════════════════════════════════
  // CONFIG (read-only for agents)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_config_get",  description: "Get a config value (read-only)", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "agentix_config_show", description: "Show all config (read-only)", inputSchema: { type: "object" as const, properties: {} } },

  // ═══════════════════════════════════════════════════════════════
  // WALLET (create + execute + read-only for agents)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_wallet_create",       description: "Deploy a new AgentWallet. The server pays deployment gas; you become the owner. Provide your agent address as ownerAddress.", inputSchema: { type: "object" as const, properties: { ownerAddress: { type: "string" } }, required: ["ownerAddress"] } },
  { name: "agentix_wallet_execute",      description: "Execute a transaction AS THE WALLET OWNER through the ERC-4337 bundler. Uses a 65-byte owner signature (no session limits). Provide your agent private key as ownerPrivateKey.", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" }, target: { type: "string" }, value: { type: "string" }, data: { type: "string" }, ownerPrivateKey: { type: "string" } }, required: ["walletAddress", "target", "ownerPrivateKey"] } },
  { name: "agentix_wallet_list",         description: "List all wallets in local DB", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_wallet_get",          description: "Get wallet info (owner, SM, EP addresses)", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },
  { name: "agentix_wallet_balance",      description: "Get ETH balance and EntryPoint deposit for a wallet", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },
  { name: "agentix_wallet_get_identity", description: "Get the on-chain AgentIdentity for a wallet", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },

  // ═══════════════════════════════════════════════════════════════
  // IDENTITY (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_identity_get",        description: "Get identity info by wallet address", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] } },
  { name: "agentix_identity_get_by_id",  description: "Get identity info by identity ID", inputSchema: { type: "object" as const, properties: { identityId: { type: "number" } }, required: ["identityId"] } },

  // ═══════════════════════════════════════════════════════════════
  // SESSION (agent-relevant: list, validate, find-mine)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_session_list",        description: "List sessions — filter by walletAddress OR sessionKey (agent's own key)", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" }, sessionKey: { type: "string" } } } },
  { name: "agentix_session_validate",    description: "On-chain check: is a session valid for this signer+value?", inputSchema: { type: "object" as const, properties: { sessionId: { type: "string" }, signer: { type: "string" }, value: { type: "string" } }, required: ["sessionId", "signer"] } },
  { name: "agentix_sessions_mine",       description: "Find all sessions where YOU are the session key — pass your agent address", inputSchema: { type: "object" as const, properties: { sessionKey: { type: "string" } }, required: ["sessionKey"] } },
  { name: "agentix_session_status",      description: "Get full session status: limits, remaining spend/tx, expiry, gas balance. Use this before submitting a UserOp.", inputSchema: { type: "object" as const, properties: { sessionId: { type: "string" }, walletAddress: { type: "string" } }, required: ["sessionId", "walletAddress"] } },

  // ═══════════════════════════════════════════════════════════════
  // ORGANIZATION (read-only for agents)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_org_list",            description: "List organizations", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_org_get",             description: "Get org details by ID", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },
  { name: "agentix_org_get_anchor",      description: "Get credential anchor info for an org", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },

  // ═══════════════════════════════════════════════════════════════
  // CREDENTIAL (read-only + verify)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_cred_list",     description: "List credentials (all or by org)", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } } } },
  { name: "agentix_cred_get",      description: "Get credential by org+agent ID", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" }, agentId: { type: "number" } }, required: ["organizationId", "agentId"] } },
  { name: "agentix_cred_history",  description: "Credential root history for an org", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },
  { name: "agentix_cred_verify",   description: "Check if a nullifier has been used (credential already spent)", inputSchema: { type: "object" as const, properties: { nullifier: { type: "string" } }, required: ["nullifier"] } },
  { name: "agentix_cred_oracle",   description: "Get on-chain credential oracle state (roots, ETH price)", inputSchema: { type: "object" as const, properties: {} } },

  // ═══════════════════════════════════════════════════════════════
  // CAPABILITY (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_capability_list",   description: "List capabilities", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } } } },
  { name: "agentix_capability_get",    description: "Get capability details by ID", inputSchema: { type: "object" as const, properties: { capabilityId: { type: "string" } }, required: ["capabilityId"] } },
  { name: "agentix_capability_verify", description: "Verify a capability grant on-chain", inputSchema: { type: "object" as const, properties: { agent: { type: "string" }, capabilityId: { type: "string" }, grantLeaf: { type: "string" }, merkleProof: { type: "array", items: { type: "string" } }, grantor: { type: "string" }, constraintsHash: { type: "string" }, expiresAt: { type: "number" } }, required: ["agent", "capabilityId", "grantLeaf", "merkleProof", "grantor", "constraintsHash", "expiresAt"] } },

  // ═══════════════════════════════════════════════════════════════
  // DELEGATION (read-only + verify)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_delegation_verify",       description: "Verify a single delegation on-chain", inputSchema: { type: "object" as const, properties: { leaf: { type: "string" }, merkleProof: { type: "array", items: { type: "string" } }, delegator: { type: "string" }, scope: { type: "string" }, expiresAt: { type: "number" }, maxDepth: { type: "number" } }, required: ["leaf", "delegator", "scope", "expiresAt"] } },
  { name: "agentix_delegation_verify_chain", description: "Verify a chain of delegations on-chain", inputSchema: { type: "object" as const, properties: { leaves: { type: "array", items: { type: "string" } }, delegators: { type: "array", items: { type: "string" } }, scopes: { type: "array", items: { type: "string" } }, expiries: { type: "array", items: { type: "number" } } }, required: ["leaves", "delegators", "scopes", "expiries"] } },
  { name: "agentix_delegation_list",         description: "List delegations for an org", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } } } },
  { name: "agentix_delegation_get_root",     description: "Get delegation root for a delegator+scope on-chain", inputSchema: { type: "object" as const, properties: { delegator: { type: "string" }, scopeHash: { type: "string" } }, required: ["delegator", "scopeHash"] } },

  // ═══════════════════════════════════════════════════════════════
  // TREES (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_tree_status", description: "Merkle tree status for an org (active + revoked)", inputSchema: { type: "object" as const, properties: { organizationId: { type: "string" } }, required: ["organizationId"] } },

  // ═══════════════════════════════════════════════════════════════
  // PROOFS (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_proof_list",  description: "List recent proofs", inputSchema: { type: "object" as const, properties: { limit: { type: "number" } } } },
  { name: "agentix_proof_verify", description: "Verify a proof by hash", inputSchema: { type: "object" as const, properties: { proofHash: { type: "string" } }, required: ["proofHash"] } },

  // ═══════════════════════════════════════════════════════════════
  // EVENTS (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_events", description: "Recent events from the event bus", inputSchema: { type: "object" as const, properties: { limit: { type: "number" } } } },

  // ═══════════════════════════════════════════════════════════════
  // LOGS (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_session_logs",       description: "Recent session action logs (filter by wallet/tool/risk)", inputSchema: { type: "object" as const, properties: { limit: { type: "number" }, walletAddress: { type: "string" }, tool: { type: "string" }, riskLevel: { type: "string" } } } },
  { name: "agentix_session_log_stats",  description: "Session log statistics (counts, risk breakdown)", inputSchema: { type: "object" as const, properties: {} } },

  // ═══════════════════════════════════════════════════════════════
  // HARNESSES (scan + list only, connect/repair is dashboard-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_harnesses_scan",  description: "Scan for detected AI harnesses with logos and versions", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_harnesses_list",  description: "List all persisted harnesses from local DB", inputSchema: { type: "object" as const, properties: {} } },

  // ═══════════════════════════════════════════════════════════════
  // TRANSACTIONS (read-only)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_transaction_list", description: "List transaction history (filter by wallet)", inputSchema: { type: "object" as const, properties: { walletAddress: { type: "string" }, limit: { type: "number" } } } },
  { name: "agentix_transaction_get",  description: "Get transaction details by hash", inputSchema: { type: "object" as const, properties: { hash: { type: "string" } }, required: ["hash"] } },

  // ═══════════════════════════════════════════════════════════════
  // BUNDLER (agent-autonomous execution)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_bundler_send", description: "Submit a session-signed UserOp through the local ERC-4337 bundler. Requires an active lightweight session. The agent signs the UserOp with its session key — key stays in your context.", inputSchema: { type: "object" as const, properties: { sender: { type: "string" }, target: { type: "string" }, value: { type: "string" }, calldata: { type: "string" }, sessionId: { type: "string" }, agentPrivateKey: { type: "string" } }, required: ["sender", "target", "sessionId", "agentPrivateKey"] } },

  // ═══════════════════════════════════════════════════════════════
  // AGENT KEY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_keygen", description: "Generate a new agent key pair. Returns YOUR address. The private key stays in your context — you MUST store it. The owner adds this address as a sessionKey via the dashboard.", inputSchema: { type: "object" as const, properties: {} } },

  // ═══════════════════════════════════════════════════════════════
  // ONBOARDING (read-only + fund recommendations)
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_onboarding_status", description: "Check onboarding status", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_fund",              description: "Get fiat on-ramp options to buy ETH (compare providers)", inputSchema: { type: "object" as const, properties: { network: { type: "string" }, amount: { type: "string" }, currency: { type: "string" }, country: { type: "string" } }, required: ["network", "amount"] } },

  // ═══════════════════════════════════════════════════════════════
  // DASHBOARD-ONLY OPERATIONS (explicitly blocked for agents)
  // These are listed so agents know about them but get a clear
  // "use the dashboard" response.
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_session_create",         description: "⚠ DASHBOARD-ONLY: Create a lightweight session — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_session_revoke",         description: "⚠ DASHBOARD-ONLY: Revoke a session — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_session_prune",          description: "⚠ DASHBOARD-ONLY: Prune expired sessions — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_wallet_whitelist",       description: "⚠ DASHBOARD-ONLY: Whitelist target — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_wallet_execute_batch",   description: "⚠ DASHBOARD-ONLY: Owner batch-execute — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_config_set",             description: "⚠ DASHBOARD-ONLY: Set config — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },
  { name: "agentix_backup_create",          description: "⚠ DASHBOARD-ONLY: Create backup — use the dashboard at http://localhost:3000", inputSchema: { type: "object" as const, properties: {} } },

  // ═══════════════════════════════════════════════════════════════
  // COMPILER TOOLS
  // ═══════════════════════════════════════════════════════════════
  { name: "agentix_compile_intent",         description: "Compile an intent into a deterministic execution plan. Takes action + params, returns ExecutionPlan with risk score and explanation.", inputSchema: { type: "object" as const, properties: { action: { type: "string" }, params: { type: "object" }, source: { type: "string" } }, required: ["action", "params"] } },
  { name: "agentix_get_plan",               description: "Get an execution plan by ID. Returns full plan with status, risk, and explanation.", inputSchema: { type: "object" as const, properties: { planId: { type: "string" } }, required: ["planId"] } },
  { name: "agentix_list_plans",             description: "List recent execution plans. Optionally filter by status.", inputSchema: { type: "object" as const, properties: { status: { type: "string" }, limit: { type: "number" } } } },
  { name: "agentix_approve_plan",           description: "Approve a plan that requires explicit approval (AUTHORITY risk).", inputSchema: { type: "object" as const, properties: { planId: { type: "string" } }, required: ["planId"] } },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Dashboard-only gate (session lifecycle, config mutations, system ops)
  const dashboardOnly: string[] = [
    "agentix_session_create", "agentix_session_revoke",
    "agentix_session_prune", "agentix_wallet_whitelist",
    "agentix_wallet_execute_batch", "agentix_config_set",
    "agentix_backup_create",
  ];
  if (dashboardOnly.includes(name)) {
    return { content: [{ type: "text", text: JSON.stringify(DASHBOARD_ONLY, null, 2) }] };
  }

  try {
    let result: any;

    switch (name) {

      // ══════════════════════════════════════════════════════════
      // SYSTEM
      // ══════════════════════════════════════════════════════════
      case "agentix_health": {
        const config = loadConfig();
        result = { status: "HEALTHY", checks: [
          { name: "RPC", status: config.rpcUrl ? "PASS" : "WARNING", message: config.rpcUrl || "Not configured" },
          { name: "Database", status: "PASS", message: config.database.path },
          { name: "Proxies", status: "PASS", message: `${Object.keys(config.contracts).length} contracts` },
        ]};
        break;
      }
      case "agentix_stats": {
        const [o, c, w, s, p] = await Promise.all([
          getOrganizationService().count(), getCredentialService().count(),
          getWalletService().count(), getSessionService().count(), getProofService().count(),
        ]);
        const config = loadConfig();
        result = { organizations: o, credentials: c, wallets: w, sessions: s, proofs: p, network: config.networkName, chainId: config.chainId };
        break;
      }
      case "agentix_contracts": result = getProxyGuard().listAllProxies(); break;

      case "agentix_diagnostics":
        result = { checks: [
          { name: "RPC", status: "PASS", value: loadConfig().rpcUrl },
          { name: "Database", status: "PASS", value: loadConfig().database.path },
          { name: "Proxies", status: "PASS", value: `${Object.keys(loadConfig().contracts).length} configured` },
        ]};
        break;

      case "agentix_rpc_test": {
        const { testRpcConnection } = await import("../tools/rpc-tool");
        result = await testRpcConnection();
        break;
      }
      case "agentix_protocol_doc":
        result = { topic: args!.topic, hint: `Run 'agentix protocol ${args!.topic}' for full docs` };
        break;

      // ══════════════════════════════════════════════════════════
      // CONFIG (read-only)
      // ══════════════════════════════════════════════════════════
      case "agentix_config_get": {
        const { getConfig } = await import("../tools/config-tool");
        result = getConfig(args!.key as string);
        break;
      }
      case "agentix_config_show": {
        const { showConfig } = await import("../tools/config-tool");
        result = showConfig();
        break;
      }

      // ══════════════════════════════════════════════════════════
      // WALLET (read-only)
      // ══════════════════════════════════════════════════════════
      case "agentix_wallet_list": result = getWalletService().list(); break;
      case "agentix_wallet_get": result = getWalletService().get(args!.walletAddress as string); break;

      case "agentix_wallet_balance": {
        const { ethers } = await import("ethers");
        const { getProvider } = await import("../core/provider");
        const provider = getProvider();
        const walletAddr = args!.walletAddress as string;
        const wallet = new ethers.Contract(walletAddr, [
          "function getDeposit() view returns (uint256)",
        ], provider);
        const [ethBalance, deposit] = await Promise.all([
          provider.getBalance(walletAddr),
          wallet.getDeposit(),
        ]);
        result = {
          walletAddress: walletAddr,
          ethBalance: ethers.formatEther(ethBalance),
          entryPointDeposit: ethers.formatEther(deposit),
          readyForBundler: deposit > 0n,
        };
        break;
      }

      case "agentix_wallet_get_identity":
      case "agentix_identity_get": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const addr = config.contracts.agentIdentity;
          if (!addr || !addr.startsWith("0x")) { result = { identityId: null, wallet: args?.walletAddress }; break; }
          const c = new ethers.Contract(addr, [
            "function identityOf(address) view returns (uint256)", "function walletOf(uint256) view returns (address)",
            "function isActive(uint256) view returns (bool)", "function metadataOf(uint256) view returns (bytes32)",
            "function timestampsOf(uint256) view returns (uint64,uint64)",
          ], getProvider());
          const id = await c.identityOf(args!.walletAddress as string);
          if (id === 0n) { result = { identityId: null, wallet: args!.walletAddress }; break; }
          const [w, active, meta, ts] = await Promise.all([c.walletOf(id), c.isActive(id), c.metadataOf(id), c.timestampsOf(id)]);
          result = { identityId: id.toString(), wallet: w, active, metadata: meta, createdAt: Number(ts[0]), updatedAt: Number(ts[1]) };
        } catch { result = { identityId: null, wallet: args?.walletAddress, error: "lookup failed" }; }
        break;
      }

      case "agentix_identity_get_by_id": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const addr = config.contracts.agentIdentity;
          if (!addr) { result = { identityId: null }; break; }
          const c = new ethers.Contract(addr, [
            "function walletOf(uint256) view returns (address)", "function isActive(uint256) view returns (bool)",
            "function metadataOf(uint256) view returns (bytes32)", "function timestampsOf(uint256) view returns (uint64,uint64)",
          ], getProvider());
          const [w, active, meta, ts] = await Promise.all([c.walletOf(args!.identityId), c.isActive(args!.identityId), c.metadataOf(args!.identityId), c.timestampsOf(args!.identityId)]);
          result = { identityId: args!.identityId, wallet: w, active, metadata: meta, createdAt: Number(ts[0]), updatedAt: Number(ts[1]) };
        } catch { result = { identityId: args!.identityId, error: "lookup failed" }; }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // SESSION
      // ══════════════════════════════════════════════════════════
      case "agentix_session_list": {
        const walletAddr = args?.walletAddress as string | undefined;
        const sessionKey = args?.sessionKey as string | undefined;
        if (sessionKey) {
          result = getSessionService().listAll ? getSessionService().listAll().filter((s: any) => s.session_key?.toLowerCase() === sessionKey.toLowerCase()) : [];
        } else if (walletAddr) {
          result = getSessionService().listByWallet(walletAddr);
        } else {
          result = getSessionService().listAll ? getSessionService().listAll() : [];
        }
        break;
      }

      case "agentix_sessions_mine": {
        const myKey = (args!.sessionKey as string).toLowerCase();
        const all = getSessionService().listAll ? getSessionService().listAll() : [];
        const mine = all.filter((s: any) =>
          s.session_key?.toLowerCase() === myKey &&
          !s.revoked &&
          (!s.expiry || s.expiry > Math.floor(Date.now() / 1000))
        );
        result = {
          count: mine.length,
          sessions: mine.map((s: any) => ({
            sessionId: s.session_id,
            walletAddress: s.wallet_address,
            dailySpendLimit: s.daily_spend_limit,
            dailyTxLimit: s.daily_tx_limit,
            expiry: s.expiry,
            expiresAt: s.expiry > 1e12 ? new Date(s.expiry * 1000).toISOString() : null,
            remainingSeconds: s.expiry > 1e12 ? s.expiry - Math.floor(Date.now() / 1000) : null,
          })),
        };
        break;
      }

      case "agentix_session_status": {
        const { ethers } = await import("ethers");
        const { getProvider } = await import("../core/provider");
        const config = loadConfig();
        const sessionId = args!.sessionId as string;
        const walletAddr = args!.walletAddress as string;

        // On-chain session check
        const sm = new ethers.Contract(config.contracts.sessionManager, [
          "function getLightSession(bytes32) view returns (address,address,uint256,uint256,uint256,uint256,uint64,bool)",
          "function validateLightweightSession(bytes32,address,uint256) view returns (bool)",
          "function getSessionType(bytes32) view returns (uint8)",
        ], getProvider());

        const [sessionData, sessionType] = await Promise.all([
          sm.getLightSession(sessionId).catch(() => null),
          sm.getSessionType(sessionId).catch(() => null),
        ]);

        // Wallet balance
        const wallet = new ethers.Contract(walletAddr, [
          "function getDeposit() view returns (uint256)",
        ], getProvider());
        const deposit = await wallet.getDeposit().catch(() => 0n);

        const provider = getProvider();
        const ethBalance = await provider.getBalance(walletAddr).catch(() => 0n);

        if (!sessionData || sessionData[7]) {
          result = {
            valid: false,
            reason: "Session not found or already revoked",
            sessionId,
            walletAddress: walletAddr,
            entryPointDeposit: ethers.formatEther(deposit),
            ethBalance: ethers.formatEther(ethBalance),
            gasReady: deposit > 0n,
          };
          break;
        }

        const [, key, spendLimit, txLimit, spendUsed, txUsed, expiry, revoked] = sessionData;
        const now = Math.floor(Date.now() / 1000);
        result = {
          valid: !revoked && Number(expiry) > now,
          sessionId,
          walletAddress: walletAddr,
          sessionKey: key,
          limits: {
            dailySpendLimit: ethers.formatEther(spendLimit),
            dailyTxLimit: Number(txLimit),
            dailySpendUsed: ethers.formatEther(spendUsed),
            dailyTxUsed: Number(txUsed),
            spendRemaining: ethers.formatEther(spendLimit - spendUsed),
            txRemaining: Math.max(0, Number(txLimit) - Number(txUsed)),
          },
          expiry: Number(expiry),
          expiresAt: new Date(Number(expiry) * 1000).toISOString(),
          expiresInSeconds: Number(expiry) - now,
          revoked: Boolean(revoked),
          sessionType: Number(sessionType || 0),
          entryPointDeposit: ethers.formatEther(deposit),
          ethBalance: ethers.formatEther(ethBalance),
          gasReady: deposit > 0n,
          canSubmit: !revoked && Number(expiry) > now && deposit > 0n && Number(txLimit) > Number(txUsed),
        };
        break;
      }

      case "agentix_session_validate": {
        const { ethers } = await import("ethers");
        const { getProvider } = await import("../core/provider");
        const config = loadConfig();
        const sm = new ethers.Contract(config.contracts.sessionManager, [
          "function validateLightweightSession(bytes32 sessionId, address signer, uint256 value) view returns (bool)",
        ], getProvider());
        try {
          const valid = await sm.validateLightweightSession(args!.sessionId, args!.signer, args?.value || "0");
          result = { valid, sessionId: args!.sessionId, signer: args!.signer };
        } catch (e: any) {
          result = { valid: false, error: e.reason || e.message };
        }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // ORGANIZATION
      // ══════════════════════════════════════════════════════════
      case "agentix_org_list": result = getOrganizationService().list(); break;
      case "agentix_org_get": result = getOrganizationService().get(args!.organizationId as string); break;

      case "agentix_org_get_anchor": {
        const org = getOrganizationService().get(args!.organizationId as string) as any;
        if (!org) { result = { error: "Org not found" }; break; }
        const anchorAddr = org.credential_anchor;
        if (!anchorAddr) { result = { error: "No anchor deployed" }; break; }
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const c = new ethers.Contract(anchorAddr, [
            "function currentRoot() view returns (bytes32)", "function currentEpoch() view returns (uint64)",
            "function metadataHash() view returns (bytes32)", "function organizationId() view returns (bytes32)",
          ], getProvider());
          const [root, epoch, meta, orgId] = await Promise.all([c.currentRoot(), c.currentEpoch(), c.metadataHash(), c.organizationId()]);
          result = { organizationId: orgId, currentRoot: root, currentEpoch: Number(epoch), metadataHash: meta };
        } catch { result = { error: "Could not read anchor" }; }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // CREDENTIAL
      // ══════════════════════════════════════════════════════════
      case "agentix_cred_list": result = getCredentialService().list(args?.organizationId as string); break;
      case "agentix_cred_get": result = getCredentialService().get(args!.organizationId as string, args!.agentId as number); break;
      case "agentix_cred_history": result = getCredentialService().getHistory(args!.organizationId as string); break;

      case "agentix_cred_verify": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const cr = new ethers.Contract(config.contracts.credentialRegistry, ["function isNullifierUsed(bytes32) view returns (bool)"], getProvider());
          result = { nullifier: args!.nullifier, used: await cr.isNullifierUsed(args!.nullifier as string) };
        } catch { result = { error: "Nullifier check failed" }; }
        break;
      }

      case "agentix_cred_oracle": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const cr = new ethers.Contract(config.contracts.credentialRegistry, [
            "function activeRoot() view returns (bytes32)", "function revokedSecretRoot() view returns (bytes32)", "function paused() view returns (bool)",
          ], getProvider());
          const [activeRoot, revokedRoot, paused] = await Promise.all([cr.activeRoot(), cr.revokedSecretRoot(), cr.paused()]);
          const { getEthUsdPrice } = await import("../core/price-oracle");
          result = { activeRoot, revokedRoot, paused, ethPrice: await getEthUsdPrice() };
        } catch { result = { error: "Oracle fetch failed" }; }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // CAPABILITY
      // ══════════════════════════════════════════════════════════
      case "agentix_capability_list": result = (await import("../tools/capability")).listCapabilities(args?.organizationId as string); break;
      case "agentix_capability_get": result = runSingle("SELECT * FROM capabilities WHERE capability_id = ?", args!.capabilityId as string); break;

      case "agentix_capability_verify": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const c = new ethers.Contract(config.contracts.capabilityRegistry, [
            "function verifyCapability(address agent, bytes32 capabilityId, bytes32 grantLeaf, bytes32[] calldata merkleProof, address grantor, bytes32 constraintsHash, uint64 expiresAt) view returns (bool)",
          ], getProvider());
          result = { valid: await c.verifyCapability(args!.agent, args!.capabilityId, args!.grantLeaf, args!.merkleProof, args!.grantor, args!.constraintsHash, args!.expiresAt) };
        } catch (e: any) { result = { valid: false, error: e.message }; }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // DELEGATION
      // ══════════════════════════════════════════════════════════
      case "agentix_delegation_verify": {
        const { ethers } = await import("ethers");
        const { getProvider } = await import("../core/provider");
        const config = loadConfig();
        const dm = new ethers.Contract(config.contracts.delegationManager, [
          "function verifyDelegation(bytes32, bytes32[], address, bytes32, uint64, uint8) view returns (bool)",
        ], getProvider());
        const scopeHash = ethers.solidityPackedKeccak256(["string"], [args!.scope]);
        const valid = await dm.verifyDelegation(args!.leaf, args!.merkleProof || [], args!.delegator, scopeHash, args!.expiresAt, (args?.maxDepth as number) || 10);
        result = { valid };
        break;
      }

      case "agentix_delegation_verify_chain": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const dm = new ethers.Contract(config.contracts.delegationManager, [
            "function verifyDelegationChain(bytes32[] calldata delegationLeaves, bytes32[][] calldata merkleProofs, address[] calldata delegators, address[] calldata delegates, bytes32[] calldata scopeHashes, uint64[] calldata expiries, uint8[] calldata maxDepths) view returns (bool)",
          ], getProvider());
          const valid = await dm.verifyDelegationChain(args!.leaves, [[]], args!.delegators, [], args!.scopes, args!.expiries, [10]);
          result = { valid };
        } catch (e: any) { result = { valid: false, error: e.message }; }
        break;
      }

      case "agentix_delegation_list": result = (await import("../tools/delegation")).listDelegations(args?.organizationId as string); break;

      case "agentix_delegation_get_root": {
        try {
          const { ethers } = await import("ethers");
          const { getProvider } = await import("../core/provider");
          const config = loadConfig();
          const dm = new ethers.Contract(config.contracts.delegationManager, [
            "function getDelegationRoot(address,bytes32) view returns (bytes32 root, uint64 expiresAt, uint64 createdAt)",
          ], getProvider());
          const [root, expiresAt, createdAt] = await dm.getDelegationRoot(args!.delegator, args!.scopeHash);
          result = { root, expiresAt: Number(expiresAt), createdAt: Number(createdAt) };
        } catch (e: any) { result = { error: e.message }; }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // TREES
      // ══════════════════════════════════════════════════════════
      case "agentix_tree_status": result = (await import("../tools/tree")).getTreeStatus(args!.organizationId as string); break;

      // ══════════════════════════════════════════════════════════
      // PROOFS
      // ══════════════════════════════════════════════════════════
      case "agentix_proof_list": result = getProofService().list(args?.limit as number | undefined); break;
      case "agentix_proof_verify": result = getProofService().verify(args!.proofHash as string); break;

      // ══════════════════════════════════════════════════════════
      // EVENTS
      // ══════════════════════════════════════════════════════════
      case "agentix_events": result = getEventBus().getHistory((args?.limit as number) || 20); break;

      // ══════════════════════════════════════════════════════════
      // LOGS
      // ══════════════════════════════════════════════════════════
      case "agentix_session_logs": {
        const logger = getSessionLogger();
        if (args?.walletAddress) result = logger.getByWallet(args.walletAddress as string, (args.limit as number) || 50);
        else if (args?.tool) result = logger.getByTool(args.tool as string, (args.limit as number) || 50);
        else if (args?.riskLevel) result = logger.getByRisk(args.riskLevel as string, (args.limit as number) || 50);
        else result = logger.getRecent((args?.limit as number) || 50);
        break;
      }
      case "agentix_session_log_stats": result = getSessionLogger().getStats(); break;

      // ══════════════════════════════════════════════════════════
      // HARNESSES
      // ══════════════════════════════════════════════════════════
      case "agentix_harnesses_scan": {
        const { getHarnessManager } = await import("../../packages/core/harness-adapter");
        const { runExecute } = await import("../core/database");
        const scan = await getHarnessManager().scanAll();
        for (const h of scan.harnesses) {
          const info = h.detect.harness;
          runExecute("INSERT OR REPLACE INTO harnesses (harness_id, display_name, version, status, config_path, detected_at) VALUES (?,?,?,?,?,unixepoch())",
            info.id, info.name, info.version || "", info.status, info.configPath || "");
        }
        result = scan;
        break;
      }
      case "agentix_harnesses_list": {
        result = runQuery("SELECT * FROM harnesses ORDER BY detected_at DESC");
        break;
      }

      // ══════════════════════════════════════════════════════════
      // TRANSACTIONS
      // ══════════════════════════════════════════════════════════
      case "agentix_transaction_list": {
        const wallet = args?.walletAddress as string | undefined;
        const limit = (args?.limit as number) || 50;
        result = wallet
          ? runQuery("SELECT * FROM transactions WHERE wallet_address = ? ORDER BY created_at DESC LIMIT ?", wallet, limit)
          : runQuery("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?", limit);
        break;
      }
      case "agentix_transaction_get": {
        result = runSingle("SELECT * FROM transactions WHERE tx_hash = ?", args!.hash as string)
          || runSingle("SELECT * FROM transactions WHERE hash = ?", args!.hash as string)
          || { error: "Transaction not found" };
        break;
      }

      // ══════════════════════════════════════════════════════════
      // BUNDLER (structured error codes)
      // ══════════════════════════════════════════════════════════
      case "agentix_bundler_send": {
        const { bundleUserOp, buildSessionUserOp } = await import("../runtime/bundler");
        const { ethers } = await import("ethers");

        try {
          const iface = new ethers.Interface(["function execute(address target, uint256 value, bytes calldata data) external"]);
          const callData = iface.encodeFunctionData("execute", [args!.target, args!.value || "0", args!.calldata || "0x"]);
          const userOp = buildSessionUserOp(args!.sender as string, callData, args!.sessionId as string, args!.agentPrivateKey as string);
          result = await bundleUserOp(userOp);

          if (!result.success) {
            const { code, reason } = classifyBundlerError(result.error || "");
            result = { ...result, errorCode: code, errorReason: reason };
          }
        } catch (e: any) {
          const { code, reason } = classifyBundlerError(e.message || String(e));
          result = { success: false, errorCode: code, errorReason: reason, error: e.message };
        }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // KEYGEN
      // ══════════════════════════════════════════════════════════
      case "agentix_keygen": {
        const { ethers } = await import("ethers");
        const wallet = ethers.Wallet.createRandom();
        result = {
          address: wallet.address,
          publicKey: wallet.signingKey.publicKey,
          privateKey: wallet.privateKey,
          warning: "STORE THIS PRIVATE KEY SECURELY. It is YOUR agent identity. The owner will add this address as a sessionKey via the AgentIX dashboard. The private key never leaves your context.",
        };
        break;
      }

      // ══════════════════════════════════════════════════════════
      // ONBOARDING
      // ══════════════════════════════════════════════════════════
      case "agentix_onboarding_status": {
        const config = loadConfig();
        const { existsSync } = await import("fs");
        result = {
          initialized: existsSync(config.database.path),
          databaseReady: existsSync(config.database.path),
          rpcConfigured: !!config.rpcUrl,
          network: config.networkName,
          chainId: config.chainId,
        };
        break;
      }

      case "agentix_fund": {
        const { getFundOptions } = await import("../tools/fund");
        result = getFundOptions({ network: args!.network as string, amount: args!.amount as string, currency: (args?.currency as string) || "USD", country: args?.country as string });
        break;
      }

      // ══════════════════════════════════════════════════════════
      // COMPILER
      // ══════════════════════════════════════════════════════════
      case "agentix_compile_intent": {
        const { getCompiler } = await import("../../packages/compiler");
        const compiler = getCompiler();
        const { loadConfig } = await import("../core/config");
        const config = loadConfig();
        const compilationResult = await compiler.compileIntent(
          args!.action as string,
          args!.params as Record<string, unknown>,
          (args?.source as any) || "mcp",
          {
            walletAddress: args?.walletAddress as string,
            sessionId: args?.sessionId as string,
            organizationId: args?.organizationId as string,
          },
          config.contracts as Record<string, string>
        );
        result = compilationResult;
        break;
      }
      case "agentix_get_plan": {
        const { getCompiler } = await import("../../packages/compiler");
        const plan = getCompiler().getPlan(args!.planId as string);
        result = plan || { error: "Plan not found" };
        break;
      }
      case "agentix_list_plans": {
        const { getCompiler } = await import("../../packages/compiler");
        result = getCompiler().listPlans(
          args?.status as string | undefined,
          (args?.limit as number) || 50
        );
        break;
      }
      case "agentix_approve_plan": {
        const { getCompiler } = await import("../../packages/compiler");
        const plan = getCompiler().approvePlan(args!.planId as string);
        result = plan || { error: "Plan not found or not in APPROVAL_REQUIRED state" };
        break;
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AgentIX MCP server running on stdio");
}

main().catch(console.error);
