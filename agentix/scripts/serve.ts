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
 * Resolve the dashboard's OWN pinned Next.js binary (14.x) rather than relying
 * on `npx next`, which can silently fetch/resolve a different global Next
 * (e.g. v16, which defaults to Turbopack and rejects our webpack config). We
 * resolve next/package.json from the dashboard dir, then locate its bin entry.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
