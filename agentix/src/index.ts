import { program } from "commander";
import { loadConfig, saveConfig, ensureDirectories, AGENTIX_HOME } from "./core/config";
import { getDatabase } from "./core/database";
import { getProxyGuard } from "./core/proxy-guard";
import { logger } from "./core/logger";
import { getCompilerGateway } from "./compiler-gateway";
import {
  initializeAgentix,
  showDeploymentStatus,
} from "./tools/deployment";
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  deactivateOrganization,
  reactivateOrganization,
} from "./tools/organization";
import {
  createWallet,
  getWalletInfo,
  whitelistAddress,
  executeTransaction,
  executeBatch,
  depositGas,
  withdrawGas,
} from "./tools/wallet";
import {
  issueCredential,
  revokeCredential,
  getCredential,
  listCredentials,
} from "./tools/credential";
import {
  createLightweightSession,
  validateSession,
  revokeSession,
  getSession,
  listWalletSessions,
} from "./tools/session";
import {
  generateLocalProof,
  verifyProof,
  listProofs,
} from "./tools/proof";
import {
  getTreeStatus,
  rebuildTree,
  exportTree,
  importTree,
  snapshotTree,
  restoreTree,
} from "./tools/tree";
import {
  createDelegation,
  revokeDelegation,
  getDelegation,
  listDelegations,
} from "./tools/delegation";
import {
  registerCapability,
  getCapability,
  listCapabilities,
  revokeCapability,
} from "./tools/capability";
import {
  createBackup,
  listBackups,
  restoreBackup,
  exportBackup,
  importBackup,
} from "./tools/backup";
import {
  getConfig,
  setConfig,
  resetConfig,
  showConfig,
} from "./tools/config-tool";
import {
  runHealthCheck,
} from "./tools/health";
import {
  testRpcConnection,
  getRpcStatus,
} from "./tools/rpc-tool";
import {
  runDiagnostics,
} from "./tools/diagnostics";
import { getHelp } from "./tools/help";
import { runFullDiagnostics, initializeFullRuntime } from "./tools/wizard";
import { getFundOptions } from "./tools/fund";
import { runSetupWizard } from "./tools/setup-wizard";

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
};

function log(msg = "", color = C.reset) { console.log(`${color}${msg}${C.reset}`); }
function ok(msg: string) { log(`  ${C.green}✓${C.reset} ${msg}`); }
function err(msg: string) { log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { log(`  ${C.blue}ℹ${C.reset} ${msg}`); }
function warn(msg: string) { log(`  ${C.yellow}⚠${C.reset} ${msg}`); }
function label(k: string, v: string) { log(`  ${C.bold}${k}${C.reset}:  ${v}`); }

function printResult(result: any, title?: string) {
  if (title) { log(`\n  ${C.bold}${title}${C.reset}`); log("  " + "─".repeat(title.length)); }
  if (result.success === false) {
    err(result.error || "Operation failed");
    return;
  }
  for (const [k, v] of Object.entries(result)) {
    if (k === "success" || k === "error") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as any)) {
        label(`${k}.${k2}`, String(v2).slice(0, 80));
      }
    } else if (Array.isArray(v)) {
      label(k, `${v.length} items`);
    } else {
      label(k, String(v).slice(0, 80));
    }
  }
  log();
}

function printHealth(result: any) {
  const icon = result.status === "HEALTHY" ? C.green : result.status === "DEGRADED" ? C.yellow : C.red;
  log(`\n  ${C.bold}AgentIX Health Check${C.reset} — ${icon}${result.status}${C.reset}\n`);

  for (const check of result.checks) {
    const c = check.status === "PASS" ? C.green : check.status === "WARNING" ? C.yellow : C.red;
    log(`  ${c}${check.status}${C.reset}  ${C.bold}${check.name}${C.reset}`);
    log(`         ${check.message}`);
  }
  log();
}

function printDiagnostics(result: any) {
  log(`\n  ${C.bold}AgentIX Diagnostics${C.reset}\n`);
  for (const section of result.sections) {
    const c = section.status === "OK" ? C.green : section.status === "WARNING" ? C.yellow : section.status === "ERROR" ? C.red : C.dim;
    log(`  ${c}▸ ${section.name}${C.reset}`);
    for (const item of section.items) {
      const ic = item.status === "OK" ? C.green : item.status === "WARNING" ? C.yellow : item.status === "ERROR" ? C.red : C.dim;
      log(`    ${ic}•${C.reset} ${C.bold}${item.label}${C.reset}: ${item.value}`);
    }
    log();
  }
}

// Resolve the CLI version robustly across BOTH runtime shapes:
//   - source (tsx):   __dirname = src/,           package.json is at ../package.json
//   - bundled (esbuild): __dirname = dist-publish/, package.json is at ./package.json
// A hardcoded fallback guarantees `--version` never crashes the process even if the
// manifest can't be located (e.g. a partial install).
function resolveVersion(): string {
  const path = require("path");
  const fs = require("fs");
  const candidates = [
    path.join(__dirname, "package.json"),        // bundled: dist-publish/package.json
    path.join(__dirname, "..", "package.json"),  // source:  agentix/package.json
    path.join(__dirname, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (parsed && typeof parsed.version === "string") return parsed.version;
      }
    } catch {
      // ignore and try the next candidate
    }
  }
  return "1.0.0";
}
const pkg = { version: resolveVersion() };

program
  .name("agentix")
  .description("AgentIX V1 — Local-first AI agent credential protocol runtime")
  .version(pkg.version);

