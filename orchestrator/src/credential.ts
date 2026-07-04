import { CredentialRegistryInfo, TransactionResult } from './types.js';
import { assertAddress, assertNonZero } from './utils.js';
import { ContractRegistry } from './contracts.js';
import { TransactionManager, TxOptions } from './transaction.js';
import { Database } from './database.js';

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

  async updateActiveRoot(newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(newRoot, 'newRoot');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.updateActiveRoot(newRoot),
      { description: 'Update active credential root', ...options }
    );
  }

  async updateRevokedSecretRoot(newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(newRoot, 'newRoot');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.updateRevokedSecretRoot(newRoot),
      { description: 'Update revoked secret root', ...options }
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
