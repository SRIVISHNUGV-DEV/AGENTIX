import { CredentialRegistryInfo, TransactionResult } from './types';
import { assertAddress, assertNonZero } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class CredentialModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  async getInfo(): Promise<CredentialRegistryInfo> {
    const cr = this.contracts.get('CredentialRegistry');
    const [activeRoot, revokedSecretRoot] = await Promise.all([
      cr.activeRoot(),
      cr.revokedSecretRoot(),
    ]);
    return { activeRoot, revokedSecretRoot, issuers: [], sessionManagers: [] };
  }

  /**
   * Propose a new active credential root. This does NOT update the root:
   * the proposal becomes effective only after the contract's 2-day timelock
   * AND an acceptActiveRoot() call. Never report a propose as "root updated".
   */
  async proposeActiveRoot(newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(newRoot, 'newRoot');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.proposeActiveRoot(newRoot),
      { description: 'Propose active credential root (effective after 2-day timelock + accept)', ...options }
    );
  }

  /** Complete a pending active-root proposal after the 2-day timelock. Reverts before the delay (TimelockNotReady). */
  async acceptActiveRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.acceptActiveRoot(),
      { description: 'Accept pending active credential root', ...options }
    );
  }

  /** Cancel a pending active-root proposal. */
  async cancelActiveRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.cancelActiveRoot(),
      { description: 'Cancel pending active credential root', ...options }
    );
  }

  /**
   * Propose a new revoked-secret root. Same timelock rule as
   * proposeActiveRoot: effective only after 2 days + acceptRevokedSecretRoot().
   */
  async proposeRevokedSecretRoot(newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(newRoot, 'newRoot');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.proposeRevokedSecretRoot(newRoot),
      { description: 'Propose revoked secret root (effective after 2-day timelock + accept)', ...options }
    );
  }

  /** Complete a pending revoked-secret-root proposal after the 2-day timelock. */
  async acceptRevokedSecretRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.acceptRevokedSecretRoot(),
      { description: 'Accept pending revoked secret root', ...options }
    );
  }

  /** Cancel a pending revoked-secret-root proposal. */
  async cancelRevokedSecretRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.cancelRevokedSecretRoot(),
      { description: 'Cancel pending revoked secret root', ...options }
    );
  }

  async isNullifierUsed(nullifier: string): Promise<boolean> {
    const cr = this.contracts.get('CredentialRegistry');
    return await cr.isNullifierUsed(nullifier);
  }

  async isIssuer(address: string): Promise<boolean> {
    const cr = this.contracts.get('CredentialRegistry');
    return await cr.issuers(address);
  }

}