// ── agentix init ──────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialize AgentIX local runtime")
  .option("--rpc <url>", "RPC endpoint URL")
  .option("--connect-harnesses", "Also wire detected AI harnesses into the AgentIX MCP server (writes to their configs)")
  .action(async (opts) => {
    log("\n  ╔══════════════════════════════════════════════════════════╗", C.cyan);
    log("  ║            Welcome to AgentIX                            ║", C.cyan);
    log("  ╚══════════════════════════════════════════════════════════╝", C.cyan);
    log();

    // Use the enhanced wizard for initialization. Harness wiring is opt-in
    // (--connect-harnesses) so a plain `init` never mutates external IDE configs.
    const result = await initializeFullRuntime(opts.rpc, !!opts.connectHarnesses);

    for (const step of result.steps) {
      const icon = step.status === "done" ? `${C.green}✔${C.reset}` :
                   step.status === "skip" ? `${C.yellow}⏭${C.reset}` :
                   step.status === "error" ? `${C.red}✘${C.reset}` :
                   `${C.dim}○${C.reset}`;
      const duration = step.duration ? ` ${C.dim}(${step.duration}ms)${C.reset}` : '';
      log(`  ${icon} ${step.name}${duration}`);
      if (step.message && step.status !== "done") {
        log(`    ${C.dim}${step.message}${C.reset}`);
      }
    }

    log();

    if (result.success) {
      log("  ╔══════════════════════════════════════════════════════════╗", C.green);
      log("  ║            Initialization Complete                       ║", C.green);
      log("  ╚══════════════════════════════════════════════════════════╝", C.green);
      log();
      log(`  ${C.bold}Runtime:${C.reset}    ${AGENTIX_HOME}`);
      log(`  ${C.bold}Database:${C.reset}   ${result.config.database.path}`);
      log(`  ${C.bold}Network:${C.reset}    ${result.config.networkName} (Chain ${result.config.chainId})`);
      log(`  ${C.bold}Harnesses:${C.reset}  ${result.harnessesDetected} detected, ${result.harnessesConnected} connected`);
      log();
      log(`  ${C.bold}Next steps:${C.reset}`);
      log(`    1. Configure RPC:    ${C.cyan}agentix config set rpcUrl <your-rpc-url>${C.reset}`);
      log(`    2. Start the stack:  ${C.cyan}bun run serve${C.reset}  ${C.dim}(auto-picks free ports)${C.reset}`);
      log(`    3. Wire AI harnesses:${C.cyan}agentix connect${C.reset}  ${C.dim}(optional — edits IDE configs)${C.reset}`);
      log(`    4. Run diagnostics:  ${C.cyan}agentix doctor${C.reset}`);
      log();
    } else {
      log("  ╔══════════════════════════════════════════════════════════╗", C.red);
      log("  ║            Initialization Failed                        ║", C.red);
      log("  ╚══════════════════════════════════════════════════════════╝", C.red);
      log();
      const failed = result.steps.filter(s => s.status === "error");
      for (const step of failed) {
        log(`  ${C.red}✘${C.reset} ${step.name}: ${step.message}`);
      }
      log();
    }
  });

// ── agentix setup ─────────────────────────────────────────────────────
// Modern interactive wizard: verifies env, creates storage, configures RPC
// (public by default, optional provider key), and auto-wires every detected
// AI harness into the AgentIX MCP server so tools work immediately.
program
  .command("setup")
  .description("Interactive setup wizard — deps, RPC, and MCP auto-wiring")
  .option("--rpc <url>", "Use a specific RPC endpoint (skips the RPC prompt)")
  .option("-y, --yes", "Non-interactive: accept defaults, use public RPC")
  .action(async (opts) => {
    const success = await runSetupWizard({ rpc: opts.rpc, yes: opts.yes });
    process.exit(success ? 0 : 1);
  });

// ── agentix connect ───────────────────────────────────────────────────
// Re-scan for AI harnesses and wire the AgentIX MCP server into each. Useful
// after installing a new harness post-setup.
program
  .command("connect")
  .description("Detect AI harnesses and wire in AgentIX MCP tools")
  .action(async () => {
    log(`\n  ${C.cyan}${C.bold}AgentIX — Harness Connector${C.reset}\n`);
    try {
      const { getHarnessManager } = await import("../packages/core/harness-adapter");
      const manager = getHarnessManager();
      const scan = await manager.scanAll();
      const found = scan.harnesses.filter((h: any) => h.detect.found);
      if (found.length === 0) {
        warn("No AI harnesses detected. Install one (Claude Code, Cursor, Copilot, ...) and re-run.");
        log();
        return;
      }
      for (const h of found) {
        const state = h.detect.alreadyConnected ? `${C.green}connected${C.reset}` : `${C.cyan}detected${C.reset}`;
        log(`  ${C.blue}◆${C.reset} ${C.bold}${h.adapter.name}${C.reset} — ${state}`);
      }
      // Re-wire every detected harness so stale entries from older versions are
      // healed (connectAll skips "already connected", which can be a dead path).
      let wired = 0, failed = 0;
      for (const h of found) {
        try {
          const res = await h.adapter.connect();
          res.success ? wired++ : failed++;
        } catch { failed++; }
      }
      log();
      ok(`Wired AgentIX MCP into ${wired}/${found.length} harness(es)` +
        (failed ? ` (${failed} failed)` : ""));
      log();
    } catch (e: any) {
      err(`Harness connection failed: ${e.message}`);
      log();
    }
  });

