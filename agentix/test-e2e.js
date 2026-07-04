#!/usr/bin/env node

const { execSync } = require("child_process");

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  yellow: "\x1b[33m",
};

process.env.AGENTIX_PRIVATE_KEY = "0x703c8a4396cdb0f146880909c66cfb743200de48e28e7a6d782c957c7242a417";

const CLI = "node dist/src/index.js";

function run(cmd) {
  try {
    const result = execSync(`${CLI} ${cmd}`, {
      encoding: "utf-8",
      timeout: 60000,
      env: process.env,
      cwd: __dirname,
    });
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.stdout?.trim() || e.message };
  }
}

function log(msg) { console.log(`${C.cyan}  → ${C.reset}${msg}`); }
function ok(msg) { console.log(`${C.green}  ✓ ${msg}${C.reset}`); }
function fail(msg) { console.log(`${C.red}  ✗ ${msg}${C.reset}`); }
function section(msg) { console.log(`\n${C.bold}${C.cyan}═══ ${msg} ═══${C.reset}`); }

let passed = 0;
let failed = 0;
let total = 0;

function check(name, result) {
  total++;
  if (result.success && !result.output.includes('"error"')) {
    passed++;
    ok(`${name}`);
    return true;
  } else {
    failed++;
    fail(`${name}`);
    if (result.output.length < 500) {
      console.log(`${C.dim}    ${result.output.slice(0, 300)}${C.reset}`);
    }
    return false;
  }
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║  AgentIX V1 — Full End-to-End Test Suite         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════╝${C.reset}`);

  // ════════════════════════════════════════════════════════
  section("1. INITIALIZATION & CONFIG");
  // ════════════════════════════════════════════════════════

  let r = run("init");
  check("agentix init", r);

  r = run("config");
  check("agentix config (show)", r);

  r = run("contracts");
  check("agentix contracts (list proxies)", r);

  // ════════════════════════════════════════════════════════
  section("2. RPC CONNECTIVITY");
  // ════════════════════════════════════════════════════════

  r = run("rpc");
  check("agentix rpc (connect to Base Sepolia)", r);

  // ════════════════════════════════════════════════════════
  section("3. HEALTH & DIAGNOSTICS");
  // ════════════════════════════════════════════════════════

  r = run("doctor");
  check("agentix doctor (8-point health check)", r);

  r = run("diagnostics");
  check("agentix diagnostics (full system)", r);

  // ════════════════════════════════════════════════════════
  section("4. ORGANIZATION MANAGEMENT");
  // ════════════════════════════════════════════════════════

  r = run("org create --name \"TestOrg-E2E\" --owner 0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC");
  check("agentix org create (on-chain)", r);

  // Extract org ID from output
  const orgMatch = r.output.match(/organizationId['":\s]+([0x0-9a-fA-F]+)/i);
  const orgId = orgMatch ? orgMatch[1] : null;
  if (orgId) {
    log(`Org ID: ${orgId.slice(0, 20)}...`);
  } else {
    log("Could not extract org ID, using fallback");
  }

  r = run("org list");
  check("agentix org list", r);

  if (orgId) {
    r = run(`org get ${orgId}`);
    check("agentix org get (by ID)", r);
  }

  // ════════════════════════════════════════════════════════
  section("5. WALLET CREATION");
  // ════════════════════════════════════════════════════════

  r = run("wallet create --owner 0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC");
  check("agentix wallet create (ERC-4337 smart wallet)", r);

  // Extract wallet address
  const walletMatch = r.output.match(/walletAddress['":\s]+(0x[0-9a-fA-F]+)/i);
  const walletAddress = walletMatch ? walletMatch[1] : null;
  if (walletAddress) {
    log(`Wallet: ${walletAddress}`);
  }

  if (walletAddress) {
    r = run(`wallet get ${walletAddress}`);
    check("agentix wallet get (info, balance, owner)", r);

    r = run(`wallet whitelist ${walletAddress} 0xF9604702010B90d7Bac46f9854b338d036758f4A`);
    check("agentix wallet whitelist (add party)", r);
  }

  // ════════════════════════════════════════════════════════
  section("6. CREDENTIAL ISSUANCE");
  // ════════════════════════════════════════════════════════

  const targetOrg = orgId || "0x0000000000000000000000000000000000000000000000000000000000000001";

  r = run(`cred issue --org ${targetOrg} --agent 1 --permissions 255 --expiry 86400`);
  check("agentix cred issue (credential + Merkle tree update)", r);

  // Extract nullifier and secret
  const nullMatch = r.output.match(/nullifier['":\s]+(0x[0-9a-fA-F]+)/i);
  const nullifier = nullMatch ? nullMatch[1] : null;
  const secMatch = r.output.match(/secret['":\s]+([0-9a-fA-F]+)/i);
  const secret = secMatch ? secMatch[1] : null;
  if (nullifier) log(`Nullifier: ${nullifier.slice(0, 20)}...`);
  if (secret) log(`Secret: ${secret.slice(0, 20)}...`);

  // Issue second credential
  r = run(`cred issue --org ${targetOrg} --agent 2 --permissions 128 --expiry 172800`);
  check("agentix cred issue (second credential)", r);

  r = run(`cred list --org ${targetOrg}`);
  check("agentix cred list", r);

  r = run(`cred get --org ${targetOrg} --agent 1`);
  check("agentix cred get (by org+agent)", r);

  // ════════════════════════════════════════════════════════
  section("7. MERKLE TREE OPERATIONS");
  // ════════════════════════════════════════════════════════

  r = run(`tree status ${targetOrg}`);
  check("agentix tree status (roots, epochs, counts)", r);

  r = run(`tree snapshot ${targetOrg}`);
  check("agentix tree snapshot", r);

  r = run(`tree export ${targetOrg}`);
  check("agentix tree export", r);

  r = run(`tree rebuild ${targetOrg}`);
  check("agentix tree rebuild", r);

  // ════════════════════════════════════════════════════════
  section("8. PROOF GENERATION & VERIFICATION");
  // ════════════════════════════════════════════════════════

  if (nullifier && secret && walletAddress) {
    r = run(`proof generate --org ${targetOrg} --agent 1 --nullifier ${nullifier} --secret ${secret} --wallet ${walletAddress} --expiry 3600`);
    check("agentix proof generate (local ZK proof)", r);

    // Extract proof hash
    const proofMatch = r.output.match(/proofHash['":\s]+(0x[0-9a-fA-F]+)/i);
    const proofHash = proofMatch ? proofMatch[1] : null;
    if (proofHash) {
      log(`Proof hash: ${proofHash.slice(0, 20)}...`);
      r = run(`proof verify --hash ${proofHash}`);
      check("agentix proof verify (against current roots)", r);
    }

    r = run("proof list");
    check("agentix proof list", r);
  } else {
    fail("proof generate (missing nullifier/secret/wallet)");
    fail("proof verify (skipped)");
    fail("proof list (skipped)");
  }

  // ════════════════════════════════════════════════════════
  section("9. SESSION MANAGEMENT");
  // ════════════════════════════════════════════════════════

  if (walletAddress) {
    const sessionKey = "0x47b71B49552B16a58e2c4B796bF3bDB25eD9F2C4";

    r = run(`session create --wallet ${walletAddress} --session-key ${sessionKey} --daily-spend 1000000000000000000 --daily-tx 50 --expiry 3600`);
    check("agentix session create (lightweight session)", r);

    // Extract session ID
    const sessMatch = r.output.match(/sessionId['":\s]+(0x[0-9a-fA-F]+)/i);
    const sessionId = sessMatch ? sessMatch[1] : null;
    if (sessionId) {
      log(`Session ID: ${sessionId.slice(0, 20)}...`);

      r = run(`session get ${sessionId}`);
      check("agentix session get", r);

      r = run(`session validate --signer ${sessionKey} --value 0.1 -- ${sessionId}`);
      check("agentix session validate", r);

      r = run(`session revoke --wallet ${walletAddress} -- ${sessionId}`);
      check("agentix session revoke", r);
    }
  } else {
    fail("session create (no wallet)");
    fail("session get (skipped)");
    fail("session validate (skipped)");
    fail("session revoke (skipped)");
  }

  // ════════════════════════════════════════════════════════
  section("10. DELEGATION MANAGEMENT");
  // ════════════════════════════════════════════════════════

  r = run(`delegation create --org ${targetOrg} --delegator 0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC --delegatee 0xF9604702010B90d7Bac46f9854b338d036758f4A --scope "read_credentials" --expiry 86400`);
  check("agentix delegation create", r);

  r = run(`delegation list --org ${targetOrg}`);
  check("agentix delegation list", r);

  // ════════════════════════════════════════════════════════
  section("11. CAPABILITY MANAGEMENT");
  // ════════════════════════════════════════════════════════

  r = run(`capability register --org ${targetOrg} --name "execute_transactions" --description "Allow agent to execute blockchain transactions"`);
  check("agentix capability register", r);

  r = run(`capability list --org ${targetOrg}`);
  check("agentix capability list", r);

  // ════════════════════════════════════════════════════════
  section("12. CREDENTIAL REVOCATION");
  // ════════════════════════════════════════════════════════

  r = run(`cred revoke --org ${targetOrg} --agent 2`);
  check("agentix cred revoke (nullifier moves to revoked tree)", r);

  r = run(`cred list --org ${targetOrg}`);
  check("agentix cred list (shows revoked status)", r);

  // ════════════════════════════════════════════════════════
  section("13. BACKUP & RESTORE");
  // ════════════════════════════════════════════════════════

  r = run("backup create --description \"E2E test backup\"");
  check("agentix backup create", r);

  r = run("backup list");
  check("agentix backup list", r);

  // ════════════════════════════════════════════════════════
  section("14. PROTOCOL DOCUMENTATION");
  // ════════════════════════════════════════════════════════

  r = run("protocol trust");
  check("agentix protocol trust", r);

  r = run("protocol proxy");
  check("agentix protocol proxy", r);

  r = run("protocol wallet");
  check("agentix protocol wallet", r);

  // ════════════════════════════════════════════════════════
  section("15. FINAL HEALTH CHECK");
  // ════════════════════════════════════════════════════════

  r = run("doctor");
  check("agentix doctor (post-test health)", r);

  // ════════════════════════════════════════════════════════
  section("16. MCP SERVER TEST");
  // ════════════════════════════════════════════════════════

  try {
    const mcpResult = execSync(
      `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/src/mcp/index.js 2>nul`,
      { encoding: "utf-8", timeout: 15000, cwd: __dirname, env: process.env }
    );
    const parsed = JSON.parse(mcpResult);
    const toolCount = parsed.result?.tools?.length || 0;
    if (toolCount === 30) {
      passed++;
      total++;
      ok(`MCP server tools/list (${toolCount} tools)`);
    } else {
      failed++;
      total++;
      fail(`MCP server tools/list (expected 30, got ${toolCount})`);
    }
  } catch (e) {
    failed++;
    total++;
    fail(`MCP server: ${e.message?.slice(0, 100)}`);
  }

  // ════════════════════════════════════════════════════════
  // RESULTS
  // ════════════════════════════════════════════════════════
  console.log(`\n${C.bold}══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  RESULTS: ${C.green}${passed} passed${C.reset} / ${failed > 0 ? C.red : C.green}${failed} failed${C.reset} / ${C.cyan}${total} total${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
