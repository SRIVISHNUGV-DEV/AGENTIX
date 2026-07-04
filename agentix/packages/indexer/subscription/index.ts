import { IndexerEvent, IndexerConfig } from '../types';
import { EventStore } from '../storage/event-store';
import { CheckpointStore } from '../storage/checkpoint-store';
import { Deduplicator } from '../dedup';

const KNOWN_EVENT_SIGNATURES: Record<string, string[]> = {
  AgentWalletFactory: ['WalletCreated', 'ImplementationProposed', 'ImplementationUpdated'],
  AgentWallet: ['WalletInitialized', 'ExecutionPerformed', 'BatchExecutionPerformed', 'OwnershipTransferStarted', 'OwnerChanged', 'UserOperationValidated', 'EntryPointDepositAdded', 'EntryPointWithdrawal'],
  SessionManager: ['SessionCreated', 'SessionUsed', 'SessionRevoked', 'LightSessionCreated', 'LightSessionUsed', 'LightSessionRevoked', 'DailyLimitsReset'],
  CredentialRegistry: ['ActiveRootUpdated', 'RevokedSecretRootUpdated'],
  OrganizationRegistry: ['OrganizationRegistered', 'OrganizationDeactivated', 'OrganizationReactivated'],
  OrganizationCredentialAnchor: ['RootUpdated', 'RevokedRootUpdated', 'EpochIncremented', 'VisibilityChanged', 'MetadataHashUpdated'],
  DelegationManager: ['DelegationRootUpdated', 'DelegationRevoked', 'DelegatorRevoked', 'DelegatorReAuthorized', 'ScopeRegistered'],
  CapabilityRegistry: ['CapabilityRegistered', 'CapabilityRevoked', 'GrantRootUpdated', 'GrantRevoked'],
  AgentIdentity: ['IdentityRegistered', 'WalletLinked', 'CredentialLinked', 'MetadataUpdated', 'IdentityDeactivated', 'IdentityReactivated'],
};

export class SubscriptionManager {
  private eventStore: EventStore;
  private deduplicator: Deduplicator;
  private checkpointStore: CheckpointStore;
  private config: IndexerConfig;
  private provider: unknown = null;
  private contractAddresses: Record<string, string> = {};
  private active: boolean = false;
  private listeners: Map<string, unknown> = new Map();
  private subscriptionCount: number = 0;

  constructor(
    eventStore: EventStore,
    deduplicator: Deduplicator,
    checkpointStore: CheckpointStore,
    config: IndexerConfig
  ) {
    this.eventStore = eventStore;
    this.deduplicator = deduplicator;
    this.checkpointStore = checkpointStore;
    this.config = config;
  }

  setProvider(provider: unknown): void {
    this.provider = provider;
  }

  setContractAddresses(addresses: Record<string, string>): void {
    this.contractAddresses = addresses;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
  }

  async stop(): Promise<void> {
    this.active = false;
    for (const [, listener] of this.listeners) {
      try {
        const ethers = require('ethers');
        if (listener instanceof ethers.Contract) {
          (listener as any).removeAllListeners();
        }
      } catch {}
    }
    this.listeners.clear();
    this.subscriptionCount = 0;
  }

  getSubscriptionCount(): number {
    return this.subscriptionCount;
  }

  async subscribeToContract(
    contractName: string,
    address: string,
    provider: unknown
  ): Promise<void> {
    if (!address || !provider) return;

    try {
      const ethers = require('ethers');
      const abi = this._getAbiForContract(contractName);
      if (!abi) return;

      const contract = new ethers.Contract(address, abi, provider);
      this.listeners.set(`${contractName}_${address}`, contract);

      const eventNames = KNOWN_EVENT_SIGNATURES[contractName] || [];
      for (const eventName of eventNames) {
        contract.on(eventName, (...args: unknown[]) => {
          const log = args[args.length - 1] as any;
          this._handleEvent(contractName, address, eventName, log);
        });
        this.subscriptionCount++;
      }
    } catch {
      // Provider may not support event subscriptions — fallback to polling
    }
  }

  private _handleEvent(
    contractName: string,
    contractAddress: string,
    eventName: string,
    log: any
  ): void {
    const event: IndexerEvent = {
      blockNumber: log.blockNumber || 0,
      transactionHash: log.transactionHash || '',
      logIndex: log.logIndex || log.index || 0,
      contractName,
      contractAddress,
      eventName,
      args: this._serializeArgs(log.args),
      timestamp: Math.floor(Date.now() / 1000),
      confirmed: false,
    };

    if (this.deduplicator.isDuplicate(event.transactionHash, event.logIndex)) return;

    this.eventStore.append(event);
    this.deduplicator.mark(event.transactionHash, event.logIndex);
  }

  private _serializeArgs(args: unknown): Record<string, unknown> {
    if (!args) return {};
    const result: Record<string, unknown> = {};

    if (Array.isArray(args)) {
      for (let i = 0; i < (args as unknown[]).length; i++) {
        result[`arg${i}`] = this._normalizeValue(args[i]);
      }
      return result;
    }

    if (typeof args === 'object') {
      for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
        result[key] = this._normalizeValue(value);
      }
    }

    return result;
  }

  private _normalizeValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map((v) => this._normalizeValue(v));
    return value;
  }

  private _getAbiForContract(contractName: string): unknown[] | null {
    try {
      const abiPath = `../../src/contracts/abis/${contractName}.json`;
      return require(abiPath);
    } catch {
      return null;
    }
  }
}
