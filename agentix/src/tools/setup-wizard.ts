/**
 * AgentIX interactive setup wizard.
 *
 * A modern, dependency-free terminal experience that gets a user from
 * `npx agentix setup` to a fully working runtime — dependencies verified,
 * data dirs + DB created, RPC configured (public fallback by default, optional
 * provider key), and every detected AI harness auto-wired to the AgentIX MCP
 * server so tools work immediately.
 *
 * Design goals:
 *   - Never hard-fail on a missing optional piece; degrade and report.
 *   - Never require a key: public RPC endpoints are the default.
 *   - Idempotent: safe to re-run; re-connects harnesses and re-verifies RPC.
 */
import {
  banner, box, c, paint, sym, Spinner, progressBar, gradient,
  prompt, confirm, select, isTTY,
} from "../core/tui";
import {
  RPC_PROVIDERS, PUBLIC_RPC_ENDPOINTS, DEFAULT_PUBLIC_RPC, PUBLIC_RPC_URLS,
  buildRpcUrl, probeRpc, resolveWorkingRpc, isValidHttpsUrl,
} from "../core/rpc-providers";
import { ensureDirectories, saveConfig, loadConfig, AGENTIX_HOME } from "../core/config";

const CHAIN_ID = 84532;

export interface WizardOptions {
  /** Skip all prompts and use public RPC (for CI / non-interactive installs). */
  yes?: boolean;
  /** Pre-supplied RPC url (skips the RPC prompt). */
  rpc?: string;
}

interface StepResult {
  ok: boolean;
  detail: string;
}

const TOTAL_STEPS = 5;

/**
 * Print a wizard step header (numbered title + progress bar) to the terminal.
 * Cosmetic only — the step number is display text, not flow control, so calling
 * it out of order only mislabels the output.
 * @param n - Step number (1..TOTAL_STEPS); @param title - Step title.
 * @returns Nothing (void).
 * Maps to: internal — runSetupWizard step functions.
 * Side effects: terminal output.
 */
function stepHeader(n: number, title: string): void {
  const label = paint(`Step ${n}/${TOTAL_STEPS}`, c.cyan + c.bold);
  console.log(`\n  ${label}  ${paint(title, c.white + c.bold)}`);
  console.log(`  ${paint(progressBar(n - 1, TOTAL_STEPS), c.dim)}`);
}

// ── Step 1: environment / dependencies ────────────────────────────────
/**
 * Wizard step 1: verify Node.js >= 18 and that better-sqlite3 loads.
 * A missing native SQLite module is a soft failure (ok:true with a warning
 * detail) — the wizard continues and the DB step will fail loudly instead.
 * @returns StepResult {ok, detail}; ok:false only when Node < 18.
 * @throws Never throws: require failures are caught into the result.
 * Maps to: internal — runSetupWizard.
 * Side effects: terminal output (spinners); ~350ms of artificial sleep for readability.
 */
async function checkEnvironment(): Promise<StepResult> {
  stepHeader(1, "Verifying environment");
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  const nodeOk = nodeMajor >= 18;

  const spin = new Spinner("Checking Node.js runtime...").start();
  await sleep(200);
  if (nodeOk) {
    spin.succeed(`Node.js ${process.versions.node} ${paint("(>= 18 required)", c.dim)}`);
  } else {
    spin.fail(`Node.js ${process.versions.node} — AgentIX needs Node 18 or newer`);
    return { ok: false, detail: `Node ${process.versions.node} < 18` };
  }

  // better-sqlite3 is the one native dep; verify it loads (prebuilt binary present).
  const spin2 = new Spinner("Checking native SQLite module...").start();
  await sleep(150);
  try {
    require("better-sqlite3");
    spin2.succeed(`better-sqlite3 ${paint("native module OK", c.dim)}`);
  } catch (e: any) {
    spin2.warn(`better-sqlite3 not ready — run ${paint("npm install", c.cyan)} (${e.code || "load failed"})`);
    return { ok: true, detail: "sqlite native module missing (npm install)" };
  }

  return { ok: true, detail: `Node ${process.versions.node}` };
}

// ── Step 2: data directories + database ───────────────────────────────
/**
 * Wizard step 2: create ~/.agentix directories and initialize the SQLite DB.
 * The first step that writes anything durable — a failure here aborts the
 * wizard (runSetupWizard returns false).
 * @returns StepResult {ok, detail}; ok:false when directories cannot be created or the DB fails to initialize.
 * @throws Never throws: failures are caught into the result.
 * Maps to: internal — runSetupWizard.
 * Side effects: creates data dirs + DB file; terminal output.
 */
