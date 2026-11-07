import { createHash, randomBytes } from "crypto";

/**
 * Returns a fresh 32-hex-char (128-bit) random identifier.
 * Why: ids for backups, sessions and similar records must be unguessable and
 * collision-free without a central counter or a DB round-trip.
 * @returns 32 lowercase hex chars from 16 cryptographic random bytes; never empty.
 * @throws Nothing — `randomBytes` throws only if the OS RNG is unavailable, in which case the process cannot mint ids at all.
 * Maps to: internal — BackupEngine.create (backup ids) and any caller needing an unguessable id.
 */
export function generateId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Returns the lowercase hex SHA-256 of a UTF-8 string.
 * Why: a single canonical hash for backup integrity checks and content addressing.
 * @returns 64 lowercase hex chars; the empty string hashes to the well-known SHA-256 of "".
 * @throws Nothing — pure computation.
 * Maps to: internal — BackupEngine.create / restore (backup checksums).
 */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Returns the SHA-256 checksum of a string (alias for `sha256`).
 * Why: call sites that think in "checksum" terms read better than a bare hash call.
 * @returns Same 64-char hex digest as `sha256`.
 * @throws Nothing — pure computation.
 * Maps to: internal — BackupEngine.create / restore (backup checksums).
 */
export function checksum(data: string): string {
  return sha256(data);
}

/**
 * Returns a `0x1234...abcd` style abbreviation of an address.
 * Why: display-only shortening for logs and UI; the full address must still be used for any on-chain or lookup operation.
 * @param addr Full address string; shorter than 10 chars (or empty) is returned unchanged.
 * @returns First 6 chars + "..." + last 4 chars, or `addr` unchanged when too short to abbreviate.
 * @throws Nothing — pure string slicing.
 * Maps to: internal — any log/UI caller formatting an address for display.
 */
export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Returns a wei amount formatted as ETH with 4 decimal places.
 * Why: display-only conversion for balances and limits; never use the result for arithmetic or value transfer.
 * @param wei Decimal wei string; non-numeric input yields "NaN".
 * @returns ETH value with exactly 4 decimals (e.g. "1.5000").
 * @throws Nothing — but precision is lost above 2^53 wei (~9 ETH): `Number` cannot represent large wei exactly, so large balances are approximate.
 * Maps to: internal — any log/UI caller displaying a balance or spend limit.
 */
export function formatEth(wei: string): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(4);
}

/**
 * Resolves after the given delay.
 * Why: the only sanctioned way to pause an async flow (retries, polling); callers must not busy-wait.
 * @param ms Delay in milliseconds; 0 or negative resolves on the next tick.
 * @returns A promise that resolves with no value after the delay.
 * @throws Nothing.
 * Maps to: internal — any async caller needing a timed pause.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns `str` shortened to at most `max` chars with a "..." suffix.
 * Why: keep logs, descriptions and error strings bounded without the caller doing the arithmetic.
 * @param str Input string; returned unchanged when it already fits.
 * @param max Maximum output length including the "..."; must be > 3 for the suffix to make sense — 3 or less truncates without a suffix.
 * @returns The original string when short enough, else the first `max - 3` chars + "...".
 * @throws Nothing.
 * Maps to: internal — any caller capping a display string.
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  if (max <= 3) return str.slice(0, max);
  return str.slice(0, max - 3) + "...";
}

/**
 * Returns the current Unix time in seconds.
 * Why: every timestamp stored in the DB (expiry, createdAt) is seconds, so callers need seconds, not `Date.now()` millis.
 * @returns Seconds since the Unix epoch (floor of `Date.now() / 1000`).
 * @throws Nothing.
 * Maps to: internal — BackupEngine.create, TreeEngine.snapshot (stored timestamps).
 */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Returns true when a Unix-seconds expiry is already in the past.
 * Why: one place for the "is this session/credential/request still live?" check, so the comparison never drifts between call sites.
 * @param expiry Unix timestamp in seconds (not millis — a millis value reads as far-future and never expires).
 * @returns True when `nowUnix() > expiry`; exactly at the expiry second it is not yet expired.
 * @throws Nothing.
 * Maps to: internal — session/credential expiry checks (see Session.expiry, Credential.expiry).
 */
export function isExpired(expiry: number): boolean {
  return nowUnix() > expiry;
}

/**
 * Returns a human "5m ago" style age for a past Unix timestamp.
 * Why: display-only relative time for logs and UI; never use it for an expiry decision (use `isExpired`).
 * @param timestamp Unix timestamp in seconds; a future timestamp yields a negative diff ("-5s ago").
 * @returns "<n>s/m/h/d ago", picking the largest whole unit under 60s / 1h / 1d.
 * @throws Nothing.
 * Maps to: internal — any log/UI caller showing how old an event is.
 */
export function relativeTime(timestamp: number): string {
  const diff = nowUnix() - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
