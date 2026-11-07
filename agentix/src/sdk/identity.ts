import { IdentityInfo, TransactionResult } from './types';
import { assertAddress, assertNonZero } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class IdentityModule {
  /**
   * Wires the identity module to the contract registry, transaction sender, and local cache.
   * @returns An IdentityModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Reads one on-chain identity (wallet, credential, metadata root, timestamps, active flag) and caches it.
   * The four reads run in parallel; the credential id comes from the contract's credentialOf, not a default.
   * @param identityId - The numeric id minted at registration; 0n does not exist.
   * @returns The IdentityInfo as stored on-chain.
   * @throws When the id has no identity (the view calls return zeroed data or revert).
   * Maps to: contract AgentIdentity.walletOf / isActive / metadataOf / timestampsOf / credentialOf; MCP tool agentix_identity_get_by_id.
   * Side effects: overwrites the cached identity record.
   */
  async get(identityId: bigint): Promise<IdentityInfo> {
    const id = this.contracts.get('AgentIdentity');
    const [wallet, active, metadataRoot, timestamps, credentialId] = await Promise.all([
      id.walletOf(identityId),
      id.isActive(identityId),
      id.metadataOf(identityId),
      id.timestampsOf(identityId),
      id.credentialOf(identityId),
    ]);
    const info: IdentityInfo = {
      identityId,
      wallet,
      credentialId,
      metadataRoot,
      createdAt: Number(timestamps.createdAt),
      updatedAt: Number(timestamps.updatedAt),
      active,
    };
    this.db.saveIdentity(info);
    return info;
  }

  /**
   * Reads the identity registered for a wallet address.
   * The lookup is wallet -> id -> full record, so a wallet with no identity fails fast here.
   * @returns The IdentityInfo for the wallet's identity.
   * @throws When the wallet has no identity (identity id 0).
   * Maps to: contract AgentIdentity.identityOf; MCP tool agentix_identity_get.
   */
  async getByWallet(wallet: string): Promise<IdentityInfo> {
    assertAddress(wallet, 'wallet');
    const id = this.contracts.get('AgentIdentity');
    const identityId: bigint = await id.identityOf(wallet);
    if (identityId === 0n) throw new Error('No identity found for wallet ' + wallet);
    return this.get(identityId);
  }

  /**
   * Links a credential id to an identity on-chain.
   * The credential must already exist; linking only records the association, it does not issue anything.
   * @returns The mined transaction result.
   * @throws When the identity or credential does not exist, or the caller is not authorized.
   * Maps to: contract AgentIdentity.linkCredential; event CredentialLinked.
   */
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

  /**
   * Replaces an identity's metadata root (a hash committing to off-chain metadata).
   * Only the root goes on-chain; the metadata itself stays off-chain, so a stale root means stale metadata.
   * @param metadataRoot - Non-zero bytes32 root of the new metadata.
   * @returns The mined transaction result.
   * @throws ValidationError on a zero root; contract errors when the caller is not authorized.
   * Maps to: contract AgentIdentity.updateMetadata; event MetadataUpdated.
   */
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

  /**
   * Deactivates an identity so it can no longer be used until reactivated.
   * Deactivation is reversible via reactivate; it does not delete the identity or its wallet.
   * @returns The mined transaction result.
   * @throws When the caller is not authorized or the identity is already inactive.
   * Maps to: contract AgentIdentity.deactivate; event IdentityDeactivated.
   */
  async deactivate(identityId: bigint, options?: TxOptions): Promise<TransactionResult> {
    const id = this.contracts.send('AgentIdentity');
    return this.tx.send(
      () => id.deactivate(identityId),
      { description: 'Deactivate identity ' + identityId, ...options }
    );
  }

  /**
   * Reactivates a deactivated identity.
   * Only meaningful after deactivate; reactivating an already-active identity reverts.
   * @returns The mined transaction result.
   * @throws When the caller is not authorized or the identity is already active.
   * Maps to: contract AgentIdentity.reactivate; event IdentityReactivated.
   */
  async reactivate(identityId: bigint, options?: TxOptions): Promise<TransactionResult> {
    const id = this.contracts.send('AgentIdentity');
    return this.tx.send(
      () => id.reactivate(identityId),
      { description: 'Reactivate identity ' + identityId, ...options }
    );
  }
}
