import { ethers } from 'ethers';
import { TransactionResult, OrganizationInfo } from '../types.js';
import { assertAddress, assertNonZero } from '../utils.js';
import { ContractRegistry } from '../contracts.js';
import { TransactionManager, TxOptions } from '../transaction.js';
import { Database } from '../database.js';

/**
 * OwnerModule — protocol admin operations that require the contract owner's signer.
 *
 * These functions call `onlyOwner`- or `onlyRole(DEFAULT_ADMIN_ROLE)`-guarded
 * contract methods. They won't work unless the connected signer is the protocol
 * admin (the `owner()` address of each contract).
 *
 * Separated from the public-facing modules so external users don't see admin
 * complexity they shouldn't need.
 */
export class OwnerModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  // ── Capability Registry ──

  async registerCapability(
    capabilityId: string, action: string, expiresAt: number,
    options?: TxOptions,
  ): Promise<TransactionResult> {
    assertNonZero(capabilityId, 'capabilityId');
    const cap = this.contracts.send('CapabilityRegistry');
    return this.tx.send(
      () => cap.registerCapability(capabilityId, action, expiresAt),
      { description: 'Register capability ' + capabilityId, ...options },
    );
  }

  // ── Credential Registry ──

  async addIssuer(address: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(address, 'issuer');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.addIssuer(address),
      { description: 'Add issuer ' + address, ...options },
    );
  }

  async removeIssuer(address: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(address, 'issuer');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.removeIssuer(address),
      { description: 'Remove issuer ' + address, ...options },
    );
  }

  async setSessionManager(address: string, allowed: boolean, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(address, 'sessionManager');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.setSessionManager(address, allowed),
      { description: (allowed ? 'Set' : 'Remove') + ' session manager ' + address, ...options },
    );
  }

  // ── Delegation Manager ──

  async registerScope(action: string, options?: TxOptions): Promise<TransactionResult> {
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.registerScope(action),
      { description: 'Register delegation scope ' + action, ...options },
    );
  }

  // ── Organization Registry + Credential Anchor ──

  async createOrganization(
    organizationId: string, name: string, owner: string,
    options?: TxOptions,
  ): Promise<OrganizationInfo> {
    assertNonZero(organizationId, 'organizationId');
    assertAddress(owner, 'owner');

    const org = this.contracts.send('OrganizationRegistry');
    await this.tx.send(
      () => org.registerOrganization(organizationId, name, owner),
      { description: 'Create organization ' + name, ...options },
    );

    const anchorAddr: string = await this.contracts.get('OrganizationRegistry').getCredentialAnchor(organizationId);

    const info: OrganizationInfo = {
      organizationId, name, owner,
      credentialAnchor: anchorAddr,
      active: true,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.db.saveOrganization(info);
    return info;
  }

  async updateAnchorRoot(anchorAddress: string, newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    assertNonZero(newRoot, 'newRoot');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.updateRoot(newRoot),
      { description: 'Update anchor root', ...options },
    );
  }

  async updateAnchorRevokedRoot(anchorAddress: string, newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    assertNonZero(newRoot, 'newRoot');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.updateRevokedRoot(newRoot),
      { description: 'Update anchor revoked root', ...options },
    );
  }

  async incrementAnchorEpoch(anchorAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.incrementEpoch(),
      { description: 'Increment anchor epoch', ...options },
    );
  }
}
