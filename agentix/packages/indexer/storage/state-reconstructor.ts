import { IndexerEvent } from '../types';
import { EventStore } from './event-store';
import type { runQuery, runExecute } from '@agentix/database';

export class StateReconstructor {
  constructor(private eventStore: EventStore) {}

  async rebuildAll(): Promise<{ success: boolean; tablesRestored: number; errors: string[] }> {
    const errors: string[] = [];
    let tablesRestored = 0;

    try {
      let db: { query: Function; execute: Function } | null = null;
      try {
        const database = require('@agentix/database');
        db = { query: database.runQuery, execute: database.runExecute };
      } catch {
        errors.push('Database module not available for state reconstruction');
        return { success: false, tablesRestored: 0, errors };
      }

      if (!db) {
        return { success: false, tablesRestored: 0, errors };
      }

      const events = this.eventStore.queryInRange(0, 999999999);

      const rebuilders: Record<string, (event: IndexerEvent, db: { query: Function; execute: Function }) => void> = {
        WalletCreated: (event, db) => {
          db.execute(
            `INSERT OR REPLACE INTO wallets (wallet_address, owner_address, entry_point, created_at)
             VALUES (?, ?, ?, ?)`,
            [event.args.wallet, event.args.owner, event.args.entryPoint, Math.floor(Date.now() / 1000)]
          );
        },
        SessionCreated: (event, db) => {
          db.execute(
            `INSERT OR REPLACE INTO sessions (session_id, wallet_address, session_key, expiry, max_value, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [event.args.sessionId, event.args.wallet, event.args.sessionKey, event.args.expiry, event.args.maxValue?.toString() || '0', Math.floor(Date.now() / 1000)]
          );
        },
        SessionRevoked: (event, db) => {
          db.execute(
            `UPDATE sessions SET revoked = 1, revoked_at = ? WHERE session_id = ?`,
            [Math.floor(Date.now() / 1000), event.args.sessionId]
          );
        },
        OrganizationRegistered: (event, db) => {
          db.execute(
            `INSERT OR REPLACE INTO organizations (id, name, owner_address, credential_anchor, active, created_at)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [event.args.organizationId, event.args.name || '', event.args.owner, event.args.credentialAnchor, Math.floor(Date.now() / 1000)]
          );
        },
        OrganizationDeactivated: (event, db) => {
          db.execute(
            `UPDATE organizations SET active = 0 WHERE id = ?`,
            [event.args.organizationId]
          );
        },
        CapabilityRegistered: (event, db) => {
          db.execute(
            `INSERT OR REPLACE INTO capabilities (capability_id, organization_id, name, hash, active, created_at)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [event.args.capabilityId, '', event.args.actionHash || '', event.args.actionHash || '', Math.floor(Date.now() / 1000)]
          );
        },
        DelegationRootUpdated: (event, db) => {
          db.execute(
            `INSERT OR REPLACE INTO delegations (delegation_id, organization_id, delegator, delegatee, scope, expiry, active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            [event.args.delegator + '_' + event.args.scopeHash, '', event.args.delegator, '', event.args.scopeHash?.toString() || '', event.args.expiresAt, Math.floor(Date.now() / 1000)]
          );
        },
        IdentityRegistered: (event, db) => {
          db.execute(
            `INSERT OR REPLACE INTO identities (identity_id, wallet_address, credential_id, active, created_at)
             VALUES (?, ?, 0, 1, ?)`,
            [event.args.identityId, event.args.wallet, Math.floor(Date.now() / 1000)]
          );
        },
      };

      for (const event of events) {
        const rebuilder = rebuilders[event.eventName];
        if (rebuilder && db) {
          try {
            rebuilder(event, db);
          } catch (err: unknown) {
            errors.push(`Error rebuilding ${event.eventName}: ${(err as Error).message}`);
          }
        }
      }

      tablesRestored = Object.keys(rebuilders).length;

      return {
        success: errors.length === 0,
        tablesRestored,
        errors,
      };
    } catch (err: unknown) {
      return {
        success: false,
        tablesRestored: 0,
        errors: [(err as Error).message],
      };
    }
  }
}
