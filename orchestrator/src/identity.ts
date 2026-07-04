import { IdentityInfo, TransactionResult } from './types.js';
import { assertAddress, assertNonZero } from './utils.js';
import { ContractRegistry } from './contracts.js';
import { TransactionManager, TxOptions } from './transaction.js';
import { Database } from './database.js';

export class IdentityModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  async get(identityId: bigint): Promise<IdentityInfo> {
    const id = this.contracts.get('AgentIdentity');
    const [wallet, active, metadataRoot, timestamps] = await Promise.all([
      id.walletOf(identityId),
      id.isActive(identityId),
      id.metadataOf(identityId),
      id.timestampsOf(identityId),
    ]);
    const info: IdentityInfo = {
      identityId,
      wallet,
      credentialId: 0n,
      metadataRoot,
      createdAt: Number(timestamps.createdAt),
      updatedAt: Number(timestamps.updatedAt),
      active,
    };
    this.db.saveIdentity(info);
    return info;
  }

  async getByWallet(wallet: string): Promise<IdentityInfo> {
    assertAddress(wallet, 'wallet');
    const id = this.contracts.get('AgentIdentity');
    const identityId: bigint = await id.identityOf(wallet);
    if (identityId === 0n) throw new Error('No identity found for wallet ' + wallet);
    return this.get(identityId);
  }

  async linkCredential(
    identityId: bigint,
    credentialId: bigint,
    options?: TxOptions
  ): Promise<TransactionResult> {
    const id = this.contracts.send('AgentIdentity');
    return this.tx.send(
      () => id.linkCredential(identityId, credentialId),
      { description: 'Link credential ' + credentialId + ' to identity ' + identityId, ...options }
    );
  }

  async updateMetadata(
    identityId: bigint,
    metadataRoot: string,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertNonZero(metadataRoot, 'metadataRoot');
    const id = this.contracts.send('AgentIdentity');
    return this.tx.send(
      () => id.updateMetadata(identityId, metadataRoot),
      { description: 'Update metadata for identity ' + identityId, ...options }
    );
  }

  async deactivate(identityId: bigint, options?: TxOptions): Promise<TransactionResult> {
    const id = this.contracts.send('AgentIdentity');
    return this.tx.send(
      () => id.deactivate(identityId),
      { description: 'Deactivate identity ' + identityId, ...options }
    );
  }

  async reactivate(identityId: bigint, options?: TxOptions): Promise<TransactionResult> {
    const id = this.contracts.send('AgentIdentity');
    return this.tx.send(
      () => id.reactivate(identityId),
      { description: 'Reactivate identity ' + identityId, ...options }
    );
  }
}