async function initStorage(): Promise<StepResult> {
  stepHeader(2, "Initializing local storage");
  const spin = new Spinner(`Creating data directory at ${AGENTIX_HOME}...`).start();
  await sleep(150);
  try {
    ensureDirectories();
    spin.succeed(`Data directory ready ${paint(AGENTIX_HOME, c.dim)}`);
  } catch (e: any) {
    spin.fail(`Could not create ${AGENTIX_HOME}: ${e.message}`);
    return { ok: false, detail: e.message };
  }

  const spin2 = new Spinner("Initializing SQLite database...").start();
  try {
    const { getDatabase } = await import("../core/database");
    getDatabase();
    spin2.succeed(`Database initialized ${paint("~/.agentix/db/agentix.db", c.dim)}`);
    return { ok: true, detail: "db ready" };
  } catch (e: any) {
    spin2.fail(`Database init failed: ${e.message}`);
    return { ok: false, detail: e.message };
  }
}

// ── Step 3: RPC configuration ─────────────────────────────────────────
/**
 * Wizard step 3: pick an RPC endpoint for Base Sepolia (chain 84532) and persist it with public fallbacks.
 * Public endpoints are the default — no key is ever required; a provider key is
 * only asked for when the user picks a provider, and the chosen endpoint is
 * verified (resolveWorkingRpc falls back through the public list) before saving.
 * @param opts.rpc - Pre-supplied URL (skips the prompt); @param opts.yes - Non-interactive mode, public endpoints with no prompt.
 * @returns StepResult {ok:true always, detail: "<source> -> <resolved source>"}; an unverifiable endpoint only warns and saves the public default.
 * @throws Throws if the interactive prompt fails; save failures propagate.
 * Maps to: CLI 'agentix setup' (step 3) / config rpcUrl + rpcFallbackUrls.
 * Side effects: writes config (primary + fallback list); network probes; terminal prompts/output.
 * Security: a pasted provider key is embedded in the saved RPC URL — the config file then holds a secret; maskUrl hides it when echoing.
 */
async function configureRpc(opts: WizardOptions): Promise<StepResult> {
  stepHeader(3, "Configuring RPC endpoint");

  console.log(box(
    `${paint("AgentIX always works out of the box.", c.white)}\n` +
    `${paint("Public RPC endpoints are used by default — no key needed.", c.gray)}\n` +
    `${paint("Optionally plug in a provider key for higher rate limits.", c.gray)}`,
    { title: "Network", color: c.violet },
  ));

  let chosenUrl: string | null = null;
  let sourceLabel = "";

  if (opts.rpc) {
    chosenUrl = opts.rpc;
    sourceLabel = "provided via --rpc";
  } else if (opts.yes || !isTTY) {
    chosenUrl = null; // public fallback
    sourceLabel = "public (non-interactive)";
  } else {
    const choices = [
      { label: paint("Use public endpoints", c.green) + " (recommended, no key)", hint: "" },
      ...RPC_PROVIDERS.map((p) => ({
        label: `${p.name}`,
        hint: p.freeTier ? "free tier • key optional" : "key required",
      })),
    ];
    const idx = await select("How should AgentIX connect to Base Sepolia?", choices);

    if (idx === 0) {
      chosenUrl = null;
      sourceLabel = "public endpoints";
    } else {
      const provider = RPC_PROVIDERS[idx - 1];
      console.log(`\n  ${sym.info} ${paint(provider.name, c.bold)} — ${paint(provider.hint, c.gray)}`);
      console.log(`    ${paint("Get a key:", c.dim)} ${paint(provider.signupUrl, c.cyan)}`);
      console.log(`    ${paint("Docs:", c.dim)} ${paint(provider.docs, c.dim)}`);
      const secret = await prompt(
        provider.kind === "url" ? "Paste your full endpoint URL" : `Paste your ${provider.name} API key`,
      );
      chosenUrl = buildRpcUrl(provider.id, secret);
      if (!chosenUrl) {
        console.log(`  ${sym.warn} ${paint("No valid key/URL entered — falling back to public endpoints.", c.amber)}`);
        sourceLabel = "public (fallback)";
      } else {
        sourceLabel = provider.name;
      }
    }
  }

  // Verify connectivity against the chosen endpoint, falling back through the
  // public list until one returns the expected chain id.
  const spin = new Spinner(`Verifying connection to Base Sepolia (chain ${CHAIN_ID})...`).start();
  const resolved = await resolveWorkingRpc(chosenUrl, CHAIN_ID);
  if (resolved.verified) {
    spin.succeed(`Connected via ${paint(resolved.source, c.bold)} ${paint(`chain ${CHAIN_ID} ✓`, c.dim)}`);
  } else {
    spin.warn(`No endpoint verified right now — saved public default; will retry at runtime`);
  }

  // Persist: primary url + the full public fallback list so runtime can rotate.
  const primary = resolved.url;
  const fallbacks = PUBLIC_RPC_URLS.filter((u) => u !== primary);
  saveConfig({
    rpcUrl: primary,
    rpcFallbackUrl: fallbacks[0] || DEFAULT_PUBLIC_RPC,
    rpcFallbackUrls: [primary, ...fallbacks],
  });

  console.log(`  ${sym.dot} ${paint("Primary:", c.gray)} ${maskUrl(primary)}`);
  console.log(`  ${sym.dot} ${paint(`Fallbacks: ${fallbacks.length} public endpoints`, c.dim)}`);
  return { ok: true, detail: `${sourceLabel} → ${resolved.source}` };
}

