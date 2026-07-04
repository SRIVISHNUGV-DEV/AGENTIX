import { IndexerEvent, IndexerConfig, IndexerState, Checkpoint } from './types';
import { EventStore } from './storage/event-store';
import { CheckpointStore } from './storage/checkpoint-store';
import { SubscriptionManager } from './subscription';
import { HistoricalReplayer } from './replay';
import { Deduplicator } from './dedup';
import { getEventBus } from '@agentix/eventbus';
import fs from 'fs';
import path from 'path';
import os from 'os';

let _instance: EventIndexer | null = null;

const DEFAULT_CONFIG: IndexerConfig = {
  confirmations: 3,
  pollIntervalMs: 15000,
  maxBatchBlocks: 1000,
  jsonlDir: path.join(os.homedir(), '.agentix', 'events'),
  checkpointInterval: 100,
};

export class EventIndexer {
  public readonly config: IndexerConfig;
  private subscriptionManager: SubscriptionManager;
  private eventStore: EventStore;
  private checkpointStore: CheckpointStore;
  private replayer: HistoricalReplayer;
  private deduplicator: Deduplicator;
  private state: IndexerState;

  constructor(config?: Partial<IndexerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deduplicator = new Deduplicator();
    this.eventStore = new EventStore(this.config.jsonlDir);
    this.checkpointStore = new CheckpointStore();
    this.subscriptionManager = new SubscriptionManager(this.eventStore, this.deduplicator, this.checkpointStore, this.config);
    this.replayer = new HistoricalReplayer(this.eventStore, this.checkpointStore, this.config, this.deduplicator);
    this.state = {
      running: false,
      subscriptions: 0,
      lastProcessedBlock: 0,
      eventsIndexed: 0,
      reorgsDetected: 0,
      uptime: 0,
    };
  }

  async start(provider?: unknown, contractAddresses?: Record<string, string>): Promise<void> {
    if (this.state.running) return;

    const dir = this.config.jsonlDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (provider && contractAddresses) {
      this.subscriptionManager.setProvider(provider);
      this.subscriptionManager.setContractAddresses(contractAddresses);
    }

    this.state.running = true;
    this.state.uptime = Date.now();

    if (provider && contractAddresses) {
      await this.subscriptionManager.start();
    }

    this.state.subscriptions = this.subscriptionManager.getSubscriptionCount();

    const eventBus = this._getEventBus();
    if (eventBus) {
      eventBus.emit({
        type: 'EventsIndexed' as any,
        fromBlock: 0,
        toBlock: 0,
        eventCount: 0,
      } as any);
    }
  }

  async stop(): Promise<void> {
    if (!this.state.running) return;
    await this.subscriptionManager.stop();
    this.state.running = false;
  }

  async replay(fromBlock: number, toBlock?: number, contractAddresses?: Record<string, string>): Promise<IndexerEvent[]> {
    return this.replayer.replay(fromBlock, toBlock, contractAddresses);
  }

  getEvents(filter?: {
    contractName?: string;
    eventName?: string;
    fromBlock?: number;
    toBlock?: number;
    limit?: number;
  }): IndexerEvent[] {
    return this.eventStore.query(filter);
  }

  getState(): IndexerState {
    return { ...this.state };
  }

  getCheckpoints(): Checkpoint[] {
    return this.checkpointStore.getAll();
  }

  static getInstance(config?: Partial<IndexerConfig>): EventIndexer {
    if (!_instance) {
      _instance = new EventIndexer(config);
    }
    return _instance;
  }

  static resetInstance(): void {
    if (_instance) {
      _instance.stop();
      _instance = null;
    }
  }

  private _getEventBus() {
    try {
      return getEventBus();
    } catch {
      return null;
    }
  }
}

export function getIndexer(config?: Partial<IndexerConfig>): EventIndexer {
  return EventIndexer.getInstance(config);
}

export * from './types';
