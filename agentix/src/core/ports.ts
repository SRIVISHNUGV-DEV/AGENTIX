import net from "net";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { AGENTIX_HOME } from "./config";

/**
 * ports — free-port discovery + a small runtime manifest so services can find
 * each other without hardcoding a port.
 *
 * WHY: the API server and the dashboard used to bind fixed ports (3001 / 3000).
 * If a user already had something on those ports, the service either crashed
 * (EADDRINUSE) or, worse, silently attached expectations to a port owned by an
 * unrelated process. Now each service asks the OS for a free port near its
 * preferred one and records where it actually landed in AGENTIX_HOME/runtime.json.
 * The browser can't read that file, so the dashboard's next.config.js reads the
 * manifest at startup and proxies same-origin /api/* to the discovered API port.
 */

const RUNTIME_MANIFEST_PATH = join(AGENTIX_HOME, "runtime.json");

export interface RuntimeManifest {
  /** Port the API/runtime server is actually listening on. */
  apiPort?: number;
  /** Port the Next.js dashboard is actually listening on. */
  dashboardPort?: number;
  /** Host the services bind to (always loopback). */
  host?: string;
  /** PID of the API server process (for liveness checks / shutdown). */
  apiPid?: number;
  /** Unix seconds the manifest was last written. */
  updatedAt?: number;
}

/**
 * Probe whether a TCP port can be bound on `host` right now.
 * The bind is released immediately, so a free result is a snapshot — re-check at real bind time.
 * @param port — TCP port 0–65535; out-of-range values resolve false via the bind error.
 * @returns True when the port binds (and is released); false on EADDRINUSE/EACCES or any bind error.
 * @throws Never throws — bind errors resolve false.
 * Maps to: internal — findFreePort (preferred-port scan).
 */
export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, host);
  });
}

/**
 * Find a bindable port, preferring `preferred` and walking upward.
 * Services must never hard-crash on EADDRINUSE: a taken preferred port just shifts by one.
 * @param preferred — first port to try; must be 0–65535.
 * @param maxTries — how many consecutive ports to try before asking the OS for an ephemeral port.
 * @returns A free port; always resolves — the OS-assigned ephemeral port is the last resort.
 * @throws Only when the OS itself cannot allocate a port (ephemeral bind failure).
 * Maps to: internal — API/dashboard startup (port actually bound is recorded in the runtime manifest).
 */
export async function findFreePort(
  preferred: number,
  host = "127.0.0.1",
  maxTries = 50
): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const candidate = preferred + i;
    if (candidate > 65535) break;
    if (await isPortFree(candidate, host)) return candidate;
  }
  // Last resort: let the OS pick any free ephemeral port. This guarantees the
  // service can bind even when the whole preferred window is occupied.
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Read the runtime manifest (which ports the services actually landed on).
 * The dashboard's proxy reads this at startup, so a stale or missing manifest means /api has nowhere to go.
 * @returns The manifest, or {} when the file is absent or unparseable.
 * @throws Never throws — parse/I/O failures return {}.
 * Maps to: internal — dashboard next.config.js proxy (reads the manifest to find the API port).
 */
export function readRuntimeManifest(): RuntimeManifest {
  try {
    if (!existsSync(RUNTIME_MANIFEST_PATH)) return {};
    return JSON.parse(readFileSync(RUNTIME_MANIFEST_PATH, "utf-8")) as RuntimeManifest;
  } catch {
    return {};
  }
}

/**
 * Merge-write fields into the runtime manifest and stamp it with the current time.
 * Call once a service has bound, so the other service can discover the real port.
 * @param patch — fields to set; unspecified fields keep their previous values.
 * @returns The full merged manifest, including updatedAt (unix seconds).
 * @throws Throws on disk write failure; callers at startup should treat that as fatal.
 * Maps to: internal — API/dashboard startup (records apiPort / dashboardPort / apiPid).
 * Side effects: creates AGENTIX_HOME if needed and writes runtime.json.
 */
export function writeRuntimeManifest(patch: RuntimeManifest): RuntimeManifest {
  const dir = dirname(RUNTIME_MANIFEST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const merged: RuntimeManifest = {
    ...readRuntimeManifest(),
    ...patch,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  writeFileSync(RUNTIME_MANIFEST_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * Delete the runtime manifest, e.g. on graceful shutdown.
 * Prevents the next start from trusting a stale port/PID left by a dead process.
 * @returns Nothing.
 * @throws Never throws — a missing file or unlink failure is swallowed.
 * Maps to: internal — graceful shutdown path (counterpart of writeRuntimeManifest).
 * Side effects: deletes runtime.json when present.
 */
export function clearRuntimeManifest(): void {
  try {
    if (existsSync(RUNTIME_MANIFEST_PATH)) unlinkSync(RUNTIME_MANIFEST_PATH);
  } catch {
    /* best-effort */
  }
}

/**
 * Return the absolute path of the runtime manifest file.
 * Only for diagnostics and tests that need to locate (not read) the file.
 * @returns The path under AGENTIX_HOME; the file may not exist yet.
 * @throws Never throws.
 * Maps to: internal — readRuntimeManifest / writeRuntimeManifest / clearRuntimeManifest.
 */
export function getRuntimeManifestPath(): string {
  return RUNTIME_MANIFEST_PATH;
}
