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
 * Check whether a TCP port is free to bind on `host`. Resolves true if the port
 * can be bound (and is immediately released), false on EADDRINUSE / EACCES.
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
 * Find a free TCP port. Tries `preferred` first, then walks upward up to
 * `maxTries` ports. If none in that window are free, asks the OS for an
 * ephemeral port (port 0) as a last resort so the service ALWAYS starts.
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

/** Read the runtime manifest. Returns {} if absent or unparseable. */
export function readRuntimeManifest(): RuntimeManifest {
  try {
    if (!existsSync(RUNTIME_MANIFEST_PATH)) return {};
    return JSON.parse(readFileSync(RUNTIME_MANIFEST_PATH, "utf-8")) as RuntimeManifest;
  } catch {
    return {};
  }
}

/** Merge-write the runtime manifest (creates AGENTIX_HOME if needed). */
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

/** Remove the runtime manifest (best-effort, e.g. on graceful shutdown). */
export function clearRuntimeManifest(): void {
  try {
    if (existsSync(RUNTIME_MANIFEST_PATH)) unlinkSync(RUNTIME_MANIFEST_PATH);
  } catch {
    /* best-effort */
  }
}

export function getRuntimeManifestPath(): string {
  return RUNTIME_MANIFEST_PATH;
}
