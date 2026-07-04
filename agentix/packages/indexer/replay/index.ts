import { IndexerEvent, IndexerConfig } from '../types';
import { EventStore } from '../storage/event-store';
import { CheckpointStore } from '../storage/checkpoint-store';
import { Deduplicator } from '../dedup';

export class HistoricalReplayer {
  private eventStore: EventStore;
  private checkpointStore: CheckpointStore;
  private config: IndexerConfig;
  private deduplicator: Deduplicator;

  constructor(
    eventStore: EventStore,
    checkpointStore: CheckpointStore,
    config: IndexerConfig,
    deduplicator: Deduplicator
  ) {
    this.eventStore = eventStore;
    this.checkpointStore = checkpointStore;
    this.config = config;
    this.deduplicator = deduplicator;
  }

  async replay(
    fromBlock: number,
    toBlock?: number,
    contractAddresses?: Record<string, string>
  ): Promise<IndexerEvent[]> {
    const allEvents: IndexerEvent[] = [];

    if (!contractAddresses || Object.keys(contractAddresses).length === 0) {
      return allEvents;
    }

    let provider: any;
    try {
      const { getProvider } = require('../../core/provider');
      provider = getProvider();
    } catch {
      return allEvents;
    }

    if (!provider) return allEvents;

    const currentBlock = toBlock || await provider.getBlockNumber();
    const maxBatch = this.config.maxBatchBlocks;

    for (let start = fromBlock; start <= currentBlock; start += maxBatch) {
      const end = Math.min(start + maxBatch - 1, currentBlock);

      for (const [contractName, address] of Object.entries(contractAddresses)) {
        if (!address) continue;

        const events = await this._fetchEvents(contractName, address, start, end, provider);
        for (const event of events) {
          if (this.deduplicator.isDuplicate(event.transactionHash, event.logIndex)) continue;

          allEvents.push(event);
          this.eventStore.append(event);
          this.deduplicator.mark(event.transactionHash, event.logIndex);
        }

        this.checkpointStore.set(contractName, end);
      }
    }

    return allEvents;
  }

  private async _fetchEvents(
    contractName: string,
    address: string,
    fromBlock: number,
    toBlock: number,
    provider: any
  ): Promise<IndexerEvent[]> {
    const events: IndexerEvent[] = [];

    try {
      const ethers = require('ethers');
      const abi = this._getAbi(contractName);
      if (!abi) return events;

      const contract = new ethers.Contract(address, abi, provider);
      const logs = await contract.queryFilter('*', fromBlock, toBlock);

      for (const log of logs) {
        let eventName = 'unknown';
        let args: Record<string, unknown> = {};

        try {
          const parsed = contract.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          if (parsed) {
            eventName = parsed.name;
            args = this._normalizeArgs(parsed.args);
          }
        } catch {}

        events.push({
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.index,
          contractName,
          contractAddress: address,
          eventName,
          args,
          timestamp: Math.floor(Date.now() / 1000),
          confirmed: true,
        });
      }
    } catch {}

    return events;
  }

  private _getAbi(contractName: string): unknown[] | null {
    try {
      const abiPath = `../../src/contracts/abis/${contractName}.json`;
      return require(abiPath);
    } catch {
      return null;
    }
  }

  private _normalizeArgs(args: any): Record<string, unknown> {
    if (!args) return {};
    const result: Record<string, unknown> = {};
    if (typeof args.toObject === 'function') {
      const obj = args.toObject();
      for (const [key, value] of Object.entries(obj)) {
        result[key] = typeof value === 'bigint' ? value.toString() : value;
      }
    } else if (Array.isArray(args)) {
      for (let i = 0; i < args.length; i++) {
        result[`arg${i}`] = typeof args[i] === 'bigint' ? args[i].toString() : args[i];
      }
    }
    return result;
  }
}
