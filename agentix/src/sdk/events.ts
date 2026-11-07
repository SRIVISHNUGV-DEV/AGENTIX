import { IndexedEvent } from './types';
import { ContractRegistry } from './contracts';
import { Database } from './database';

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
  /**
   * Wires the event indexer to the contract registry and the local event cache.
   * @returns An EventIndexer ready to query; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly db: Database,
  ) {}

  /**
   * Fetches every event a contract emitted in a block range and stores them in the local cache.
   * Use to backfill history after downtime; the range is inclusive and unbounded above by default (up to the latest block).
   * @param contractName - Registry name (e.g. 'SessionManager'); @param toBlock - defaults to the current latest block.
   * @returns The indexed events in chain order; an empty array when the range contains none.
   * @throws When the RPC query fails (the provider error propagates).
   * Maps to: event — every event listed in KNOWN_EVENTS (SessionCreated, WalletCreated, and the rest).
   * Side effects: writes the events to the local DB; a very wide range can return a large payload from the RPC.
   */
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

  /**
   * Returns the chain's current latest block number from the primary provider.
   * The high-water mark callers use as the `toBlock` for indexFrom.
   * @throws When the RPC call fails.
   * Maps to: internal — EventIndexer.indexFrom.
   */
  async getLatestBlock(): Promise<number> {
    return await this.contracts.provider.getBlockNumber();
  }

  /**
   * Maps a raw log's positional args to names using the KNOWN_EVENTS table for its event name.
   * Unknown events fall back to arg0, arg1, ... and bigints are stringified so the result stays JSON-safe.
   * @returns The named args object; an empty object when the log has no args.
   * Maps to: internal — EventIndexer.indexFrom.
   */
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
