import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import { generateId } from "../../shared/utils";
import type { Session } from "../../shared/types";

/**
 * Appends an event row to the events table, swallowing all failures.
 * WHY: audit logging must never break the operation it records — a full or missing events table must not fail a session create/revoke.
 * @param eventType Event name, e.g. "SessionCreated".
 * @param data JSON-serializable payload; unserializable data fails the insert and is dropped silently.
 * @param txHash On-chain tx hash when the event corresponds to a transaction; empty string when absent.
 * @returns Nothing.
 * @throws Never throws — every failure is caught and dropped, including a missing events table.
 * Maps to: internal — SessionService.create / revoke (only callers); event SessionCreated / SessionRevoked.
 * Side effects: inserts one row into events (disk I/O) on success; silently nothing on failure.
 */
function persistEvent(eventType: string, data: any, txHash?: string) {
  try {
    runExecute(
      "INSERT INTO events (event_type, data, tx_hash, created_at) VALUES (?, ?, ?, ?)",
      eventType,
      JSON.stringify(data),
      txHash || "",
      Math.floor(Date.now() / 1000)
    );
  } catch {}
}

/**
 * SessionService — Thin wrapper around the database.
 *
 * WRITE operations (create, revoke) are delegated to src/tools/session.ts
 * which is the CANONICAL implementation. It handles:
 * - Contract interaction (SessionManager)
 * - Owner signature validation
 * - Event persistence
 *
 * This service provides read operations and local validation.
 *
 * @deprecated This service will be removed in V2. Use src/tools/session.ts directly.
 */
export class SessionService {
  private bus = getEventBus();

