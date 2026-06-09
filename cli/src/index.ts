import { program } from "commander"
import { createClient } from "./client"
import { loadConfig, saveConfig, storeAgentSecret, getAgentSecret } from "./config"
import { AgentClient } from "@agentix/sdk"
import axios from "axios"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { randomBytes } from "crypto"
import { execSync } from "child_process"

const pkg = require("../package.json")

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
}

function log(msg = "", color = C.reset) { console.log(`${color}${msg}${C.reset}`) }
function ok(msg) { log(`  ${C.green}✓${C.reset} ${msg}`, C.reset) }
function err(msg) { log(`  ${C.red}✗${C.reset} ${msg}`, C.red) }
function info(msg) { log(`  ${C.blue}ℹ${C.reset} ${msg}`) }
function warn(msg) { log(`  ${C.yellow}⚠${C.reset} ${msg}`, C.yellow) }
function label(k, v) { log(`  ${C.bold}${k}${C.reset}:  ${v}`) }

async function getClientAndAgent(agentId: string): Promise<AgentClient> {
  const id = parseInt(agentId, 10)
  if (isNaN(id)) { throw new Error(`Invalid agent ID: ${agentId}`) }
  const client = await createClient(id)
  return client
}

program
  .name("atx")
  .description("Agentix CLI — provision, prove, and manage agent credentials")
  .version(pkg.version)

// ── atx init ──────────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialize ~/.agentix/config.json with backend URL and chain config")
  .action(async () => {
    log("\n  atx init — Agentix CLI Configuration", C.cyan)
    log("  ─────────────────────────────────────────\n")

    const config = loadConfig()
    const backendUrl = await prompt("Backend API URL", config.backendUrl || "http://127.0.0.1:3001")
    const rpcUrl = await prompt("RPC URL (Base Sepolia)", config.rpcUrl || "https://base-sepolia.g.alchemy.com/v2/")
    const chainId = parseInt(await prompt("Chain ID", String(config.chainId || "84532")), 10)
    const credentialRegistry = await prompt("Credential Registry address", config.credentialRegistry || "")
    const sessionManager = await prompt("Session Manager address", config.sessionManager || "")

    saveConfig({ backendUrl, rpcUrl, chainId, credentialRegistry, sessionManager, agents: config.agents })
    ok("Configuration saved to ~/.agentix/config.json\n")
  })

// ── atx config ─────────────────────────────────────────────────────────
program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    const config = loadConfig()
    log("\n  Agentix Configuration", C.bold)
    log("  ──────────────────────\n")
    label("Backend URL", config.backendUrl || "(not set)")
    label("RPC URL", config.rpcUrl || "(not set)")
    label("Chain ID", String(config.chainId ?? "(not set)"))
    label("Credential Registry", config.credentialRegistry || "(not set)")
    label("Session Manager", config.sessionManager || "(not set)")
    if (config.agents) {
      log()
      log("  Registered Agents:", C.bold)
      for (const [id, a] of Object.entries(config.agents)) {
        log(`    ${C.green}#${id}${C.reset}  org=${a.orgId}  secret=${a.secret ? C.dim + "stored" + C.reset : C.red + "missing" + C.reset}`)
      }
    }
    log()
    info(`Config file: ${C.dim}${join(homedir(), ".agentix", "config.json")}${C.reset}\n`)
  })

