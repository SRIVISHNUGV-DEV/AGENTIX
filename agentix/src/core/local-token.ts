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

/** Generate a fresh per-run token, hold it in memory, and persist it 0600. */
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

/** Read the current run's token from disk (for local clients / tests). */
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
 * Timing-safe token check. Compares against the in-memory run token when
 * this process generated one, else falls back to the token file.
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

export function getLocalTokenPath(): string {
  return TOKEN_PATH;
}
