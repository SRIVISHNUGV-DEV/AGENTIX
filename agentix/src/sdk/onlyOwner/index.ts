import { ethers } from 'ethers';
import { TransactionResult, OrganizationInfo } from '../types';
import { assertAddress, assertNonZero } from '../utils';
import { ContractRegistry } from '../contracts';
import { TransactionManager, TxOptions } from '../transaction';
import { Database } from '../database';

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
  /**
   * Wires the owner (protocol-admin) module to the contract registry, transaction sender, and local cache.
   * Every method here calls an onlyOwner / onlyRole-guarded contract function — the connected signer must be the protocol admin or the calls revert.
   * @returns An OwnerModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor (agentix.owner).
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  // ── Capability Registry ──

  /**
   * Registers a new capability id with its human-readable action string and expiry.
   * Registration only names the capability — grants are issued separately via grant roots.
   * @param expiresAt - Unix seconds after which the capability lapses (0 means never, per the contract).
   * @returns The mined transaction result.
   * @throws ValidationError on a zero capability id.
   * Maps to: contract CapabilityRegistry.registerCapability; event CapabilityRegistered; CLI 'agentix capability' register.
   * Security: owner-only; a registered capability is the root of trust for all its grants.
   */
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

  /**
   * Authorizes an address to issue credentials.
   * Only registered issuers can anchor credentials and mark nullifiers used.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad address.
   * Maps to: contract CredentialRegistry.addIssuer.
   * Security: owner-only; an added issuer can create credentials that verify against the live root.
   */
  async addIssuer(address: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(address, 'issuer');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.addIssuer(address),
      { description: 'Add issuer ' + address, ...options },
    );
  }

  /**
   * Revokes an address's issuer authorization.
   * Existing credentials it issued stay valid — removal only blocks future issuance.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad address.
   * Maps to: contract CredentialRegistry.removeIssuer.
   * Security: owner-only.
   */
  async removeIssuer(address: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(address, 'issuer');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.removeIssuer(address),
      { description: 'Remove issuer ' + address, ...options },
    );
  }

  /**
   * Allows or disallows a session-manager contract in the credential registry.
   * Only allowed session managers may mark nullifiers used when creating sessions.
   * @param allowed - True to authorize, false to revoke.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad address.
   * Maps to: contract CredentialRegistry.setSessionManager.
   * Security: owner-only; authorizing a malicious manager lets it spend nullifiers.
   */
  async setSessionManager(address: string, allowed: boolean, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(address, 'sessionManager');
    const cr = this.contracts.send('CredentialRegistry');
    return this.tx.send(
      () => cr.setSessionManager(address, allowed),
      { description: (allowed ? 'Set' : 'Remove') + ' session manager ' + address, ...options },
    );
  }

  // ── Delegation Manager ──

  /**
   * Registers a delegation scope action string (its keccak hash becomes the scopeHash).
   * Delegations can only reference registered scopes.
   * @returns The mined transaction result.
   * Maps to: contract DelegationManager.registerScope; event ScopeRegistered.
   * Security: owner-only (DelegationManager-gated).
   */
  async registerScope(action: string, options?: TxOptions): Promise<TransactionResult> {
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.registerScope(action),
      { description: 'Register delegation scope ' + action, ...options },
    );
  }

  // ── Organization Registry + Credential Anchor ──

  /**
   * Registers an organization on-chain and returns its record with the deployed anchor address.
   * The anchor address is read back from the registry after registration — it is assigned by the contract, not chosen here.
   * @param organizationId - Non-zero bytes32 id; @param owner - Address that will own the organization.
   * @returns The OrganizationInfo, with createdAt set from the local clock (not the chain timestamp).
   * @throws ValidationError on a zero id or bad owner address; contract errors when the id already exists.
   * Maps to: contract OrganizationRegistry.registerOrganization / getCredentialAnchor; event OrganizationRegistered; CLI 'agentix org' create.
   * Side effects: deploys/registers an anchor contract and caches the org locally.
   */
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

  /**
   * Proposes a new anchor root. This does NOT update the root: it becomes effective only after the contract's 2-day timelock AND an acceptAnchorRoot() call. Never report a propose as "root updated".
   * @param newRoot - Non-zero bytes32 Merkle root of the org's new active credential set.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a bad anchor address or zero root.
   * Maps to: contract OrganizationCredentialAnchor.proposeRoot.
   * Security: anchor-owner only; a wrong root locks out the org's credentials until corrected.
   */
  async proposeAnchorRoot(anchorAddress: string, newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    assertNonZero(newRoot, 'newRoot');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.proposeRoot(newRoot),
      { description: 'Propose anchor root (effective after 2-day timelock + accept)', ...options },
    );
  }

  /**
   * Completes a pending anchor-root proposal after the 2-day timelock. Reverts before the delay (TimelockNotReady).
   * This is the step that actually changes the org's live credential root.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the delay has not elapsed; revert when no proposal is pending.
   * Maps to: contract OrganizationCredentialAnchor.acceptRoot; event RootUpdated.
   * Security: anchor-owner only.
   */
  async acceptAnchorRoot(anchorAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.acceptRoot(),
      { description: 'Accept pending anchor root', ...options },
    );
  }

  /**
   * Cancels a pending anchor-root proposal before it is accepted.
   * After cancel the live root is unchanged and a new proposal can be made.
   * @returns The mined transaction result.
   * @throws Revert when no proposal is pending.
   * Maps to: contract OrganizationCredentialAnchor.cancelRoot.
   * Security: anchor-owner only.
   */
  async cancelAnchorRoot(anchorAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.cancelRoot(),
      { description: 'Cancel pending anchor root', ...options },
    );
  }

  /**
   * Proposes a new anchor revoked root (same 2-day timelock + accept rule).
   * Propose only stages the change; the revoked root is unchanged until acceptAnchorRevokedRoot.
   * @param newRoot - Non-zero bytes32 Merkle root of the org's new revoked set.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a bad anchor address or zero root.
   * Maps to: contract OrganizationCredentialAnchor.proposeRevokedRoot.
   * Security: anchor-owner only.
   */
  async proposeAnchorRevokedRoot(anchorAddress: string, newRoot: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    assertNonZero(newRoot, 'newRoot');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.proposeRevokedRoot(newRoot),
      { description: 'Propose anchor revoked root (effective after 2-day timelock + accept)', ...options },
    );
  }

  /**
   * Completes a pending anchor revoked-root proposal after the 2-day timelock.
   * This is the step that actually changes the org's live revoked root.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the delay has not elapsed; revert when no proposal is pending.
   * Maps to: contract OrganizationCredentialAnchor.acceptRevokedRoot; event RevokedRootUpdated.
   * Security: anchor-owner only.
   */
  async acceptAnchorRevokedRoot(anchorAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.acceptRevokedRoot(),
      { description: 'Accept pending anchor revoked root', ...options },
    );
  }

  /**
   * Cancels a pending anchor revoked-root proposal before it is accepted.
   * After cancel the live revoked root is unchanged and a new proposal can be made.
   * @returns The mined transaction result.
   * @throws Revert when no proposal is pending.
   * Maps to: contract OrganizationCredentialAnchor.cancelRevokedRoot.
   * Security: anchor-owner only.
   */
  async cancelAnchorRevokedRoot(anchorAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.cancelRevokedRoot(),
      { description: 'Cancel pending anchor revoked root', ...options },
    );
  }

  /**
   * Bumps an anchor's epoch, invalidating proofs tied to the old epoch.
   * Use when the credential set changed out-of-band and old proofs must stop verifying.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad anchor address.
   * Maps to: contract OrganizationCredentialAnchor.incrementEpoch; event EpochIncremented.
   * Security: anchor-owner only.
   */
  async incrementAnchorEpoch(anchorAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.send('OrganizationCredentialAnchor', anchorAddress);
    return this.tx.send(
      () => anchor.incrementEpoch(),
      { description: 'Increment anchor epoch', ...options },
    );
  }
}
