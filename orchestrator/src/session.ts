import { ethers } from 'ethers';
import { StandardSession, LightweightSession, SessionType, CreateStandardSessionParams, CreateLightSessionParams, TransactionResult } from './types.js';
import { assertAddress, assertNonZero, assertInFuture } from './utils.js';
import { ContractRegistry } from './contracts.js';
import { TransactionManager, TxOptions } from './transaction.js';
import { Database } from './database.js';

export class SessionModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  async getType(sessionId: string): Promise<SessionType> {
    const sm = this.contracts.get('SessionManager');
    const t: number = await sm.getSessionType(sessionId);
    if (t === 0) return 'standard';
    if (t === 1) return 'lightweight';
    return 'none';
  }

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

  async revoke(sessionId: string, wallet: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(wallet, 'wallet');
    assertNonZero(sessionId, 'sessionId');
    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.revokeSession(sessionId, wallet),
      { description: 'Revoke session ' + sessionId, ...options }
    );
  }

  async revokeLightweight(sessionId: string, wallet: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(wallet, 'wallet');
    assertNonZero(sessionId, 'sessionId');
    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.revokeLightweightSession(sessionId, wallet),
      { description: 'Revoke lightweight session ' + sessionId, ...options }
    );
  }

  async getWalletSessions(wallet: string): Promise<string[]> {
    assertAddress(wallet, 'wallet');
    const sm = this.contracts.get('SessionManager');
    const ids: string[] = await sm.getWalletSessions(wallet);
    return ids;
  }

  async pruneExpired(wallet: string, limit = 10, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(wallet, 'wallet');
    const sm = this.contracts.send('SessionManager');
    return this.tx.send(
      () => sm.pruneExpiredSessions(wallet, limit),
      { description: 'Prune expired sessions for ' + wallet, ...options }
    );
  }
}
