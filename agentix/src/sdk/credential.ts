import { CredentialRegistryInfo, TransactionResult } from './types';
import { assertAddress, assertNonZero } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class CredentialModule {
  /**
   * Wires the credential module to the contract registry, transaction sender, and local cache.
   * @returns A CredentialModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Reads the credential registry's live roots (active + revoked-secret).
   * NOTE: issuers and sessionManagers are always returned as empty arrays — this method does not enumerate them, so do not treat an empty list as "none registered".
   * @returns The registry info with the two current roots.
   * Maps to: contract CredentialRegistry.activeRoot / revokedSecretRoot; MCP tool agentix_cred_oracle.
   */
  async getInfo(): Promise<CredentialRegistryInfo> {
    const cr = this.contracts.get('CredentialRegistry');
    const [activeRoot, revokedSecretRoot] = await Promise.all([
      cr.activeRoot(),
      cr.revokedSecretRoot(),
    ]);
    return { activeRoot, revokedSecretRoot, issuers: [], sessionManagers: [] };
  }

  /**
   * Proposes a new active credential root. This does NOT update the root: it becomes effective only after the contract's 2-day timelock AND an acceptActiveRoot() call. Never report a propose as "root updated".
   * @param newRoot - Non-zero bytes32 Merkle root of the new active credential set.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a zero root; TimelockActive when a proposal is already pending.
   * Maps to: contract CredentialRegistry.proposeActiveRoot; CLI 'agentix cred' propose; event ActiveRootUpdated (only on accept).
   * Security: registry-owner only; a wrong root locks out every credential until corrected through the same timelock.
   */
  async proposeActiveRoot(newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(newRoot, 'newRoot');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.proposeActiveRoot(newRoot),
      { description: 'Propose active credential root (effective after 2-day timelock + accept)', ...options }
    );
  }

  /**
   * Completes a pending active-root proposal after the 2-day timelock.
   * This is the step that actually changes the live root; calling it early reverts.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the 2-day delay has not elapsed; revert when no proposal is pending.
   * Maps to: contract CredentialRegistry.acceptActiveRoot; CLI 'agentix cred' accept; event ActiveRootUpdated.
   * Security: registry-owner only.
   */
  async acceptActiveRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.acceptActiveRoot(),
      { description: 'Accept pending active credential root', ...options }
    );
  }

  /**
   * Cancels a pending active-root proposal before it is accepted.
   * After cancel the live root is unchanged and a new proposal can be made.
   * @returns The mined transaction result.
   * @throws Revert when no proposal is pending.
   * Maps to: contract CredentialRegistry.cancelActiveRoot.
   * Security: registry-owner only.
   */
  async cancelActiveRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.cancelActiveRoot(),
      { description: 'Cancel pending active credential root', ...options }
    );
  }

  /**
   * Proposes a new revoked-secret root. Same timelock rule as proposeActiveRoot: effective only after 2 days + acceptRevokedSecretRoot(). Never report a propose as "root updated".
   * @param newRoot - Non-zero bytes32 Merkle root of the new revoked-secret set.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a zero root; TimelockActive when a proposal is already pending.
   * Maps to: contract CredentialRegistry.proposeRevokedSecretRoot; event RevokedSecretRootUpdated (only on accept).
   * Security: registry-owner only; the revoked root decides which credentials count as revoked.
   */
  async proposeRevokedSecretRoot(newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(newRoot, 'newRoot');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.proposeRevokedSecretRoot(newRoot),
      { description: 'Propose revoked secret root (effective after 2-day timelock + accept)', ...options }
    );
  }

  /**
   * Completes a pending revoked-secret-root proposal after the 2-day timelock.
   * This is the step that actually changes the live revoked root; calling it early reverts.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the 2-day delay has not elapsed; revert when no proposal is pending.
   * Maps to: contract CredentialRegistry.acceptRevokedSecretRoot; event RevokedSecretRootUpdated.
   * Security: registry-owner only.
   */
  async acceptRevokedSecretRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.acceptRevokedSecretRoot(),
      { description: 'Accept pending revoked secret root', ...options }
    );
  }

  /**
   * Cancels a pending revoked-secret-root proposal before it is accepted.
   * After cancel the live revoked root is unchanged and a new proposal can be made.
   * @returns The mined transaction result.
   * @throws Revert when no proposal is pending.
   * Maps to: contract CredentialRegistry.cancelRevokedSecretRoot.
   * Security: registry-owner only.
   */
  async cancelRevokedSecretRoot(options?: TxOptions): Promise<TransactionResult> {
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.cancelRevokedSecretRoot(),
      { description: 'Cancel pending revoked secret root', ...options }
    );
  }

  /**
   * Reports whether a credential nullifier has already been spent.
   * A used nullifier means the credential was already presented — reusing it is a double-spend.
   * @returns True when the nullifier is spent, false otherwise.
   * Maps to: contract CredentialRegistry.isNullifierUsed; MCP tool agentix_cred_verify.
   */
  async isNullifierUsed(nullifier: string): Promise<boolean> {
    const cr = this.contracts.get('CredentialRegistry');
    return await cr.isNullifierUsed(nullifier);
  }

  /**
   * Reports whether an address is a registered credential issuer.
   * Only issuers can mark nullifiers used and anchor credentials; everyone else's issue attempts revert.
   * @returns True when the address is a registered issuer, false otherwise.
   * Maps to: contract CredentialRegistry.issuers.
   */
  async isIssuer(address: string): Promise<boolean> {
    const cr = this.contracts.get('CredentialRegistry');
    return await cr.issuers(address);
  }

}
