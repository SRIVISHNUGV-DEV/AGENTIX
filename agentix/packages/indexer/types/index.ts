export interface IndexerEvent {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  contractName: string;
  contractAddress: string;
  eventName: string;
  args: Record<string, unknown>;
  timestamp: number;
  confirmed: boolean;
}

export interface Checkpoint {
  contractName: string;
  lastBlock: number;
  processedAt: number;
}

export interface ReorgInfo {
  detectedAt: number;
  depth: number;
  affectedBlocks: number[];
  previousHash: string;
  newHash: string;
}

export interface IndexerConfig {
  confirmations: number;
  pollIntervalMs: number;
  maxBatchBlocks: number;
  jsonlDir: string;
  checkpointInterval: number;
}

export interface IndexerState {
  running: boolean;
  subscriptions: number;
  lastProcessedBlock: number;
  eventsIndexed: number;
  reorgsDetected: number;
  uptime: number;
}
