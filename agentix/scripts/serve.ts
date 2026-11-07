/**
 * serve.ts — one-shot launcher for the AgentIX local stack.
 *
 * Starts the API server first and lets IT choose a free port (near 3001) and
 * publish that port to AGENTIX_HOME/runtime.json. The launcher then reads the
 * port the server ACTUALLY bound, picks a free dashboard port (near 3000), and
 * starts the dashboard pointed straight at the real API URL. Starting the API
 * first — rather than pre-guessing its port here — avoids a race where the
 * server's own findFreePort lands somewhere other than the launcher's guess.
 *
 * Usage:
 *   bun x tsx scripts/serve.ts            # dev (next dev)
 *   bun x tsx scripts/serve.ts --prod     # production (next start, needs build)
 *   bun x tsx scripts/serve.ts --no-open  # don't open the browser
 */
import { spawn } from "child_process";
import { createRequire } from "module";
import { join } from "path";
import { findFreePort, readRuntimeManifest, writeRuntimeManifest, clearRuntimeManifest } from "../src/core/ports";

/**
 * Resolves the dashboard's own pinned Next.js binary instead of relying on `npx next`.
 * WHY: a globally resolved Next (e.g. v16, Turbopack by default) rejects this repo's webpack config — pinning to the dashboard's local 14.x keeps dev/prod boots deterministic.
 * @param dashboardDir Dashboard app directory containing the Next install (apps/dashboard).
 * @returns Absolute path to the local `next` binary, or null when resolution fails (caller falls back to `npx next@14`).
 * @throws Never throws — resolution failures return null.
 * Maps to: internal — serve main() (dashboard launch step).
 * Side effects: none (module resolution only).
 */
function resolveLocalNextBin(dashboardDir: string): string | null {
  try {
    const req = createRequire(join(dashboardDir, "package.json"));
    const pkgPath = req.resolve("next/package.json");
    const pkg = req("next/package.json");
    const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.next;
    if (!binRel) return null;
    return join(pkgPath, "..", binRel);
  } catch {
    return null;
  }
}

const HOST = "127.0.0.1";
const PROD = process.argv.includes("--prod");
const NO_OPEN = process.argv.includes("--no-open");

/**
 * Opens a URL in the user's default browser, unless --no-open was passed.
 * WHY: the launcher's last step — the dashboard is only useful once the operator can see it.
 * @param url Full URL to open, e.g. http://127.0.0.1:3000.
 * @returns Nothing; a failed launch is swallowed — the stack keeps running.
 * @throws Never throws.
 * Maps to: internal — serve main() (post-boot browser open).
 * Side effects: spawns the platform opener (cmd/open/xdg-open), detached; no effect with --no-open.
 */
function openBrowser(url: string) {
  if (NO_OPEN) return;
  const platform = process.platform;
  const cmd = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening the browser is best-effort */
  }
}

/**
 * Resolves after a delay.
 * WHY: the polling primitive main() uses to wait for the API server to publish its bound port.
 * @param ms Delay in milliseconds.
 * @returns A promise that resolves after the delay; never rejects.
 * @throws Never throws.
 * Maps to: internal — serve main() (API-port wait loop).
 * Side effects: one timer.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launches the local AgentIX stack: starts the API server, waits for it to publish its real port, picks a free dashboard port, starts the dashboard against the real API URL, and opens the browser.
 * WHY: the API chooses its own free port near 3001 — starting it first and reading runtime.json avoids the race where a guessed port is wrong and the dashboard proxies to nothing.
 * @returns Nothing; the process stays alive until SIGINT/SIGTERM or until either child exits (which tears the whole stack down).
 * @throws Exits with code 1 (does not throw to a caller) when the API reports no port within 10 s or the stack fails to start.
 * Maps to: CLI `agentix` local dev workflow (dashboard + API server); internal — src/core/ports (runtime.json manifest).
 * Side effects: clears/writes the runtime manifest, spawns the API and dashboard child processes, registers SIGINT/SIGTERM handlers. Run from the agentix/ directory — `root` is process.cwd().
 * Security note: the stack binds 127.0.0.1 only; the API server has no authentication, so never expose these ports beyond localhost.
 */
