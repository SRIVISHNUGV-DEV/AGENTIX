import { OrganizationInfo, CredentialAnchorInfo } from './types';
import { assertAddress } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager } from './transaction';
import { Database } from './database';

export class OrganizationModule {
  /**
   * Wires the organization module to the contract registry, transaction sender, and local cache.
   * @returns An OrganizationModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Reads one organization's on-chain record and caches it.
   * @param organizationId - Bytes32 id assigned at registration.
   * @returns The OrganizationInfo as stored on-chain.
   * @throws When the id has no organization (the view call reverts or returns zeroed data).
   * Maps to: contract OrganizationRegistry.getOrganization; MCP tool agentix_org_get.
   * Side effects: overwrites the cached organization record.
   */
  async get(organizationId: string): Promise<OrganizationInfo> {
    const org = this.contracts.get('OrganizationRegistry');
    const o = await org.getOrganization(organizationId);
    const info: OrganizationInfo = {
      organizationId: o.organizationId,
      name: o.name,
      owner: o.owner,
      credentialAnchor: o.credentialAnchor,
      active: o.active,
      createdAt: Number(o.createdAt),
    };
    this.db.saveOrganization(info);
    return info;
  }

  /**
   * Reads an organization's credential anchor contract (current/revoked roots, epoch, metadata hash, visibility) and caches it.
   * The anchor is the per-org source of truth for which credential root is live — the global registry root is not per-org.
   * @param anchorAddress - The deployed OrganizationCredentialAnchor contract address.
   * @returns The anchor state, with visibility mapped from the on-chain uint8 (1 = PUBLIC, anything else = PRIVATE).
   * @throws When the address is not an anchor contract (the view calls revert).
   * Maps to: contract OrganizationCredentialAnchor.currentRoot / revokedRoot / currentEpoch / metadataHash / visibility; MCP tool agentix_org_get_anchor.
   * Side effects: overwrites the cached anchor record.
   */
  async getAnchorInfo(anchorAddress: string): Promise<CredentialAnchorInfo> {
    assertAddress(anchorAddress, 'anchor');
    const anchor = this.contracts.get('OrganizationCredentialAnchor', anchorAddress);
    const [orgId, currentRoot, revokedRoot, epoch, metadataHash, visibility] = await Promise.all([
      anchor.organizationId(),
      anchor.currentRoot(),
      anchor.revokedRoot(),
      anchor.currentEpoch(),
      anchor.metadataHash(),
      anchor.visibility(),
    ]);

    const info: CredentialAnchorInfo = {
      organizationId: orgId,
      currentRoot,
      revokedRoot,
      currentEpoch: Number(epoch),
      metadataHash,
      visibility: visibility === 1 ? 'PUBLIC' : 'PRIVATE',
    };
    this.db.saveAnchor(info);
    return info;
  }

  /**
   * Lists the organization ids owned by an address.
   * @returns The ids as bytes32 hex strings; an empty array when the owner has none.
   * Maps to: contract OrganizationRegistry.getOwnerOrganizations.
   */
  async getByOwner(owner: string): Promise<string[]> {
    assertAddress(owner, 'owner');
    const org = this.contracts.get('OrganizationRegistry');
    return await org.getOwnerOrganizations(owner);
  }
}