/**
 * Hide an embedded API key when echoing an RPC URL back to the user.
 * Only the last path segment is masked (first 4 chars + … + last 2) when it is
 * longer than 8 chars; query-string keys and short segments pass through
 * unchanged, so this is display hygiene, not redaction.
 * @param url - URL to display; an unparsable string is returned as-is (painted, unmasked).
 * @returns The masked URL string (with terminal colour codes).
 * @throws Never throws: URL parse failures return the input painted.
 * Maps to: internal — configureRpc (echo of the chosen endpoint).
 * Side effects: none.
 */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length && parts[parts.length - 1].length > 8) {
      parts[parts.length - 1] = parts[parts.length - 1].slice(0, 4) + "…" + parts[parts.length - 1].slice(-2);
      u.pathname = "/" + parts.join("/");
    }
    return paint(u.toString(), c.cyan);
  } catch {
    return paint(url, c.cyan);
  }
}

// ── Step 4: harness autodetect + MCP wiring ───────────────────────────
/**
 * Wizard step 4: scan for installed AI harnesses and wire the AgentIX MCP server into them.
 * Detection is read-only; wiring is opt-in (prompted, or automatic with --yes /
 * non-TTY) and always rewrites the canonical launch command for every detected
 * harness — not just unconnected ones — to heal stale entries from older versions.
 * @param opts.yes - Non-interactive mode, wires all detected harnesses without prompting.
 * @returns StepResult {ok:true always, detail} — a missing harness module, zero harnesses, or a declined prompt are all ok:true with an explanatory detail.
 * @throws Never throws: per-harness connect failures are counted, not raised.
 * Maps to: CLI 'agentix connect' (same wiring, standalone).
 * Side effects: scans the machine for harnesses; writes MCP entries into external IDE/agent config files when the user agrees.
 */
async function connectHarnesses(opts: WizardOptions): Promise<StepResult> {
  stepHeader(4, "Detecting AI harnesses");
  let manager: any;
  try {
    const mod = await import("../../packages/core/harness-adapter");
    manager = mod.getHarnessManager();
  } catch (e: any) {
    console.log(`  ${sym.warn} ${paint("Harness manager unavailable: " + e.message, c.amber)}`);
    return { ok: true, detail: "harness module unavailable" };
  }

  const spin = new Spinner("Scanning for installed AI coding harnesses...").start();
  const scan = await manager.scanAll();
  const found = scan.harnesses.filter((h: any) => h.detect.found);
  spin.succeed(`Scan complete — ${paint(String(found.length), c.bold)} harness(es) detected`);

  if (found.length === 0) {
    console.log(box(
      `${paint("No AI harnesses detected yet.", c.white)}\n` +
      `${paint("Install one (Claude Code, Cursor, Copilot, ...) then run:", c.gray)}\n` +
      `${paint("agentix connect", c.cyan)}`,
      { title: "Harnesses", color: c.amber },
    ));
    return { ok: true, detail: "0 harnesses" };
  }

  for (const h of found) {
    const status = h.detect.alreadyConnected
      ? paint("already connected", c.green)
      : paint("detected", c.cyan);
    console.log(`  ${sym.bullet} ${paint(h.adapter.name, c.bold)} ${paint("—", c.dim)} ${status}`);
  }

  const doConnect = opts.yes || !isTTY
    ? true
    : await confirm("Wire AgentIX MCP tools into all detected harnesses?", true);

  if (!doConnect) {
    return { ok: true, detail: `${found.length} detected, skipped wiring` };
  }

  // Always (re)write the canonical launch command for every detected harness,
  // not just the ones missing an entry. This heals stale entries from older
  // versions that pointed at a path an upgrade removed — connectAll() alone
  // would skip anything flagged "already connected" and leave it broken.
  const spin2 = new Spinner("Plugging AgentIX MCP server into harnesses...").start();
  let wired = 0;
  let failed = 0;
  for (const h of found) {
    try {
      const res = await h.adapter.connect();
      if (res.success) wired++;
      else failed++;
    } catch {
      failed++;
    }
  }
  spin2.succeed(`MCP wired into ${paint(String(wired), c.bold)}/${found.length} harness(es)`);
  if (failed > 0) {
    console.log(`  ${sym.warn} ${paint(`${failed} harness(es) could not be wired automatically`, c.amber)}`);
  }
  return { ok: true, detail: `${wired}/${found.length} wired` };
}