  /**
   * Creates a session row directly in the local DB (deprecated shim — no contract call, no owner signature).
   * WHY: backwards-compatible local-only creation; new callers must use src/tools/session.ts createLightweightSession(), which registers the session on-chain via SessionManager with an owner signature.
   * @deprecated Use src/tools/session.ts createLightweightSession() instead. That method handles contract interaction and owner signatures.
   * @param walletAddress Wallet the session belongs to; stored verbatim.
   * @param sessionKey Session key address that will sign within this session.
   * @param organizationId Owning org id, or undefined for standalone wallets (stored as NULL).
   * @param sessionType Numeric session type as stored; the canonical tool's type mapping is not applied here.
   * @param dailySpendLimit Daily spend cap as a decimal string (wei); no validation is performed.
   * @param dailyTxLimit Daily transaction cap; no validation is performed.
   * @param expiry Unix timestamp (seconds) after which the session is invalid.
   * @returns The created session row, re-read from the DB.
   * @throws Throws on DB errors.
   * Maps to: contract SessionManager.createLightweightSession (canonical counterpart in src/tools/session.ts); event SessionCreated.
   * Side effects: inserts a row into sessions, emits SessionCreated, and persists a SessionCreated event row. The on-chain SessionManager never learns of this session, so contract-side enforcement does not apply.
   * Security note: no owner signature is collected or checked — anyone who can call this creates a session for any wallet. Only the deprecated local path; the canonical tool requires the owner's signature.
   */
  create(walletAddress: string, sessionKey: string, organizationId: string | undefined, sessionType: number, dailySpendLimit: string, dailyTxLimit: number, expiry: number): Session {
    const sessionId = `sess_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    runExecute(
      "INSERT INTO sessions (session_id, wallet_address, session_key, organization_id, session_type, daily_spend_limit, daily_tx_limit, expiry, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      sessionId, walletAddress, sessionKey, organizationId || null, sessionType, dailySpendLimit, dailyTxLimit, expiry, now
    );

    const session = runSingleCamel<Session>("SELECT * FROM sessions WHERE session_id = ?", sessionId)!;
    this.bus.emit({ type: "SessionCreated", data: { sessionId, walletAddress } });
    persistEvent("SessionCreated", { sessionId, walletAddress });
    return session;
  }

  /**
   * Checks whether a session may still be used: exists, not revoked, not expired.
   * WHY: the pre-execution gate — every spend or action must pass this before the session key is trusted.
   * @param sessionId Id of the session to check.
   * @param value Accepted but ignored — no spend/limit check is performed against it; callers must enforce daily spend/tx limits separately.
   * @returns `{ valid: true, session }` when usable; otherwise `{ valid: false, reason }` with "Session not found", "Session revoked", or "Session expired".
   * @throws Throws on DB errors.
   * Maps to: policy rule spend-cap / session validity (pre-execution check before SessionManager execution).
   * Side effects: none (read-only). NOTE: this is a local-DB check only — it does not consult the on-chain SessionManager, so direct on-chain revocation is invisible here.
   */
  validate(sessionId: string, value?: string): { valid: boolean; reason?: string; session?: Session } {
    const session = runSingleCamel<Session>("SELECT * FROM sessions WHERE session_id = ?", sessionId);
    if (!session) return { valid: false, reason: "Session not found" };
    if (session.revoked) return { valid: false, reason: "Session revoked" };

    const now = Math.floor(Date.now() / 1000);
    if (session.expiry < now) return { valid: false, reason: "Session expired" };

    return { valid: true, session };
  }

  /**
   * Revokes a session locally: marks it revoked, emits the event, and records it (deprecated shim — no contract call).
   * WHY: backwards-compatible local revocation; new callers must use src/tools/session.ts revokeSession(), which revokes on-chain via SessionManager.
   * @deprecated Use src/tools/session.ts revokeSession() instead. That method handles contract interaction.
   * @param sessionId Id of the session to revoke.
   * @param walletAddress Owner wallet; the session must belong to it or the call fails as "not found".
   * @returns `{ success: true }`, or `{ success: false, error }` when the session is missing, belongs to another wallet, or is already revoked.
   * @throws Throws on DB errors.
   * Maps to: contract SessionManager revoke (canonical counterpart in src/tools/session.ts); event SessionRevoked.
   * Side effects: sets revoked = 1 with revoked_at, emits SessionRevoked, persists a SessionRevoked event row. The on-chain session stays live until revoked via the canonical tool.
   * Security note: no signature or ownership proof is checked beyond the walletAddress match — a caller who knows both ids can revoke the session.
   */
  revoke(sessionId: string, walletAddress: string): { success: boolean; error?: string } {
    const session = runSingleCamel<Session>("SELECT * FROM sessions WHERE session_id = ? AND wallet_address = ?", sessionId, walletAddress);
    if (!session) return { success: false, error: "Session not found" };
    if (session.revoked) return { success: false, error: "Session already revoked" };

    const now = Math.floor(Date.now() / 1000);
    runExecute("UPDATE sessions SET revoked = 1, revoked_at = ? WHERE session_id = ?", now, sessionId);
    this.bus.emit({ type: "SessionRevoked", data: { sessionId } });
    persistEvent("SessionRevoked", { sessionId, walletAddress });
    return { success: true };
  }

  /**
   * Fetches one session by id.
   * WHY: the read path for validation, display, and revocation flows that already hold the id.
   * @returns The session, or undefined when no row matches.
   * @throws Throws on DB errors.
   * Maps to: internal — SessionService.validate / revoke (pre-check read).
   * Side effects: none (read-only).
   */
  get(sessionId: string): Session | undefined {
    return runSingleCamel<Session>("SELECT * FROM sessions WHERE session_id = ?", sessionId);
  }

  /**
   * Lists a wallet's sessions, newest first.
   * WHY: the per-wallet session inventory — what keys are live for this wallet and what has expired.
   * @returns Sessions ordered by created_at descending; empty array for a wallet with no sessions. Includes revoked rows.
   * @throws Throws on DB errors.
   * Maps to: internal — SessionService.listAll (wallet-scoped form).
   * Side effects: none (read-only).
   */
  listByWallet(walletAddress: string): Session[] {
    return runQueryCamel<Session>("SELECT * FROM sessions WHERE wallet_address = ? ORDER BY created_at DESC", walletAddress);
  }

  /**
   * Lists every session, newest first.
   * WHY: the operator's global session inventory across all wallets.
   * @returns All sessions ordered by created_at descending; empty array when none exist. Includes revoked rows and has no limit — large deployments return everything.
   * @throws Throws on DB errors.
   * Maps to: internal — SessionService.listByWallet (unfiltered form).
   * Side effects: none (read-only).
   */
  listAll(): Session[] {
    return runQueryCamel<Session>("SELECT * FROM sessions ORDER BY created_at DESC");
  }

  /**
   * Counts sessions that are not revoked.
   * WHY: the live-session count for dashboards and health checks — revoked sessions are history, not capacity.
   * @returns The count of rows with revoked = 0, 0 when none. Expired-but-unrevoked sessions are still counted.
   * @throws Throws on DB errors.
   * Maps to: internal — SessionService.listAll (count of the live subset).
   * Side effects: none (read-only).
   */
  count(): number {
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM sessions WHERE revoked = 0");
    return r?.count || 0;
  }
}

let _svc: SessionService | null = null;
/**
 * Returns the process-wide singleton SessionService.
 * WHY: one service per process — all session reads share the same event-bus subscription surface.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — SessionService (module-level accessor).
 * Side effects: creates the singleton on first call.
 */
export function getSessionService(): SessionService {
  if (!_svc) _svc = new SessionService();
  return _svc;
}