// ── agentix health ────────────────────────────────────────────────────
// Quick health check. The comprehensive 12-point diagnostics live under the
// `doctor` command (defined later); this fast check is exposed as `health` to
// avoid a duplicate-command clash that would shadow `doctor`.
program
  .command("health")
  .description("Run a quick health check on the AgentIX runtime")
  .action(async () => {
    const result = await runHealthCheck();
    printHealth(result);
  });

// ── agentix diagnostics ──────────────────────────────────────────────
program
  .command("diagnostics")
  .description("Run full system diagnostics")
  .action(async () => {
    const result = await runDiagnostics();
    printDiagnostics(result);
  });

// ── agentix config ────────────────────────────────────────────────────
program
  .command("config")
  .description("Manage AgentIX configuration")
  .argument("[action]", "get, set, show, or reset")
  .argument("[key]", "Configuration key")
  .argument("[value]", "Configuration value (for set)")
  .action(async (action, key, value) => {
    if (action === "set" && key && value) {
      const result = setConfig(key, value);
      if (result.success) ok(`${key} = ${value}`);
      else err(result.error || "Failed");
    } else if (action === "get" && key) {
      const result = getConfig(key);
      if (result.success) label(key, String(result.value));
      else err(result.error || "Not found");
    } else if (action === "reset") {
      resetConfig();
      ok("Configuration reset to defaults");
    } else {
      const result = showConfig();
      if (result.config) {
        log(`\n  ${C.bold}AgentIX Configuration${C.reset}\n`);
        for (const [k, v] of Object.entries(result.config)) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            log(`  ${C.bold}${k}${C.reset}:`);
            for (const [k2, v2] of Object.entries(v as any)) {
              label(`  ${k2}`, String(v2).slice(0, 60));
            }
          } else {
            label(k, String(v).slice(0, 60));
          }
        }
        log();
      }
    }
  });