// ── atx agent provision ───────────────────────────────────────────────
program
  .command("provision")
  .description("Register a new agent with the platform")
  .option("-o, --org <id>", "Existing org ID (creates new org if omitted)")
  .option("-n, --name <name>", "Agent name", "cli-agent")
  .option("-p, --permissions <value>", "Permissions bitmask", "1")
  .option("-e, --expiry <seconds>", "Credential expiry from now (seconds)", "86400")
  .action(async (opts) => {
    try {
      log("\n  Provisioning agent...\n", C.cyan)
      const client = await createClient()
      const resp = await client.registerAgent({
        orgId: opts.org ? parseInt(opts.org, 10) : undefined,
        orgName: "CLI Org",
        agentName: opts.name,
        permissions: parseInt(opts.permissions, 10),
        expiry: Math.floor(Date.now() / 1000) + parseInt(opts.expiry, 10),
      })
      storeAgentSecret(resp.agentId, client.secret, resp.orgId)
      ok(`Agent #${resp.agentId} provisioned [org ${resp.orgId}]`)
      log()
      label("Org ID", resp.orgId)
      label("Agent ID", resp.agentId)
      label("Commitment", client.computeCommitment({
        agentId: resp.agentId, orgId: resp.orgId,
        permissions: parseInt(opts.permissions, 10),
        expiry: Math.floor(Date.now() / 1000) + parseInt(opts.expiry, 10),
      }).toString().slice(0, 20) + "...")
      label("Next steps",
        `atx session create ${resp.agentId}    (local prove)\n` +
        `                          ${C.dim}or${C.reset}\n` +
        `atx session create ${resp.agentId} --remote`)
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx agent state ───────────────────────────────────────────────────
program
  .command("state <agentId>")
  .description("Get agent on-chain state")
  .action(async (agentId) => {
    try {
      const client = await createClient()
      const state = await client.getAgentState(parseInt(agentId, 10))
      log()
      log("  Agent State", C.bold)
      log("  ───────────\n")
      for (const [k, v] of Object.entries(state)) {
        if (v && typeof v === "object") {
          log(`  ${C.bold}${k}${C.reset}:`)
          for (const [k2, v2] of Object.entries(v)) {
            log(`    ${k2}: ${String(v2).slice(0, 80)}`)
          }
        } else {
          label(k, String(v).slice(0, 80))
        }
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx agent revoke ──────────────────────────────────────────────────
program
  .command("revoke <agentId>")
  .description("Revoke an agent's credential")
  .action(async (agentId) => {
    try {
      const client = await getClientAndAgent(agentId)
      await client.revokeAgent(parseInt(agentId, 10))
      ok(`Agent #${agentId} revoked`)
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx session create ────────────────────────────────────────────────
program
  .command("session")
  .description("Create an on-chain session for an agent")
  .argument("<agentId>", "Agent ID")
  .option("-r, --remote", "Use remote proving (sends secret to backend)")
  .option("-k, --session-key <address>", "Existing session key address")
  .option("-a, --action <action>", "Action string for remote proving", "create_session")
  .action(async (agentId, opts) => {
    try {
      const id = parseInt(agentId, 10)
      const client = await getClientAndAgent(agentId)
      log(`\n  Creating session for agent #${id}...\n`, C.cyan)

      if (opts.remote) {
        const result = await client.createSessionRemote({
          agentId: id,
          action: opts.action,
          sessionKey: opts.sessionKey,
        })
        ok(`Session created via remote proving`)
        log()
        label("Session Key", result.sessionKey)
        if (result.sessionPrivateKey) {
          warn("Session private key will be shown only once")
          label("Session PK", result.sessionPrivateKey)
        }
        if (result.session?.txHash) label("Tx Hash", result.session.txHash)
      } else {
        const result = await client.createSession({
          agentId: id,
          sessionKey: opts.sessionKey,
        })
        ok(`Session created via local proving`)
        log()
        label("Session Key", result.sessionKey)
        if (result.sessionPrivateKey) {
          warn("Session private key will be shown only once")
          label("Session PK", result.sessionPrivateKey)
        }
        if (result.session?.txHash) label("Tx Hash", result.session.txHash)
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx proof generate ────────────────────────────────────────────────
program
  .command("proof")
  .description("Generate or verify ZK proofs")
  .argument("[agentId]", "Agent ID for proof generation")
  .option("-o, --org <id>", "Org ID")
  .option("-a, --action <action>", "Action string", "cli_action")
  .option("-e, --expiry <seconds>", "Proof expiry", "3600")
  .option("-f, --file <path>", "Proof JSON file path (for verify)")
  .option("--verify", "Verify a proof file instead of generating")
  .action(async (agentId, opts) => {
    try {
      if (opts.verify) {
        if (!opts.file) { err("--file <path> required for verify"); return }
        if (!existsSync(opts.file)) { err(`File not found: ${opts.file}`); return }
        const proofData = JSON.parse(readFileSync(opts.file, "utf-8"))
        const client = await createClient()
        log("\n  Verifying proof...\n", C.cyan)
        const valid = await client.verifyProof(proofData)
        if (valid) {
          ok("Proof is VALID ✓")
        } else {
          err("Proof is INVALID ✗")
        }
        log()
        return
      }

      if (!agentId) { err("agentId is required for proof generation"); return }
      const id = parseInt(agentId, 10)
      const orgId = opts.org ? parseInt(opts.org, 10) : undefined
      const client = await getClientAndAgent(agentId)
      const state = orgId === undefined ? await client.getAgentState(id) : null
      const resolvedOrg = orgId ?? state?.agent?.org_id
      if (!resolvedOrg) { err("Could not determine orgId"); return }

      log(`\n  Generating proof for agent #${id}...\n`, C.cyan)
      const proof = await client.generateProofRemote(id, resolvedOrg, opts.action, parseInt(opts.expiry, 10))
      ok("Proof generated")
      log()
      label("Nullifier", proof.proof.nullifier.slice(0, 20) + "...")
      label("Root", proof.proof.root.slice(0, 20) + "...")
      label("Permission Bitmask", proof.permissionBitmask)
      label("Expires At", new Date(proof.expiresAt * 1000).toISOString())

      if (opts.file) {
        writeFileSync(opts.file, JSON.stringify(proof, null, 2))
        ok(`Proof saved to ${opts.file}`)
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx wallet create ─────────────────────────────────────────────────
program
  .command("wallet")
  .description("Create a smart wallet for an agent")
  .argument("[agentId]", "Agent ID (optional)")
  .option("-o, --owner <address>", "Owner address (generates new wallet if omitted)")
  .action(async (agentId, opts) => {
    try {
      const client = await createClient()
      log("\n  Creating wallet...\n", C.cyan)
      const result = await client.createWallet({
        ownerAddress: opts.owner || undefined,
        agentId: agentId ? parseInt(agentId, 10) : undefined,
      })
      ok("Wallet created")
      log()
      label("Wallet Address", result.walletAddress)
      label("Owner Address", result.ownerAddress)
      label("Session Manager", result.sessionManagerAddress)
      if (result.txHash) label("Tx Hash", result.txHash)
      if (result.ownerPrivateKey) {
        warn("Private key will be shown only once")
        label("Owner Private Key", result.ownerPrivateKey)
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx circuit ────────────────────────────────────────────────────────
program
  .command("circuit")
  .description("Check circuit status or download verification key")
  .argument("[command]", "status (default) or vk")
  .option("-o, --output <path>", "Output file for verification key", "verification_key.json")
  .action(async (cmd, opts) => {
    try {
      const client = await createClient()

      if (cmd === "vk") {
        log("\n  Fetching verification key...\n", C.cyan)
        const res = await axios.get(`${client.api}/circuit/verification-key`, { responseType: "text" })
        writeFileSync(opts.output, res.data)
        ok(`Verification key saved to ${opts.output}`)
        log()
        return
      }

      const config = await client.fetchCircuitConfig()
      log()
      log("  Circuit Status", C.bold)
      log("  ──────────────\n")
      label("Available", config.available ? C.green + "yes" + C.reset : C.red + "no" + C.reset)
      label("WASM", config.hasWasm ? C.green + "ready" : C.red + "missing")
      label("ZKey", config.hasZkey ? C.green + "ready" : C.red + "missing")
      label("VK", config.verificationKey ? C.green + "loaded (" + config.verificationKey?.protocol + ")" : C.red + "missing")
      label("Backend Proving", config.backendProvingAvailable ? C.green + "available (rapidsnark)" : C.yellow + "unavailable (snarkjs fallback)")
      label("VK URL", config.verificationKeyUrl)
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx audit ─────────────────────────────────────────────────────────
program
  .command("audit")
  .description("Query audit logs and stats")
  .argument("[orgId]", "Organization ID")
  .option("-s, --stats", "Show audit statistics instead of logs")
  .option("-a, --action <action>", "Filter by action")
  .option("-u, --user <id>", "Filter by user ID")
  .option("-t, --type <type>", "Filter by resource type")
  .option("-n, --limit <n>", "Max results", "20")
  .option("--search <query>", "Search text")
  .action(async (orgId, opts) => {
    try {
      const client = await createClient()

      if (opts.stats) {
        const stats = await client.getAuditStats(orgId ? parseInt(orgId, 10) : undefined)
        log("\n  Audit Statistics", C.bold)
        log("  ────────────────\n")
        label("Total Events", stats.totalEvents)
        label("Recent 24h", stats.recentActivity)
        log()
        log("  By Action:", C.bold)
        for (const [action, count] of Object.entries(stats.eventsByAction || {})) {
          log(`    ${action.padEnd(30)} ${C.green}${count}${C.reset}`)
        }
        log()
        log("  By User:", C.bold)
        for (const u of stats.eventsByUser || []) {
          log(`    user #${String(u.user_id).padEnd(8)} ${C.green}${u.count} events${C.reset}`)
        }
        log()
        return
      }

      const params: any = { limit: parseInt(opts.limit, 10) }
      if (orgId) params.orgId = parseInt(orgId, 10)
      if (opts.action) params.action = opts.action
      if (opts.user) params.userId = parseInt(opts.user, 10)
      if (opts.type) params.resourceType = opts.type
      if (opts.search) params.search = opts.search

      const result = await client.queryAuditLogs(params)
      const items = result.items || result || []
      log()
      log("  Audit Log", C.bold)
      log("  ─────────\n")
      for (const item of (Array.isArray(items) ? items : []).slice(0, parseInt(opts.limit, 10))) {
        const ts = new Date((item.created_at || item.timestamp) * 1000).toISOString().slice(0, 19)
        const action = item.action?.padEnd(25)
        const rid = (item.resource_id || "").slice(0, 20).padEnd(20)
        log(`  ${C.dim}${ts}${C.reset}  ${C.green}${action}${C.reset}  ${rid}  ${C.dim}org=${item.org_id ?? "?"} user=${item.user_id ?? "?"}${C.reset}`)
      }
      log()
      info(`Showing up to ${opts.limit} entries. Use --limit <n> to change.`)
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx env ────────────────────────────────────────────────────────────
program
  .command("env")
  .description("Interactive .env configuration wizard")
  .action(async () => {
    log("\n  atx env — Environment Setup", C.cyan)
    log("  ─────────────────────────────\n")

    const config = loadConfig()

    const rpcUrl = await prompt("Alchemy/Infura Base Sepolia RPC URL", config.rpcUrl || "https://base-sepolia.g.alchemy.com/v2/")
    const privateKey = await prompt("Backend wallet private key (0x...)")
    const bundlerUrl = await prompt("Bundler URL (same as RPC if using Alchemy)", rpcUrl)
    const chainId = await prompt("Chain ID", String(config.chainId || "84532"))
    const backendPort = await prompt("Backend port", "3001")

    log()
    info("Writing backend/.env...")
    const backendEnv =
`# ── Blockchain ──
RPC_URL=${rpcUrl}
PRIVATE_KEY=${privateKey}
BUNDLER_URL=${bundlerUrl}
CHAIN_ID=${chainId}
NETWORK_NAME=sepolia

# ── Contract Addresses ──
${config.credentialRegistry ? `CREDENTIAL_REGISTRY=${config.credentialRegistry}` : "# CREDENTIAL_REGISTRY=<deploy first>"}
${config.sessionManager ? `SESSION_MANAGER=${config.sessionManager}` : "# SESSION_MANAGER=<deploy first>"}

# ── Server ──
PORT=${backendPort}
`
    const backendDir = join(__dirname, "../../backend")
    if (existsSync(backendDir)) {
      writeFileSync(join(backendDir, ".env"), backendEnv)
      ok("backend/.env written")
    } else {
      warn(`backend dir not found at ${backendDir}`)
    }

    const mcpTestDir = join(__dirname, "../../mcp-test")
    if (existsSync(mcpTestDir)) {
      writeFileSync(join(mcpTestDir, ".env"),
`RPC_URL=${rpcUrl}
PRIVATE_KEY=${privateKey}
CHAIN_ID=${chainId}
PORT=3100
`)
      ok("mcp-test/.env written")
    }

    const keyName = `PRIVATE_KEY_${chainId}`
    const mcpTestConfig = join(mcpTestDir, "config.json")
    if (existsSync(mcpTestConfig)) {
      const cfg = JSON.parse(readFileSync(mcpTestConfig, "utf-8"))
      cfg[keyName] = privateKey
      cfg.rpcUrl = rpcUrl
      writeFileSync(mcpTestConfig, JSON.stringify(cfg, null, 2))
      ok("mcp-test/config.json updated")
    }

    saveConfig({ ...config, backendUrl: `http://127.0.0.1:${backendPort}`, rpcUrl, chainId: parseInt(chainId, 10) })
    ok("CLI config updated\n")
  })

// ── atx query ─────────────────────────────────────────────────────────
program
  .command("query")
  .description("Query on-chain events")
  .option("-c, --contract <name>", "Contract name", "credential")
  .option("-i, --session-id <id>", "Filter by session ID")
  .option("-w, --wallet <address>", "Filter by wallet address")
  .option("-n, --limit <n>", "Max results", "10")
  .action(async (opts) => {
    try {
      const client = await createClient()
      const events = await client.getEvents({
        contractName: opts.contract,
        sessionId: opts.sessionId,
        walletAddress: opts.wallet,
        limit: parseInt(opts.limit, 10),
      })
      log()
      log("  On-Chain Events", C.bold)
      log("  ───────────────\n")
      const items = events.items || events || []
      for (const ev of (Array.isArray(items) ? items : [])) {
        log(`  ${C.dim}${ev.blockNumber || "?"}${C.reset}  ${C.cyan}${ev.event || ev.name || "?"}${C.reset}`)
        for (const [k, v] of Object.entries(ev.args || ev || {})) {
          if (k === "blockNumber" || k === "event") continue
          log(`    ${k}: ${String(v).slice(0, 70)}`)
        }
        log()
      }
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx wellknown ──────────────────────────────────────────────────────
program
  .command("wellknown")
  .description("Fetch the .well-known/agentix discovery document")
  .action(async () => {
    try {
      const client = await createClient()
      const config = await client.fetchWellKnown()
      log()
      log("  Agentix Protocol Discovery", C.bold)
      log("  ──────────────────────────\n")
      label("Issuer", config.issuer)
      label("Version", config.version)
      label("Network", `${config.meta.network} (chain ${config.meta.chain_id})`)
      label("Verification Endpoint", config.endpoints.verification)
      label("Docs", config.docs_url)
      log()
      log("  Supported Scopes:", C.bold)
      for (const s of config.scopes) {
        log(`    ${C.cyan}${s.name}${C.reset}`)
        log(`      ${C.dim}${s.description}${C.reset}`)
        log(`      ${C.dim}reveals: [${s.reveals.join(", ")}] (${s.category})${C.reset}`)
      }
      log()
      log("  Circuits:", C.bold)
      for (const c of config.circuits) {
        log(`    ${C.green}${c.id}${C.reset} — ${c.n_public} public signals`)
        for (const sig of c.public_signals) {
          log(`      [${sig.index}] ${C.dim}${sig.name}${C.reset}: ${sig.description}`)
        }
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx verify ─────────────────────────────────────────────────────────
program
  .command("verify")
  .description("Verify a proof via the standard verification endpoint")
  .requiredOption("-f, --file <path>", "Proof JSON file")
  .option("-s, --scope <scopes...>", "Requested scopes to resolve")
  .action(async (opts) => {
    try {
      if (!existsSync(opts.file)) { err(`File not found: ${opts.file}`); return }
      const proofData = JSON.parse(readFileSync(opts.file, "utf-8"))
      const client = await createClient()
      log("\n  Verifying proof via standard endpoint...\n", C.cyan)
      const result = await client.verifyAtEndpoint({
        proof: proofData.proof || proofData,
        publicSignals: proofData.publicSignals || [],
        requestedScopes: opts.scope,
      })
      if (result.valid) {
        ok("Proof is VALID ✓")
        log()
        label("Nullifier", result.proof?.nullifier?.slice(0, 20) + "...")
        label("Permissions", result.proof?.permissions)
        label("Session Expiry", result.proof?.sessionExpiry ? new Date(result.proof.sessionExpiry * 1000).toISOString() : "?")
        if (result.requestedScopes?.length) {
          log()
          log("  Resolved Scopes:", C.bold)
          for (const s of result.requestedScopes) {
            log(`    ${C.green}✓${C.reset} ${s}`)
          }
        }
        if (result.missingScopes?.length) {
          log()
          log("  Missing Scopes:", C.bold)
          for (const s of result.missingScopes) {
            log(`    ${C.red}✗${C.reset} ${s}`)
          }
        }
      } else {
        err(`Proof is INVALID: ${result.error || "unknown reason"}`)
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx verify-demo ────────────────────────────────────────────────────
program
  .command("verify-demo")
  .description("Simulate a relying party verifying an agent proof end-to-end")
  .action(async () => {
    try {
      log()
      log("  ╔══════════════════════════════════════════════════════╗", C.cyan)
      log("  ║  Agentix Protocol Demo — Relying Party Verification  ║", C.cyan)
      log("  ╚══════════════════════════════════════════════════════╝", C.cyan)
      log()

      const client = await createClient()

      // Step 1: Fetch the well-known config
      info("Step 1: Discovering protocol config via .well-known/agentix")
      const wkc = await client.fetchWellKnown()
      ok(`Discovered issuer: ${wkc.issuer} on ${wkc.meta.network} (chain ${wkc.meta.chain_id})`)
      ok(`${wkc.scopes.length} supported scopes, ${wkc.circuits.length} circuit(s)`)
      log()

      // Step 2: Check circuit availability
      info("Step 2: Checking circuit availability")
      const circuit = await client.fetchCircuitConfig()
      if (!circuit.available) {
        warn("Circuit not available — some features may not work")
      } else {
        ok(`Circuit ready: WASM=${circuit.hasWasm}, ZKey=${circuit.hasZkey}, VK=${!!circuit.verificationKey}`)
      }
      log()

      // Step 3: Inspect verification endpoint
      info(`Step 3: Verification endpoint at ${wkc.endpoints.verification}`)
      ok(`POST ${wkc.endpoints.verification} accepts Groth16 proofs on bn128`)
      log()

      // Step 4: Check if any agents are registered and test a verification flow
      const config = loadConfig()
      const agentIds = config.agents ? Object.keys(config.agents) : []
      if (agentIds.length > 0) {
        info(`Step 4: ${agentIds.length} locally-known agent(s) — can generate+verify proof`)
        for (const id of agentIds.slice(0, 3)) {
          log(`  Agent #${id}: secret=${getAgentSecret(parseInt(id, 10)) ? "stored" : "missing"}`)
        }
        log()
        info("Run 'atx proof <agentId>' to generate a proof, then 'atx verify -f <file>' to verify it")
      } else {
        info("Step 4: No locally-known agents. Run 'atx provision' first, then verify-demo again")
      }
      log()

      log("  ─────────────────────────────────────────────", C.dim)
      info("Standard verification endpoint ready")
      ok(`POST ${client.api}/verify accepts { proof, publicSignals, requestedScopes }`)
      ok("Any app can verify agent proofs with zero blockchain knowledge")
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx auth ──────────────────────────────────────────────────────────
program
  .command("auth")
  .description("Challenge-response auth flow: challenge, exchange, header")
  .argument("<agentId>", "Agent ID")
  .option("-s, --scope <scopes...>", "Requested scopes")
  .option("-H, --header", "Generate Authorization header value instead of full flow")
  .option("--remote", "Use remote proving for proof generation")
  .action(async (agentId, opts) => {
    try {
      const id = parseInt(agentId, 10)
      const secret = getAgentSecret(id)
      if (!secret) { err(`No secret stored for agent #${id}. Run 'atx provision' first.`); return }

      const config = loadConfig()
      const api = config.backendUrl || "http://127.0.0.1:3001"

      const { AuthFlowClient } = require("@agentix/sdk")
      const flow = new AuthFlowClient(api)

      if (opts.header) {
        log("\n  Generating Agentix Authorization header...\n", C.cyan)
        const header = await flow.generateAuthHeader(id, secret, async () => {
          const client = await createClient(id)
          if (opts.remote) {
            const r = await client.generateProofRemote(id, 1, "auth_challenge")
            return { proof: r.proof.proof, publicSignals: r.proof.publicSignals }
          }
          const state = await client.getAgentState(id)
          const manager = client.sessionManager()
          const pb = await manager.fetchMerkleProof(id)
          const zk = await manager.generateProof(
            id, Number(state?.agent?.org_id || 1),
            Number(state?.credential?.permissions || 1),
            Number(state?.credential?.expiry || 9999999999),
            Date.now(), pb
          )
          return zk
        }, { scopes: opts.scope })
        log()
        label("Authorization Header", header.slice(0, 60) + "...")
        log()
        label("Usage", `curl -H "Authorization: ${header.slice(0, 40)}..." https://your-api.com/endpoint`)
        log()
        return
      }

      log(`\n  Auth flow for agent #${id}...\n`, C.cyan)

      info("Requesting challenge...")
      const challenge = await flow.requestChallenge(id, { requestedScopes: opts.scope })
      ok(`Challenge issued: ${challenge.challengeId.slice(0, 16)}...`)
      label("Expires", new Date(challenge.expiresAt).toISOString())

      log()
      info("Signing challenge with agent secret...")
      const signature = await flow.signChallenge(secret, challenge.challenge)
      ok(`Signature: ${signature.slice(0, 16)}...`)

      log()
      info("Generating proof...")
      const client = await createClient(id)
      let zk: any
      if (opts.remote) {
        const r = await client.generateProofRemote(id, 1, "auth_challenge")
        zk = { proof: r.proof.proof, publicSignals: r.proof.publicSignals }
      } else {
        const state = await client.getAgentState(id)
        const manager = client.sessionManager()
        const pb = await manager.fetchMerkleProof(id)
        zk = await manager.generateProof(
          id, Number(state?.agent?.org_id || 1),
          Number(state?.credential?.permissions || 1),
          Number(state?.credential?.expiry || 9999999999),
          Date.now(), pb
        )
      }
      ok("Proof generated")

      log()
      info("Exchanging proof for verification...")
      const result = await flow.exchange({
        challengeId: challenge.challengeId,
        proof: zk.proof,
        publicSignals: zk.publicSignals,
        signature,
        agentId: id,
        requestedScopes: opts.scope,
      })

      if (result.valid) {
        ok("Authentication successful!")
        log()
        label("Agent ID", result.agentId)
        label("Org ID", result.orgId ?? "?")
        label("Permissions", result.publicSignals.permissions)
        label("Session Expiry", new Date(parseInt(result.publicSignals.sessionExpiry) * 1000).toISOString())
        if (result.scopes?.length) {
          log()
          log("  Resolved Scopes:", C.bold)
          for (const s of result.scopes) log(`    ${C.green}✓${C.reset} ${s}`)
        }
      } else {
        err(`Authentication failed: ${result.error}`)
      }
      log()
    } catch (e: any) {
      err(e.message || String(e))
    }
  })

// ── atx serve ─────────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start a demo relying party server with Agentix auth middleware")
  .option("-p, --port <port>", "Port to listen on", "3456")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10)

    log(`\n  Starting Agentix Demo Relying Party on :${port}...\n`, C.cyan)
    info(`This simulates an API server that verifies agent proofs via Agentix middleware.`)

    const express = require("express")
    const app = express()
    app.use(express.json())

    const { RelyingPartyClient } = require("@agentix/sdk")
    const config = loadConfig()
    const rp = new RelyingPartyClient(config.backendUrl || "http://127.0.0.1:3001")

    await rp.discover()
    ok(`Discovered issuer via .well-known/agentix`)

    // Public endpoint — no auth
    app.get("/", (_req, res) => {
      res.json({
        service: "Agentix Demo API",
        version: "0.1.0",
        endpoints: {
          "GET /": "this help",
          "GET /status": "public health check",
          "GET /protected": "requires Agentix Authorization header",
          "POST /protected": "requires Agentix Authorization header",
        },
      })
    })

    app.get("/status", (_req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() })
    })

    // Protected endpoint — requires Agentix auth
    const agentixGuard = rp.middleware({
      requiredScopes: ["agentix:scope:permissions"],
    })

    app.get("/protected", agentixGuard, (req, res) => {
      res.json({
        message: "You are authenticated!",
        agent: req.agent,
      })
    })

    app.post("/protected", agentixGuard, (req, res) => {
      res.json({
        message: "Authenticated POST received",
        agent: req.agent,
        body: req.body,
      })
    })

    // Endpoint that echoes auth info
    app.get("/whoami", agentixGuard, (req, res) => {
      res.json({
        agentId: req.agent.agentId,
        scopes: req.agent.scopes,
        authenticated: true,
        timestamp: new Date().toISOString(),
      })
    })

    app.listen(port, () => {
      ok(`Demo server running at http://127.0.0.1:${port}`)
      log()
      log("  Try these commands:", C.bold)
      log(`    ${C.cyan}curl http://127.0.0.1:${port}/status${C.reset}`)
      log(`    ${C.cyan}curl http://127.0.0.1:${port}/protected${C.reset}  # returns 401`)
      log(`    ${C.cyan}atx auth 1 --header${C.reset}  # generate auth header`)
      log(`    ${C.cyan}curl -H \"Authorization: Agentix <header>\" http://127.0.0.1:${port}/protected${C.reset}`)
      log()
    })
  })

// ── Parse ─────────────────────────────────────────────────────────────
async function prompt(label: string, defaultVal = ""): Promise<string> {
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout })
  const hint = defaultVal ? ` [${C.dim}${defaultVal}${C.reset}]` : ""
  const q = `${C.cyan}?${C.reset} ${label}${hint}: `
  return new Promise(resolve => {
    rl.question(q, (ans: string) => {
      rl.close()
      resolve(ans.trim() || defaultVal)
    })
  })
}

program.parse(process.argv)

if (!process.argv.slice(2).length) {
  program.outputHelp()
}