// ── Step 5: summary ───────────────────────────────────────────────────
/**
 * Wizard step 5: print the completion summary box (runtime path, network, harness + RPC results) and next steps.
 * Pure output — it reads the step results and config but changes nothing, so
 * calling it twice just prints twice.
 * @param results - Map of step name to StepResult; missing keys render as "n/a" / "public".
 * @returns Nothing (void).
 * Maps to: internal — runSetupWizard.
 * Side effects: terminal output.
 */
function finish(results: Record<string, StepResult>): void {
  stepHeader(5, "Setup complete");
  console.log(`  ${paint(progressBar(TOTAL_STEPS, TOTAL_STEPS), c.dim)}\n`);

  const cfg = loadConfig();
  const lines = [
    `${sym.tick} ${paint("Runtime", c.bold)}    ${paint(AGENTIX_HOME, c.gray)}`,
    `${sym.tick} ${paint("Network", c.bold)}    ${paint(`${cfg.networkName} (chain ${cfg.chainId})`, c.gray)}`,
    `${sym.tick} ${paint("Harnesses", c.bold)}  ${paint(results.harnesses?.detail ?? "n/a", c.gray)}`,
    `${sym.tick} ${paint("RPC", c.bold)}        ${paint(results.rpc?.detail ?? "public", c.gray)}`,
  ];
  console.log(box(lines.join("\n"), { title: "AgentIX is ready", color: c.green }));

  console.log(`\n  ${paint("Next steps", c.bold + c.violet)}`);
  console.log(`    ${sym.arrow} ${paint("agentix doctor", c.cyan)}        run full diagnostics`);
  console.log(`    ${sym.arrow} ${paint("agentix wallet create", c.cyan)} deploy your first agent wallet`);
  console.log(`    ${sym.arrow} ${paint("agentix dashboard", c.cyan)}     open the web dashboard`);
  console.log(`\n  ${paint("Your AI harness can now call AgentIX tools directly via MCP.", c.gray)}\n`);
}

/**
 * Tiny promise-based sleep for pacing wizard spinners.
 * Cosmetic delay so users can read each step — never use it for timing or
 * synchronization, it only yields the event loop.
 * @param ms - Milliseconds to wait.
 * @returns A promise resolving after ms.
 * Maps to: internal — setup-wizard step functions.
 * Side effects: none (timer only).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the full interactive wizard.
 * Five steps in order — environment, storage, RPC, harnesses, summary — stopping
 * early (false) when the environment or storage step fails; RPC and harness
 * steps degrade instead of failing. Safe to re-run: re-connects harnesses and
 * re-verifies RPC.
 * @param opts.yes - Skip all prompts, public RPC (CI / non-interactive); @param opts.rpc - Pre-supplied RPC URL (skips the RPC prompt).
 * @returns True when setup completed (including degraded RPC/harness steps), false when the user declines to begin or env/storage fails.
 * @throws Throws if an interactive prompt fails.
 * Maps to: CLI 'agentix setup'.
 * Side effects: creates dirs + DB, writes config, may write MCP entries into external harness configs, terminal I/O throughout.
 */
export async function runSetupWizard(opts: WizardOptions = {}): Promise<boolean> {
  banner("Local-first AI agent credential runtime  ·  Base Sepolia");

  if (!opts.yes && isTTY) {
    console.log(box(
      `${paint("This wizard will:", c.white)}\n` +
      `${sym.dot} verify your environment\n` +
      `${sym.dot} create local storage + database\n` +
      `${sym.dot} configure an RPC endpoint (public by default)\n` +
      `${sym.dot} auto-detect AI harnesses and wire in AgentIX MCP tools`,
      { title: "Welcome", color: c.indigo },
    ));
    const go = await confirm("Ready to begin?", true);
    if (!go) {
      console.log(`\n  ${paint("Setup cancelled. Run", c.gray)} ${paint("agentix setup", c.cyan)} ${paint("anytime.", c.gray)}\n`);
      return false;
    }
  }

  const results: Record<string, StepResult> = {};
  results.env = await checkEnvironment();
  if (!results.env.ok) {
    console.log(`\n  ${sym.cross} ${paint("Environment check failed — resolve the above and re-run.", c.red)}\n`);
    return false;
  }
  results.storage = await initStorage();
  if (!results.storage.ok) {
    console.log(`\n  ${sym.cross} ${paint("Storage init failed — resolve the above and re-run.", c.red)}\n`);
    return false;
  }
  results.rpc = await configureRpc(opts);
  results.harnesses = await connectHarnesses(opts);
  finish(results);
  return true;
}