// ── agentix org ───────────────────────────────────────────────────────
program
  .command("org")
  .description("Manage organizations")
  .argument("[action]", "create, get, list, deactivate, reactivate")
  .argument("[id]", "Organization ID (for get/deactivate/reactivate)")
  .option("--name <name>", "Organization name (for create)")
  .option("--owner <address>", "Owner address (for create)")
  .action(async (action, id, opts) => {
    try {
      if (action === "create") {
        const result = await createOrganization(opts.name, opts.owner);
        printResult(result, "Create Organization");
      } else if (action === "get" && id) {
        const result = await getOrganization(id);
        printResult(result, "Organization Details");
      } else if (action === "list") {
        const results = await listOrganizations();
        log(`\n  ${C.bold}Organizations${C.reset}\n`);
        for (const r of results) {
          if (r.success) {
            const icon = r.active ? C.green : C.red;
            log(`  ${icon}●${C.reset} ${C.bold}${r.name}${C.reset}`);
            log(`    ID: ${r.organizationId}`);
            log(`    Owner: ${r.owner}`);
            log(`    Anchor: ${r.credentialAnchor}`);
          }
        }
        log();
      } else if (action === "deactivate" && id) {
        const result = await deactivateOrganization(id);
        printResult(result, "Deactivate Organization");
      } else if (action === "reactivate" && id) {
        const result = await reactivateOrganization(id);
        printResult(result, "Reactivate Organization");
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix cred ──────────────────────────────────────────────────────
program
  .command("cred")
  .description("Manage credentials")
  .argument("[action]", "issue, revoke, get, list")
  .option("--org <id>", "Organization ID")
  .option("--agent <id>", "Agent ID")
  .option("--permissions <bits>", "Permission bitmask", "1")
  .option("--expiry <seconds>", "Expiry from now (seconds)", "86400")
  .option("--budget <eth>", "Budget limit in ETH", "0.1")
  .option("--wallet <address>", "Wallet address for the agent")
  .option("--owner <address>", "Owner address")
  .action(async (action, opts) => {
    try {
      const gateway = getCompilerGateway();

      if (action === "issue") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('credential_issue', {
          orgId: opts.org,
          budgetLimit: opts.budget,
          expiryDuration: parseInt(opts.expiry, 10),
          expiryUnit: "days",
          walletAddress: opts.wallet || "",
          ownerAddress: opts.owner || "",
        }, 'cli');
        if (result.requiresApproval) {
          warn("This action requires owner approval");
          log(`  ${result.explanation}`);
        } else if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Issue Credential");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "revoke") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('credential_revoke', {
          organizationId: opts.org,
          agentId: parseInt(opts.agent, 10),
        }, 'cli');
        if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Revoke Credential");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "get") {
        const result = await getCredential(opts.org, parseInt(opts.agent, 10));
        printResult(result, "Credential Details");
      } else if (action === "list") {
        const results = await listCredentials(opts.org);
        log(`\n  ${C.bold}Credentials for Org ${opts.org}${C.reset}\n`);
        for (const r of results) {
          const icon = r.error ? C.red : C.green;
          log(`  ${icon}●${C.reset} Agent #${r.agentId} — ${r.credentialId?.slice(0, 20)}...`);
        }
        log();
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix session ───────────────────────────────────────────────────
program
  .command("session")
  .description("Manage sessions")
  .argument("[action]", "create, validate, revoke, get, list")
  .option("--wallet <address>", "Wallet address")
  .option("--session-key <address>", "Session key address")
  .option("--session-id <id>", "Session ID (for validate, revoke, get)")
  .option("--daily-spend <wei>", "Daily spend limit", "1000000000000000000")
  .option("--daily-tx <count>", "Daily transaction limit", "100")
  .option("--expiry <seconds>", "Session expiry (seconds)", "3600")
  .option("--signer <address>", "Signer address (for validate)")
  .option("--value <eth>", "Value to validate (for validate)")
  .action(async (action, opts) => {
    try {
      const gateway = getCompilerGateway();

      if (action === "create") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('session_create', {
          walletAddress: opts.wallet,
          sessionKey: opts["session-key"],
          dailySpendLimit: opts["daily-spend"],
          dailyTxLimit: parseInt(opts["daily-tx"], 10),
          expiry: Math.floor(Date.now() / 1000) + parseInt(opts.expiry, 10),
        }, 'cli', { walletAddress: opts.wallet });
        if (result.requiresApproval) {
          warn("This action requires owner approval");
          log(`  ${result.explanation}`);
        } else if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Create Session");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "validate") {
        if (!opts["session-id"]) { err("--session-id is required"); return; }
        const result = await validateSession(opts["session-id"], opts.signer, opts.value);
        printResult(result, "Validate Session");
      } else if (action === "revoke") {
        if (!opts["session-id"]) { err("--session-id is required"); return; }
        // Route through compiler gateway
        const result = await gateway.executeIntent('session_revoke', {
          sessionId: opts["session-id"],
          walletAddress: opts.wallet,
        }, 'cli', { walletAddress: opts.wallet });
        if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Revoke Session");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "get") {
        if (!opts["session-id"]) { err("--session-id is required"); return; }
        const result = await getSession(opts["session-id"]);
        printResult(result, "Session Details");
      } else if (action === "list") {
        const results = await listWalletSessions(opts.wallet);
        log(`\n  ${C.bold}Sessions for ${opts.wallet}${C.reset}\n`);
        for (const r of results) {
          const icon = r.error ? C.red : C.green;
          log(`  ${icon}●${C.reset} ${r.sessionId?.slice(0, 20)}... key=${r.sessionKey?.slice(0, 12)}...`);
        }
        log();
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix wallet ────────────────────────────────────────────────────
program
  .command("wallet")
  .description("Manage wallets")
  .argument("[action]", "create, get, whitelist, execute, batch, deposit, withdraw")
  .argument("[address]", "Wallet address")
  .option("--owner <address>", "Owner address (for create)")
  .option("--to <address>", "Recipient address")
  .option("--value <eth>", "ETH value")
  .option("--party <address>", "Party address (for whitelist)")
  .option("--data <hex>", "Calldata", "0x")
  .option("--recipient <address>", "Recipient (for withdraw)")
  .action(async (action, address, opts) => {
    try {
      const gateway = getCompilerGateway();

      if (action === "create") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('wallet_create', {
          ownerAddress: opts.owner,
        }, 'cli');
        if (result.requiresApproval) {
          warn("This action requires owner approval");
          log(`  ${result.explanation}`);
        } else if (result.success) {
          printResult(result, "Create Wallet");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "get") {
        const result = await getWalletInfo(address);
        printResult(result, "Wallet Info");
      } else if (action === "whitelist") {
        const result = await whitelistAddress(address, opts.party);
        printResult(result, "Whitelist Address");
      } else if (action === "execute") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('wallet_execute', {
          walletAddress: address,
          target: opts.to,
          value: opts.value || "0",
          data: opts.data || "0x",
        }, 'cli', { walletAddress: address });
        if (result.requiresApproval) {
          warn("This action requires owner approval");
          log(`  ${result.explanation}`);
        } else if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Execute Transaction");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "batch") {
        const targets = opts.to?.split(",") || [];
        const values = opts.value?.split(",") || [];
        // Route through compiler gateway
        const result = await gateway.executeIntent('wallet_execute_batch', {
          walletAddress: address,
          targets,
          values,
        }, 'cli', { walletAddress: address });
        if (result.requiresApproval) {
          warn("This action requires owner approval");
          log(`  ${result.explanation}`);
        } else if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Batch Transaction");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "deposit") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('wallet_deposit', {
          walletAddress: address,
          amount: opts.value,
        }, 'cli', { walletAddress: address });
        if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Deposit Gas");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      } else if (action === "withdraw") {
        // Route through compiler gateway
        const result = await gateway.executeIntent('wallet_withdraw', {
          walletAddress: address,
          recipient: opts.recipient,
          amount: opts.value,
        }, 'cli', { walletAddress: address });
        if (result.success) {
          printResult({ success: true, txHash: result.txHash }, "Withdraw Gas");
        } else {
          err(result.errors?.join(", ") || "Failed");
        }
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix tree ──────────────────────────────────────────────────────
program
  .command("tree")
  .description("Manage Merkle trees")
  .argument("[action]", "status, rebuild, export, import, snapshot, restore")
  .argument("[orgId]", "Organization ID")
  .option("--file <path>", "File path (for import/export)")
  .action(async (action, orgId, opts) => {
    try {
      if (action === "status") {
        const result = await getTreeStatus(orgId);
        printResult(result, "Tree Status");
      } else if (action === "rebuild") {
        const result = await rebuildTree(orgId);
        printResult(result, "Rebuild Trees");
      } else if (action === "export") {
        const result = await exportTree(orgId, opts.file);
        printResult(result, "Export Trees");
      } else if (action === "import") {
        const result = await importTree(orgId, opts.file);
        printResult(result, "Import Trees");
      } else if (action === "snapshot") {
        const result = await snapshotTree(orgId);
        printResult(result, "Snapshot Trees");
      } else if (action === "restore") {
        const result = await restoreTree(orgId);
        printResult(result, "Restore Trees");
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix delegation ────────────────────────────────────────────────
program
  .command("delegation")
  .description("Manage delegations")
  .argument("[action]", "create, revoke, get, list")
  .option("--org <id>", "Organization ID")
  .option("--delegator <address>", "Delegator address")
  .option("--delegatee <address>", "Delegatee address")
  .option("--scope <scope>", "Delegation scope")
  .option("--max-value <eth>", "Max value", "0")
  .option("--expiry <seconds>", "Expiry (seconds)", "86400")
  .option("--id <delegation-id>", "Delegation ID (for revoke, get)")
  .action(async (action, opts) => {
    try {
      if (action === "create") {
        const expiry = Math.floor(Date.now() / 1000) + parseInt(opts.expiry, 10);
        const result = await createDelegation(opts.org, opts.delegator, opts.delegatee, opts.scope, opts["max-value"], expiry);
        printResult(result, "Create Delegation");
      } else if (action === "revoke") {
        if (!opts.id) { err("--id is required"); return; }
        const result = await revokeDelegation(opts.id);
        printResult(result, "Revoke Delegation");
      } else if (action === "get") {
        if (!opts.id) { err("--id is required"); return; }
        const result = await getDelegation(opts.id);
        printResult(result, "Delegation Details");
      } else if (action === "list") {
        const results = await listDelegations(opts.org);
        log(`\n  ${C.bold}Delegations for Org ${opts.org}${C.reset}\n`);
        for (const r of results) {
          const icon = r.active ? C.green : C.red;
          log(`  ${icon}●${C.reset} ${r.delegator?.slice(0, 12)}... → ${r.delegatee?.slice(0, 12)}... (${r.scope})`);
        }
        log();
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix capability ────────────────────────────────────────────────
program
  .command("capability")
  .description("Manage capabilities")
  .argument("[action]", "register, revoke, get, list")
  .option("--org <id>", "Organization ID")
  .option("--name <name>", "Capability name")
  .option("--description <desc>", "Capability description")
  .option("--id <capability-id>", "Capability ID (for revoke, get)")
  .action(async (action, opts) => {
    try {
      if (action === "register") {
        const result = await registerCapability(opts.org, opts.name, opts.description);
        printResult(result, "Register Capability");
      } else if (action === "revoke") {
        if (!opts.id) { err("--id is required"); return; }
        const result = await revokeCapability(opts.id);
        printResult(result, "Revoke Capability");
      } else if (action === "get") {
        if (!opts.id) { err("--id is required"); return; }
        const result = await getCapability(opts.id);
        printResult(result, "Capability Details");
      } else if (action === "list") {
        const results = await listCapabilities(opts.org);
        log(`\n  ${C.bold}Capabilities for Org ${opts.org}${C.reset}\n`);
        for (const r of results) {
          const icon = r.active ? C.green : C.red;
          log(`  ${icon}●${C.reset} ${C.bold}${r.name}${C.reset}: ${r.description}`);
        }
        log();
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix proof ─────────────────────────────────────────────────────
program
  .command("proof")
  .description("Generate and verify proofs")
  .argument("[action]", "generate, verify, list")
  .option("--org <id>", "Organization ID")
  .option("--agent <id>", "Agent ID")
  .option("--nullifier <hash>", "Nullifier hash")
  .option("--secret <hex>", "Secret hex")
  .option("--wallet <address>", "Wallet address")
  .option("--expiry <seconds>", "Session expiry", "3600")
  .option("--hash <hash>", "Proof hash (for verify)")
  .action(async (action, opts) => {
    try {
      if (action === "generate") {
        const expiry = Math.floor(Date.now() / 1000) + parseInt(opts.expiry, 10);
        const result = await generateLocalProof(opts.org, parseInt(opts.agent, 10), opts.nullifier, opts.secret, opts.wallet, expiry);
        printResult(result, "Generate Proof");
      } else if (action === "verify") {
        const result = await verifyProof(opts.hash);
        printResult(result, "Verify Proof");
      } else if (action === "list") {
        const results = await listProofs();
        log(`\n  ${C.bold}Recent Proofs${C.reset}\n`);
        for (const r of results) {
          const icon = r.valid ? C.green : C.red;
          log(`  ${icon}●${C.reset} ${r.proofHash?.slice(0, 20)}... nullifier=${r.nullifier?.slice(0, 12)}...`);
        }
        log();
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix backup ────────────────────────────────────────────────────
program
  .command("backup")
  .description("Manage backups")
  .argument("[action]", "create, list, restore, export, import")
  .option("--id <backupId>", "Backup ID")
  .option("--file <path>", "File path (for export/import)")
  .option("--description <desc>", "Backup description")
  .action(async (action, opts) => {
    try {
      if (action === "create") {
        const result = await createBackup(opts.description);
        printResult(result, "Create Backup");
      } else if (action === "list") {
        const results = await listBackups();
        log(`\n  ${C.bold}Backups${C.reset}\n`);
        for (const r of results) {
          log(`  ${C.green}●${C.reset} ${C.bold}${r.backupId}${C.reset} — ${r.size} bytes`);
        }
        log();
      } else if (action === "restore") {
        const result = await restoreBackup(opts.id);
        printResult(result, "Restore Backup");
      } else if (action === "export") {
        const result = await exportBackup(opts.id, opts.file);
        printResult(result, "Export Backup");
      } else if (action === "import") {
        const result = await importBackup(opts.file);
        printResult(result, "Import Backup");
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── agentix contracts ────────────────────────────────────────────────
program
  .command("contracts")
  .description("List contract addresses")
  .action(() => {
    const guard = getProxyGuard();
    const proxies = guard.listAllProxies();
    log(`\n  ${C.bold}AgentIX Proxy Contracts (Base Sepolia)${C.reset}\n`);
    for (const [name, addr] of Object.entries(proxies)) {
      label(name, addr);
    }
    log();
    info("Implementation addresses are internal — NEVER interact with them directly");
    log();
  });

// ── agentix rpc ───────────────────────────────────────────────────────
program
  .command("rpc")
  .description("Test RPC connectivity")
  .option("--url <url>", "RPC URL to test")
  .option("--balance <address>", "Check balance of address")
  .action(async (opts) => {
    if (opts.balance) {
      const { getNativeBalance } = await import("./tools/rpc-tool");
      const result = await getNativeBalance(opts.balance);
      if (result.success) label("Balance", `${result.balance} ETH`);
      else err(result.error || "Failed");
    } else {
      const result = await testRpcConnection(opts.url);
      if (result.connected) {
        ok(`Connected to chain ${result.chainId}, block #${result.blockNumber}`);
        label("RPC URL", result.rpcUrl || "");
      } else {
        err(`Connection failed: ${result.error}`);
      }
    }
  });

// ── agentix help (protocol docs) ─────────────────────────────────────
program
  .command("protocol")
  .description("Show AgentIX protocol documentation for AI agents")
  .argument("[topic]", "Topic: organization, credential, session, wallet, tree, delegation, capability, backup, trust, proxy, recovery, migration")
  .action((topic) => {
    const help = getHelp(topic);
    log(help);
  });

// ── agentix wizard ────────────────────────────────────────────────────
program
  .command("wizard")
  .description("Launch the interactive onboarding wizard in your browser")
  .action(async () => {
    log("\n  AgentIX V1 — Onboarding Wizard", C.cyan);
    log("  ═══════════════════════════════════════════\n");

    log("  Opening onboarding wizard in your browser...\n", C.bold);

    log("  Starting services on free ports...", C.bold);

    try {
      const { spawn } = await import("child_process");
      const agentixDir = process.cwd();

      // Delegate to the launcher, which resolves free ports for BOTH the API
      // and the dashboard and records them in the runtime manifest. This never
      // collides with ports already in use on the user's machine.
      const proc = spawn("bun", ["x", "tsx", "scripts/serve.ts"], {
        cwd: agentixDir,
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      proc.unref();

      // Read back the ports the launcher published so we can print real URLs.
      const { readRuntimeManifest } = await import("./core/ports");
      let manifest = readRuntimeManifest();
      for (let i = 0; i < 20 && !manifest.dashboardPort; i++) {
        await new Promise((r) => setTimeout(r, 500));
        manifest = readRuntimeManifest();
      }

      const dashPort = manifest.dashboardPort || 3000;
      const apiPort = manifest.apiPort || 3001;
      const dashUrl = `http://127.0.0.1:${dashPort}`;

      log("  Services started:", C.green);
      log(`    Dashboard: ${C.bold}${dashUrl}${C.reset}`);
      log(`    API: ${C.bold}http://127.0.0.1:${apiPort}${C.reset}`);
      log();
      log(`  Open ${C.bold}${dashUrl}${C.reset} to begin onboarding.`);
      log();
    } catch (e: any) {
      err(`Failed to start services: ${e.message}`);
      log(`  You can manually start with: bun run serve`, C.dim);
    }
  });

// ── agentix fund ──────────────────────────────────────────────────────
program
  .command("fund")
  .description("Get fiat on-ramp options to buy ETH")
  .option("--network <network>", "Network (base, baseSepolia, ethereum, ethereumSepolia)", "baseSepolia")
  .option("--amount <amount>", "Amount in fiat", "10")
  .option("--currency <currency>", "Currency (USD, EUR, GBP, etc.)", "USD")
  .option("--country <country>", "Country code (US, EU, UK, etc.)")
  .action((opts) => {
    log("\n  AgentIX Fund — Buy ETH", C.cyan);
    log("  ═══════════════════════════════════════════\n");

    const result = getFundOptions({
      network: opts.network,
      amount: opts.amount,
      currency: opts.currency,
      country: opts.country,
    });

    label("Network", result.network);
    label("Requested", `${result.requestedAmount} ${result.currency}`);
    log();

    if (result.options.length === 0) {
      warn("No providers found for this network/currency/country combination.");
      log();
      return;
    }

    log("  Available Providers:\n", C.bold);
    for (const option of result.options) {
      log(`  ${C.bold}${option.provider}${C.reset}`);
      log(`    Price:     ${option.estimatedPrice}`);
      log(`    Fees:      ${option.fees}`);
      log(`    You Get:   ${option.estimatedETH}`);
      log(`    Arrives:   ${option.estimatedArrival}`);
      log(`    Link:      ${C.cyan}${option.officialLink}${C.reset}`);
      log();
    }

    log(`  ${C.yellow}⚠${C.reset} ${C.dim}${result.disclaimer}${C.reset}`);
    log();
  });

// ── agentix doctor (enhanced) ────────────────────────────────────────
program
  .command("doctor")
  .description("Run comprehensive health checks on the AgentIX runtime")
  .action(async () => {
    log("\n  AgentIX Doctor — System Diagnostics", C.cyan);
    log("  ═══════════════════════════════════════════\n");

    const result = await runFullDiagnostics();

    for (const section of result.sections) {
      const icon = section.status === "OK" ? C.green : section.status === "WARNING" ? C.yellow : C.red;
      log(`  ${icon}▸ ${C.bold}${section.name}${C.reset}`);

      for (const item of section.items) {
        const ic = item.status === "OK" ? C.green : item.status === "WARNING" ? C.yellow : item.status === "ERROR" ? C.red : C.dim;
        log(`    ${ic}•${C.reset} ${C.bold}${item.label}${C.reset}: ${item.value}`);
        if (item.repair) {
          log(`      ${C.yellow}↳ ${item.repair}${C.reset}`);
        }
      }
      log();
    }

    log(`  ${C.bold}Summary${C.reset}: ${result.summary}`);
    log(`  ${C.dim}Overall: ${result.overall} | Repairable: ${result.repairable}${C.reset}`);
    log();
  });

// ══════════════════════════════════════════════════════════════════════
//  PATH 1: SIMPLE (No Org) — Wallet + Lightweight Sessions + Delegation
// ══════════════════════════════════════════════════════════════════════

import {
  quickCreateWallet,
  quickGetWallet,
  quickListWallets,
  quickCreateSession,
  quickValidateSession,
  quickRevokeSession,
  quickListSessions,
  quickWhitelist,
  quickExecute,
  quickCreateDelegation,
  quickVerifyDelegation,
  quickDeposit,
  quickBalance,
} from "./tools/quick";

// ── agentix agent ──────────────────────────────────────────────────────
program
  .command("agent")
  .description("Quick agent setup (Path 1: No Org required)")
  .argument("[action]", "create, wallet, session, whitelist, execute, balance, deposit, delegation, list")
  .option("--wallet <address>", "Wallet address")
  .option("--owner <address>", "Owner address (for create)")
  .option("--session-key <address>", "Session key address")
  .option("--daily-spend <wei>", "Daily spend limit", "1000000000000000000")
  .option("--daily-tx <count>", "Daily transaction limit", "100")
  .option("--expiry <seconds>", "Session expiry (seconds)", "86400")
  .option("--target <address>", "Target address (for whitelist/execute)")
  .option("--selector <bytes4>", "Function selector (for whitelist)")
  .option("--value <eth>", "ETH value (for execute)")
  .option("--data <hex>", "Calldata (for execute)")
  .option("--delegatee <address>", "Delegatee address (for delegation)")
  .option("--scope <scope>", "Delegation scope")
  .option("--amount <eth>", "Deposit amount")
  .option("--session-id <id>", "Session ID")
  .option("--signer <address>", "Signer address (for validate)")
  .action(async (action, opts) => {
    try {
      log("\n  AgentIX Agent (Path 1: Simple)", C.cyan);
      log("  ═══════════════════════════════════════════\n");

      if (action === "create") {
        const result = await quickCreateWallet(opts.owner);
        printResult(result, "Create Agent Wallet");
        if (result.success) {
          log();
          info("Next steps:");
          log(`  agentix agent whitelist --wallet ${result.walletAddress} --target <contract> --selector <selector>`);
          log(`  agentix agent session --wallet ${result.walletAddress} --session-key <key>`);
        }
      } else if (action === "wallet") {
        if (opts.wallet) {
          const result = quickGetWallet(opts.wallet);
          printResult(result, "Agent Wallet");
        } else {
          const wallets = quickListWallets();
          log(`\n  ${C.bold}Agent Wallets${C.reset}\n`);
          for (const w of wallets) {
            log(`  ${C.green}●${C.reset} ${C.bold}${w.wallet_address}${C.reset}`);
            log(`    Owner: ${w.owner_address}`);
          }
          log();
        }
      } else if (action === "session") {
        if (opts["session-id"] && opts.signer) {
          const result = await quickValidateSession(opts["session-id"], opts.signer, opts.value || "0");
          printResult(result, "Validate Session");
        } else if (opts["session-id"] && opts.wallet) {
          const result = await quickRevokeSession(opts["session-id"], opts.wallet);
          printResult(result, "Revoke Session");
        } else if (opts.wallet && opts["session-key"]) {
          const result = await quickCreateSession(
            opts.wallet, opts["session-key"], opts["daily-spend"],
            parseInt(opts["daily-tx"], 10), parseInt(opts.expiry, 10)
          );
          printResult(result, "Create Lightweight Session");
        } else if (opts.wallet) {
          const sessions = quickListSessions(opts.wallet);
          log(`\n  ${C.bold}Sessions for ${opts.wallet}${C.reset}\n`);
          for (const s of sessions) {
            const icon = s.revoked ? C.red : C.green;
            log(`  ${icon}●${C.reset} ${s.session_id?.slice(0, 20)}... key=${s.session_key?.slice(0, 12)}...`);
          }
          log();
        }
      } else if (action === "whitelist") {
        const result = await quickWhitelist(opts.wallet, opts.target, opts.selector);
        printResult(result, "Whitelist Selector");
      } else if (action === "execute") {
        const result = await quickExecute(opts.wallet, opts.target, opts.value || "0", opts.data || "0x");
        printResult(result, "Execute Transaction");
      } else if (action === "balance") {
        const result = await quickBalance(opts.wallet);
        printResult(result, "Wallet Balance");
      } else if (action === "deposit") {
        const result = await quickDeposit(opts.wallet, opts.amount);
        printResult(result, "Deposit to EntryPoint");
      } else if (action === "delegation") {
        if (opts.wallet && opts.delegatee && opts.scope) {
          const result = await quickCreateDelegation(opts.wallet, opts.delegatee, opts.scope, parseInt(opts.expiry, 10));
          printResult(result, "Create Delegation");
        }
      } else if (action === "list") {
        const wallets = quickListWallets();
        log(`\n  ${C.bold}All Agent Wallets${C.reset}\n`);
        for (const w of wallets) {
          log(`  ${C.green}●${C.reset} ${w.wallet_address} owner=${w.owner_address?.slice(0, 12)}...`);
        }
        log();
      }
    } catch (e: any) {
      err(e.message);
    }
  });

// ── Compiler Commands ──────────────────────────────────────────────
program
  .command("compile <intent-file>")
  .description("Compile an intent JSON file into an execution plan")
  .action(async (intentFile: string) => {
    const fs = require("fs");
    if (!fs.existsSync(intentFile)) return err(`File not found: ${intentFile}`);
    const raw = fs.readFileSync(intentFile, "utf-8");
    const intent = JSON.parse(raw);
    const { getCompiler } = require("../packages/compiler");
    const compiler = getCompiler();
    const { loadConfig } = require("./core/config");
    const config = loadConfig();
    const result = await compiler.compile(intent, undefined, config.contracts);
    if (result.cacheHit) log(`  ${C.blue}⚠${C.reset} Returned from cache\n`);
    if (result.errors.length > 0) {
      log(`  ${C.red}✖${C.reset} Errors:`);
      result.errors.forEach((e: string) => log(`    ${C.red}–${C.reset} ${e}`));
      return;
    }
    if (result.warnings.length > 0) {
      log(`  ${C.yellow}⚠${C.reset} Warnings:`);
      result.warnings.forEach((w: string) => log(`    ${C.yellow}–${C.reset} ${w}`));
    }
    log(`\n  ${C.bold}Execution Plan${C.reset}`);
    log(`  ${C.gray}Plan ID:${C.reset}   ${result.plan.planId}`);
    log(`  ${C.gray}Hash:${C.reset}      ${result.plan.contentHash.slice(0, 20)}...`);
    log(`  ${C.gray}Action:${C.reset}    ${result.plan.intent.normalizedAction}`);
    log(`  ${C.gray}Status:${C.reset}    ${result.plan.status}`);
    log(`  ${C.gray}Risk:${C.reset}      ${result.plan.risk.category} (${result.plan.risk.score}/100)`);
    if (result.plan.requiredSignatures.length > 0) {
      log(`  ${C.gray}Signatures:${C.reset} ${result.plan.requiredSignatures.map((s: any) => s.type).join(", ")}`);
    }
    log(`  ${C.gray}Duration:${C.reset}   ${result.durationMs}ms`);
    log();
  });

program
  .command("execute-plan <plan-id>")
  .description("Execute an approved execution plan")
  .action(async (planId: string) => {
    const { getCompiler } = require("../packages/compiler");
    const plan = getCompiler().executePlan(planId);
    if (!plan) return err(`Plan not found or not in APPROVED state: ${planId}`);
    log(`  ${C.green}✓${C.reset} Plan marked for execution: ${plan.planId}`);
    log(`  Status: ${plan.status}`);
  });

program
  .command("plans")
  .description("List recent execution plans")
  .option("-s, --status <status>", "Filter by status")
  .option("-n, --limit <number>", "Max plans to show", "20")
  .action(async (opts: any) => {
    const { getCompiler } = require("../packages/compiler");
    const plans = getCompiler().listPlans(opts.status, parseInt(opts.limit, 10));
    log(`\n  ${C.bold}Recent Execution Plans${C.reset}\n`);
    if (plans.length === 0) {
      log(`  ${C.gray}No plans found${C.reset}`);
    }
    for (const p of plans) {
      const statusColor = p.status === "COMPLETED" ? C.green : p.status === "FAILED" ? C.red : p.status === "REJECTED" ? C.red : C.yellow;
      log(`  ${statusColor}●${C.reset} ${p.planId.slice(0, 12)}... ${p.intent?.normalizedAction || "N/A"}  ${C.gray}[${p.status}]${C.reset}  ${p.risk?.category || "?"}/${p.risk?.score || "?"}`);
    }
    log();
  });

program
  .command("plan <plan-id>")
  .description("Show execution plan details")
  .action(async (planId: string) => {
    const { getCompiler } = require("../packages/compiler");
    const plan = getCompiler().getPlan(planId);
    if (!plan) return err(`Plan not found: ${planId}`);
    log(`\n  ${C.bold}Plan: ${plan.planId}${C.reset}\n`);
    log(`  ${C.gray}Status:${C.reset}     ${plan.status}`);
    log(`  ${C.gray}Hash:${C.reset}       ${plan.contentHash.slice(0, 20)}...`);
    log(`  ${C.gray}Action:${C.reset}     ${plan.intent.normalizedAction}`);
    log(`  ${C.gray}Source:${C.reset}     ${plan.intent.source}`);
    log(`  ${C.gray}Risk:${C.reset}       ${plan.risk.category} (${plan.risk.score}/100)`);
    log(`  ${C.gray}Created:${C.reset}    ${new Date(plan.createdAt * 1000).toISOString()}`);
    log(`  ${C.gray}Expires:${C.reset}    ${new Date(plan.expiresAt * 1000).toISOString()}`);
    if (plan.txHash) {
      log(`  ${C.gray}TX Hash:${C.reset}   ${plan.txHash}`);
    }
    if (plan.executionGraph.nodes.length > 0) {
      log(`\n  ${C.bold}Execution Steps${C.reset}`);
      plan.executionGraph.nodes.forEach((n: any, i: number) => {
        log(`    ${i + 1}. ${n.type} → ${n.call?.contractName}.${n.call?.function} (${n.call?.value} wei)`);
      });
    }
    log();
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
