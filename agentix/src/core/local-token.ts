import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "fs";
import { randomBytes, timingSafeEqual } from "crypto";
import { join, dirname } from "path";
import { AGENTIX_HOME } from "./config";

/**
 * local-token — the per-run localhost token (R-5).
 *
 * THREAT MODEL: the API binds loopback, but loopback is reachable from any
 * browser tab, local process, and forwarded port — it is not an auth
 * boundary. The token is the boundary: every state-changing REST route
 * (and a small list of sensitive GETs) requires it, and the only ways to
 * learn it are (a) reading the server's startup log, (b) reading the
 * 0600 token file in AGENTIX_HOME, or (c) holding it in dashboard
 * localStorage after the owner pastes it once. A web page on another
 * origin can do none of those (same-origin policy + the CORS allowlist),
 * so it cannot drive the API even though it can reach loopback.
 *
 * The token is generated fresh on every server start (per-run, not
 * per-install) so a leaked token dies on restart. It is held in module
 * memory for verification; the file exists only so local clients (and
 * tests) can discover the current run's token.
 *
 * SCOPE: the token proves "local owner process", not "which human". Any
 * script running on the dashboard origin, and any local process that can
 * read AGENTIX_HOME, is inside the trust boundary. That is documented in
 * docs/SECURITY.md, not hidden.
 */

export const LOCAL_TOKEN_HEADER = "X-Agentix-Token";

const TOKEN_PATH = join(AGENTIX_HOME, ".local-token");

let _currentToken: string | null = null;

/**
 * Mint a fresh per-run localhost token and hold it in memory.
 * Called once at server startup: the token is the loopback auth boundary, so a new
 * run must never reuse a previous run's token.
 * @returns The 64-hex-char token; also persisted 0600 to the token file for local discovery.
 * @throws Never throws — file persistence failures are swallowed; the in-memory token still gates.
 * Maps to: REST — X-Agentix-Token issuance at server startup (src/runtime/server.ts).
 * Side effects: overwrites the in-memory token and the token file on disk.
 * Security: 32 random bytes; file is 0600. Anyone who can read it can drive the API.
 */
export function ensureLocalToken(): string {
  const token = randomBytes(32).toString("hex");
  _currentToken = token;
  const dir = dirname(TOKEN_PATH);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
    try {
      chmodSync(TOKEN_PATH, 0o600);
    } catch {
      /* best-effort on platforms without POSIX perms */
    }
  } catch {
    /* file discovery is best-effort; the in-memory token still gates */
  }
  return token;
}

/**
 * Read the current run's token from disk, for local clients and tests.
 * Use this only when this process did not generate the token (e.g. dashboard/CLI discovery).
 * @returns The token string, or null when the file is missing, empty, or unreadable.
 * @throws Never throws — all I/O failures return null.
 * Maps to: internal — local clients discovering the run token (see ensureLocalToken).
 * Security: returns a live credential; callers must not log or expose it.
 */
export function readLocalToken(): string | null {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const t = readFileSync(TOKEN_PATH, "utf-8").trim();
    return t || null;
  } catch {
    return null;
  }
}

/**
 * Timing-safe check of a presented loopback token against the run token.
 * Call on every state-changing REST route (and sensitive GETs) before doing anything else.
 * @param candidate — the presented value; anything non-string or empty fails closed.
 * @returns True only on an exact match; false when no token exists for this run.
 * @throws Never throws — comparison errors return false.
 * Maps to: REST — token gate in src/runtime/server.ts (X-Agentix-Token header).
 * Security: constant-time compare; falls back to the token file when this process did not mint the token.
 */
export function verifyLocalToken(candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const expected = _currentToken ?? readLocalToken();
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Return the absolute path of the per-run token file.
 * Only for diagnostics and tests that need to locate (not read) the file.
 * @returns The token path under AGENTIX_HOME; the file may not exist yet.
 * @throws Never throws.
 * Maps to: internal — ensureLocalToken / readLocalToken (token file location).
 */
export function getLocalTokenPath(): string {
  return TOKEN_PATH;
}