async function main() {
  const root = process.cwd();

  // Start from a clean manifest so we can reliably detect the API's new port
  // (rather than reading a stale apiPort from a previous run).
  clearRuntimeManifest();

  const apiPreferred = parseInt(process.env.AGENTIX_API_PORT || "3001", 10);

  console.log("AgentIX — starting local stack");

  // 1. Start the API server. It runs findFreePort(apiPreferred) internally and
  //    writes the resolved apiPort into runtime.json.
  const api = spawn("bun", ["x", "tsx", "src/runtime/server.ts"], {
    cwd: root,
    env: { ...process.env, AGENTIX_API_PORT: String(apiPreferred) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  // 2. Wait for the API to publish the port it actually bound.
  let apiPort = 0;
  for (let i = 0; i < 40 && !apiPort; i++) {
    await sleep(250);
    apiPort = readRuntimeManifest().apiPort || 0;
  }
  if (!apiPort) {
    console.error("API server did not report a port within 10s. Aborting.");
    try { api.kill(); } catch { /* noop */ }
    process.exit(1);
  }

  // 3. Pick a free dashboard port and record it alongside the API port.
  const dashPort = await findFreePort(parseInt(process.env.AGENTIX_DASHBOARD_UI_PORT || "3000", 10), HOST);
  writeRuntimeManifest({ dashboardPort: dashPort, host: HOST });

  console.log(`  API server : http://${HOST}:${apiPort}`);
  console.log(`  Dashboard  : http://${HOST}:${dashPort}`);
  if (apiPort !== apiPreferred || dashPort !== 3000) {
    console.log("  (one or more preferred ports were busy — using free ports instead)");
  }
  console.log("");

  // 4. Start the dashboard pointed at the API's REAL url. next.config.js reads
  //    AGENTIX_API_URL first, so /api/* proxies to the right place regardless
  //    of what the manifest holds. Use the dashboard's locally-pinned Next
  //    binary (via node) so we don't accidentally run a globally-resolved
  //    newer Next that breaks on our config.
  const dashboardDir = join(root, "apps", "dashboard");
  const sub = PROD ? "start" : "dev";
  const nextBin = resolveLocalNextBin(dashboardDir);
  let dashProgram: string;
  let dashArgs: string[];
  if (nextBin) {
    dashProgram = process.execPath; // node
    dashArgs = [nextBin, sub, "-p", String(dashPort)];
  } else {
    // Fall back to npx if the local resolution fails, but pin the major so we
    // don't silently jump to a breaking Next release.
    console.warn("  (could not resolve local Next binary — falling back to npx next@14)");
    dashProgram = process.platform === "win32" ? "npx.cmd" : "npx";
    dashArgs = ["next@14", sub, "-p", String(dashPort)];
  }
  const dash = spawn(dashProgram, dashArgs, {
    cwd: dashboardDir,
    env: { ...process.env, AGENTIX_API_URL: `http://${HOST}:${apiPort}` },
    stdio: "inherit",
    shell: false,
  });

  // Give the dashboard a moment to boot, then open it.
  setTimeout(() => openBrowser(`http://${HOST}:${dashPort}`), 4000);

  let shuttingDown = false;
  /**
   * Kills both child processes, clears the runtime manifest, and exits.
   * WHY: a half-running stack with a stale manifest would mislead the next launch about which ports are live.
   * @returns Nothing; safe to call repeatedly (guarded by shuttingDown).
   * @throws Never throws — kill/clear failures are swallowed.
   * Maps to: internal — serve main() (SIGINT/SIGTERM handlers and child-exit handlers).
   * Side effects: kills the API and dashboard processes, clears runtime.json, exits the process with code 0.
   */
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { api.kill(); } catch { /* noop */ }
    try { dash.kill(); } catch { /* noop */ }
    clearRuntimeManifest();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // If either child exits, tear the whole stack down so we don't leave a
  // half-running system with a stale manifest.
  api.on("exit", (code) => {
    if (!shuttingDown) console.error(`API server exited (code ${code}). Shutting down.`);
    shutdown();
  });
  dash.on("exit", (code) => {
    if (!shuttingDown) console.error(`Dashboard exited (code ${code}). Shutting down.`);
    shutdown();
  });
}

main().catch((e) => {
  console.error("Failed to start AgentIX stack:", e?.message || e);
  process.exit(1);
});
