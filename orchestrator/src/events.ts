import { IndexedEvent } from './types.js';
import { ContractRegistry } from './contracts.js';
import { Database } from './database.js';

const KNOWN_EVENTS: Record<string, string[]> = {
  WalletCreated: ['wallet', 'owner', 'salt', 'entryPoint'],
  IdentityRegistered: ['identityId', 'wallet'],
  MetadataUpdated: ['identityId', 'metadataRoot'],
  IdentityDeactivated: ['identityId'],
  IdentityReactivated: ['identityId'],
  CredentialLinked: ['identityId', 'credentialId'],
  WalletLinked: ['identityId', 'wallet'],
  SessionCreated: ['sessionId', 'wallet', 'sessionKey', 'expiry', 'maxValue', 'nullifier'],
  SessionRevoked: ['sessionId'],
  SessionUsed: ['sessionId', 'value', 'totalUsed'],
  LightSessionCreated: ['sessionId', 'wallet', 'sessionKey', 'dailySpendLimit', 'dailyTxLimit', 'expiry'],
  LightSessionRevoked: ['sessionId'],
  LightSessionUsed: ['sessionId', 'value', 'newDailySpend'],
  DailyLimitsReset: ['sessionId', 'newDay'],
  ExecutionPerformed: ['caller', 'target', 'value', 'dataHash'],
  BatchExecutionPerformed: ['caller', 'callCount', 'totalValue'],
  OwnershipTransferStarted: ['previousOwner', 'newOwner'],
  OwnerChanged: ['oldOwner', 'newOwner'],
  ActiveRootUpdated: ['newRoot'],
  RevokedSecretRootUpdated: ['newRoot'],
  OrganizationRegistered: ['organizationId', 'name', 'owner', 'credentialAnchor'],
  OrganizationDeactivated: ['organizationId'],
  OrganizationReactivated: ['organizationId'],
  CredentialAnchorProposed: ['organizationId', 'previousAnchor', 'newAnchor', 'activationTime'],
  CredentialAnchorUpdated: ['organizationId', 'oldAnchor', 'newAnchor'],
  DelegationRootUpdated: ['delegator', 'scopeHash', 'newRoot', 'expiresAt'],
  DelegationRevoked: ['delegationLeafHash', 'delegator'],
  DelegatorReAuthorized: ['delegator'],
  DelegatorRevoked: ['delegator'],
  ScopeRegistered: ['action', 'scopeHash'],
  CapabilityRegistered: ['capabilityId', 'actionHash', 'registrar'],
  CapabilityRevoked: ['capabilityId'],
  GrantRootUpdated: ['grantor', 'grantee', 'capabilityId', 'newRoot'],
  GrantRevoked: ['grantLeafHash'],
  RootUpdated: ['organizationId', 'oldRoot', 'newRoot'],
  RevokedRootUpdated: ['organizationId', 'oldRoot', 'newRoot'],
  EpochIncremented: ['organizationId', 'newEpoch'],
  MetadataHashUpdated: ['organizationId', 'newMetadataHash'],
  VisibilityChanged: ['organizationId', 'newVisibility'],
};

export class EventIndexer {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly db: Database,
  ) {}

  async indexFrom(contractName: string, fromBlock: number, toBlock?: number): Promise<IndexedEvent[]> {
    const contract = this.contracts.get(contractName as any);
    const to = toBlock || await this.contracts.provider.getBlockNumber();
    const events = await (contract as any).queryFilter('*', fromBlock, to);

    const indexed: IndexedEvent[] = events.map((e: any) => ({
      id: e.transactionHash + '-' + e.logIndex,
      blockNumber: e.blockNumber,
      transactionHash: e.transactionHash,
      logIndex: e.logIndex,
      eventName: e.eventName || e.topics?.[0] || 'unknown',
      contractAddress: e.address,
      args: this._parseEventArgs(e),
      timestamp: undefined,
    }));

    this.db.saveEvents(indexed);
    return indexed;
  }

  async getLatestBlock(): Promise<number> {
    return await this.contracts.provider.getBlockNumber();
  }

  private _parseEventArgs(event: any): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    if (!event.args) return args;

    const eventName = event.eventName || '';
    const paramNames = KNOWN_EVENTS[eventName] || [];

    for (let i = 0; i < event.args.length; i++) {
      const name = paramNames[i] || 'arg' + i;
      const val = event.args[i];
      args[name] = typeof val === 'bigint' ? val.toString() : val;
    }

    return args;
  }
}
