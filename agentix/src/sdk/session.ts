import { ethers } from 'ethers';
import { StandardSession, LightweightSession, SessionType, CreateStandardSessionParams, CreateLightSessionParams, TransactionResult } from './types';
import { assertAddress, assertNonZero, assertInFuture } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class SessionModule {
  /**
   * Wires the session module to the contract registry, transaction sender, and local cache.
   * @returns A SessionModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Reports whether a session id is a standard (ZK) session, a lightweight session, or nothing at all.
   * Check this before reading session details — the two kinds have different storage layouts.
   * @returns 'standard', 'lightweight', or 'none' for an unknown id (the contract returns other values as 'none').
   * Maps to: contract SessionManager.getSessionType.
   */
  async getType(sessionId: string): Promise<SessionType> {
    const sm = this.contracts.get('SessionManager');
    const t: number = await sm.getSessionType(sessionId);
    if (t === 0) return 'standard';
    if (t === 1) return 'lightweight';
    return 'none';
  }

  /**
   * Reads a ZK-proof-gated standard session (wallet, key, value used/max, expiry, revoked).
   * Returns the stored struct as-is; it does not validate the session against a call.
   * @returns The StandardSession; fields are zeroed when the id does not exist — call getType first.
   * Maps to: contract SessionManager.sessions; CLI 'agentix session' get.
   */
  async getStandard(sessionId: string): Promise<StandardSession> {
    const sm = this.contracts.get('SessionManager');
    const s = await sm.sessions(sessionId);
    return {
      sessionId,
      wallet: s.wallet,
      sessionKey: s.sessionKey,
      valueUsed: s.valueUsed,
      maxValue: s.maxValue,
      expiry: Number(s.expiry),
      revoked: s.revoked,
    };
  }

  /**
   * Reads a lightweight session (daily spend/tx limits and usage, expiry, revoked, allowed targets).
   * NOTE: lastResetDay is always returned as 0 — the on-chain getter exposes no reset-day field, so daily usage cannot be dated from this result alone.
   * @returns The LightweightSession; fields are zeroed when the id does not exist — call getType first.
   * Maps to: contract SessionManager.getLightSession / getSessionTargets; MCP tool agentix_session_status.
   */
  async getLightweight(sessionId: string): Promise<LightweightSession> {
    const sm = this.contracts.get('SessionManager');
    const [wallet, sessionKey, dailySpendLimit, dailyTxLimit, dailySpendUsed, dailyTxUsed, expiry, revoked] =
      await sm.getLightSession(sessionId);
    const targets: string[] = await sm.getSessionTargets(sessionId);
    return {
      sessionId,
      wallet,
      sessionKey,
      dailySpendLimit,
      dailyTxLimit,
      dailySpendUsed,
      dailyTxUsed,
      lastResetDay: 0,
      expiry: Number(expiry),
      revoked,
      allowedTargets: targets,
    };
  }

  /**
   * Creates a ZK-proof-gated standard session on-chain (proof verified by the Groth16 verifier).
   * The proof binds the session to a credential without revealing it; the 7 public signals must match maxValue/expiry or creation reverts.
   * @param params - Session id, wallet, session key, maxValue (wei, must equal publicSignals[2]), expiry (Unix seconds, must equal publicSignals[3]), and the Groth16 proof (a, b, c, 7 public signals).
   * @returns The mined transaction result.
   * @throws ValidationError on a bad address, zero session id, or past expiry; InvalidProof when the proof fails verification.
   * Maps to: contract SessionManager.createSession; event SessionCreated; CLI 'agentix session' create.
   * Side effects: creates an on-chain session that can spend up to maxValue until expiry or revocation.
   * Security: the proof is the entire authorization — a valid proof for someone else's credential must never be submitted here.
   */
  async createStandard(
    params: CreateStandardSessionParams,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(params.wallet, 'wallet');
    assertAddress(params.sessionKey, 'sessionKey');
    assertNonZero(params.sessionId, 'sessionId');
    assertInFuture(params.expiry, 'expiry');

    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.createSession(
        params.sessionId, params.wallet, params.sessionKey,
        params.maxValue, params.expiry,
        params.a, params.b, params.c, params.publicSignals
      ),
      { description: 'Create standard session ' + params.sessionId, ...options }
    );
  }

  /**
   * Creates a lightweight session (daily spend/tx caps + allowed targets, owner-signature authorized).
   * Cheaper than a standard session: no ZK proof, but the owner must sign the authorization.
   * @param params - Session id, session key, dailySpendLimit / dailyTxLimit, expiry (Unix seconds), allowed targets, and the optional owner signature.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad session key, zero session id, or past expiry; InvalidOwnerSignature when the signature does not check out.
   * Maps to: contract SessionManager.createLightweightSession; event LightSessionCreated; MCP tool agentix_session_create (dashboard-only).
   * Side effects: creates an on-chain session bounded by the daily limits until expiry or revocation.
   */
  async createLightweight(
    params: CreateLightSessionParams,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(params.sessionKey, 'sessionKey');
    assertNonZero(params.sessionId, 'sessionId');
    assertInFuture(params.expiry, 'expiry');

    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.createLightweightSession(
        params.sessionId, params.sessionKey,
        params.dailySpendLimit, params.dailyTxLimit,
        params.expiry, params.allowedTargets, params.ownerSignature
      ),
      { description: 'Create lightweight session ' + params.sessionId, ...options }
    );
  }

  /**
   * Revokes a standard session immediately; further uses fail validation.
   * Revocation is permanent and takes effect on-chain at once — there is no un-revoke.
   * @returns The mined transaction result.
   * @throws When the caller is not authorized to revoke this session.
   * Maps to: contract SessionManager.revokeSession; event SessionRevoked; MCP tool agentix_session_revoke (dashboard-only).
   */
  async revoke(sessionId: string, wallet: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(wallet, 'wallet');
    assertNonZero(sessionId, 'sessionId');
    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.revokeSession(sessionId, wallet),
      { description: 'Revoke session ' + sessionId, ...options }
    );
  }

  /**
   * Revokes a lightweight session immediately; further uses fail validation.
   * Revocation is permanent and takes effect on-chain at once — there is no un-revoke.
   * @returns The mined transaction result.
   * @throws When the caller is not authorized to revoke this session.
   * Maps to: contract SessionManager.revokeLightweightSession; event LightSessionRevoked; MCP tool agentix_session_revoke (dashboard-only).
   */
  async revokeLightweight(sessionId: string, wallet: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(wallet, 'wallet');
    assertNonZero(sessionId, 'sessionId');
    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.revokeLightweightSession(sessionId, wallet),
      { description: 'Revoke lightweight session ' + sessionId, ...options }
    );
  }

  /**
   * Lists the session ids ever created for a wallet (including expired and revoked ones).
   * @returns The session ids; an empty array when the wallet has none.
   * Maps to: contract SessionManager.getWalletSessions; MCP tool agentix_session_list.
   */
  async getWalletSessions(wallet: string): Promise<string[]> {
    assertAddress(wallet, 'wallet');
    const sm = this.contracts.get('SessionManager');
    const ids: string[] = await sm.getWalletSessions(wallet);
    return ids;
  }

  /**
   * Removes up to `limit` expired sessions from a wallet's on-chain session list.
   * Pruning only cleans storage — it does not revoke live sessions and changes no spend authority.
   * @param limit - Max sessions to prune in one call (default 10); larger values cost more gas.
   * @returns The mined transaction result.
   * Maps to: contract SessionManager.pruneExpiredSessions; MCP tool agentix_session_prune (dashboard-only).
   * Side effects: deletes expired session entries from on-chain storage.
   */
  async pruneExpired(wallet: string, limit = 10, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(wallet, 'wallet');
    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.pruneExpiredSessions(wallet, limit),
      { description: 'Prune expired sessions for ' + wallet, ...options }
    );
  }
}
