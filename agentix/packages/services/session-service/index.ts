import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import { generateId } from "../../shared/utils";
import type { Session } from "../../shared/types";

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
   * @deprecated Use src/tools/session.ts createLightweightSession() instead.
   * That method handles contract interaction and owner signatures.
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

  validate(sessionId: string, value?: string): { valid: boolean; reason?: string; session?: Session } {
    const session = runSingleCamel<Session>("SELECT * FROM sessions WHERE session_id = ?", sessionId);
    if (!session) return { valid: false, reason: "Session not found" };
    if (session.revoked) return { valid: false, reason: "Session revoked" };

    const now = Math.floor(Date.now() / 1000);
    if (session.expiry < now) return { valid: false, reason: "Session expired" };

    return { valid: true, session };
  }

  /**
   * @deprecated Use src/tools/session.ts revokeSession() instead.
   * That method handles contract interaction.
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

  get(sessionId: string): Session | undefined {
    return runSingleCamel<Session>("SELECT * FROM sessions WHERE session_id = ?", sessionId);
  }

  listByWallet(walletAddress: string): Session[] {
    return runQueryCamel<Session>("SELECT * FROM sessions WHERE wallet_address = ? ORDER BY created_at DESC", walletAddress);
  }

  listAll(): Session[] {
    return runQueryCamel<Session>("SELECT * FROM sessions ORDER BY created_at DESC");
  }

  count(): number {
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM sessions WHERE revoked = 0");
    return r?.count || 0;
  }
}

let _svc: SessionService | null = null;
export function getSessionService(): SessionService {
  if (!_svc) _svc = new SessionService();
  return _svc;
}
