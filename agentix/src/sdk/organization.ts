import { OrganizationInfo, CredentialAnchorInfo } from './types';
import { assertAddress } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager } from './transaction';
import { Database } from './database';

export class OrganizationModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

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

  async getByOwner(owner: string): Promise<string[]> {
    assertAddress(owner, 'owner');
    const org = this.contracts.get('OrganizationRegistry');
    return await org.getOwnerOrganizations(owner);
  }
}
