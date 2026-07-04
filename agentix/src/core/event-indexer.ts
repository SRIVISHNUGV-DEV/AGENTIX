import { ethers } from "ethers";
import { getProvider } from "./provider";
import { loadConfig } from "./config";
import { getAbiByName } from "../contracts";
import { runQuery, runSingle, runExecute } from "./database";
import { logger } from "./logger";

const BLOCK_CHUNK = 2000;
const POLL_INTERVAL_MS = 30_000;

// Business-relevant events to index (skip OZ admin events like Paused, Unpaused, Initialized, Upgraded, RoleGranted, etc.)
const INDEXED_EVENT_NAMES: Set<string> = new Set([
  // AgentWalletFactory
  "WalletCreated",
  // SessionManager
  "SessionCreated", "SessionUsed", "SessionRevoked",
  "LightSessionCreated", "LightSessionUsed", "LightSessionRevoked",
  // CredentialRegistry
  "ActiveRootUpdated", "RevokedSecretRootUpdated",
  // AgentIdentity
  "IdentityRegistered", "WalletLinked", "CredentialLinked",
  "MetadataUpdated", "IdentityDeactivated", "IdentityReactivated",
  // CapabilityRegistry
  "CapabilityRegistered", "CapabilityRevoked",
  "GrantRootUpdated", "GrantRevoked",
  // DelegationManager
  "DelegationRootUpdated", "DelegationRevoked",
  "DelegatorRevoked", "DelegatorReAuthorized", "ScopeRegistered",
  // OrganizationRegistry
  "OrganizationRegistered", "OrganizationDeactivated", "OrganizationReactivated",
  "CredentialAnchorUpdated",
  // AgentWallet (clone events — indexed from factory-created wallets)
  "WalletInitialized", "ExecutionPerformed", "BatchExecutionPerformed",
  "UserOperationValidated", "EntryPointDepositAdded",
]);

interface ContractEntry {
  name: string;
  address: string;
  iface: ethers.Interface;
}

function getIndexedContracts(): ContractEntry[] {
  const config = loadConfig();
  const entries: ContractEntry[] = [];

  const contractMap: Record<string, string> = {
    AgentWalletFactory: config.contracts.agentWalletFactory,
    SessionManager: config.contracts.sessionManager,
    CredentialRegistry: config.contracts.credentialRegistry,
    AgentIdentity: config.contracts.agentIdentity,
    CapabilityRegistry: config.contracts.capabilityRegistry,
    DelegationManager: config.contracts.delegationManager,
    OrganizationRegistry: config.contracts.organizationRegistry,
    OrganizationCredentialAnchor: config.contracts.organizationCredentialAnchor,
  };

  for (const [name, address] of Object.entries(contractMap)) {
    if (!address) continue;
    try {
      const abi = getAbiByName(name);
      const iface = new ethers.Interface(abi);
      entries.push({ name, address, iface });
    } catch (e: any) {
      logger.warn("event-indexer", `Skipping ${name}: ${e.message}`);
    }
  }

  return entries;
}

function getCheckpoint(contractName: string): number {
  const row = runSingle<{ last_block: number }>(
    "SELECT last_block FROM indexer_checkpoints WHERE contract_name = ?",
    contractName
  );
  return row?.last_block || 0;
}

function setCheckpoint(contractName: string, blockNumber: number): void {
  runExecute(
    `INSERT INTO indexer_checkpoints (contract_name, last_block, processed_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(contract_name) DO UPDATE SET last_block = ?, processed_at = unixepoch()`,
    contractName, blockNumber, blockNumber
  );
}

function storeEvent(params: {
  contractName: string;
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  args: Record<string, any>;
  timestamp: number;
}): void {
  try {
    // Check for duplicate by tx_hash + log_index
    const existing = runSingle<{ id: number }>(
      "SELECT id FROM indexed_events WHERE tx_hash = ? AND log_index = ?",
      params.txHash, params.logIndex
    );
    if (existing) return;

    runExecute(
      `INSERT INTO indexed_events
       (contract_name, contract_address, event_name, block_number, tx_hash, log_index, args, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      params.contractName,
      params.contractAddress,
      params.eventName,
      params.blockNumber,
      params.txHash,
      params.logIndex,
      JSON.stringify(params.args),
      params.timestamp
    );
  } catch (e: any) {
    logger.warn("event-indexer", `Store event failed: ${e.message}`);
  }
}

async function indexContract(contract: ContractEntry, fromBlock: number, toBlock: number): Promise<number> {
  const provider = getProvider();
  let lastBlock = fromBlock;

  // Get all event topics from the ABI
  const events = contract.iface.fragments.filter((f: any) => f.type === "event") as ethers.EventFragment[];
  const topics = events
    .filter(f => INDEXED_EVENT_NAMES.has(f.name))
    .map(f => { const ev = contract.iface.getEvent(f.name); return ev ? ev.topicHash : null; })
    .filter((t): t is string => t !== null);

  if (topics.length === 0) return toBlock;

  // Query in chunks
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = Math.min(start + BLOCK_CHUNK - 1, toBlock);
    try {
      const logs = await provider.getLogs({
        address: contract.address,
        topics: [topics], // OR — any of these topics
        fromBlock: start,
        toBlock: end,
      });

      for (const log of logs) {
        try {
          const parsed = contract.iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;

          const args: Record<string, any> = {};
          parsed.args.forEach((val: any, key: any) => {
            if (typeof key === "string") args[key] = typeof val === "bigint" ? val.toString() : val;
          });

          // Get block timestamp
          let timestamp = Math.floor(Date.now() / 1000);
          try {
            const block = await provider.getBlock(log.blockNumber);
            if (block) timestamp = block.timestamp;
          } catch {}

          storeEvent({
            contractName: contract.name,
            contractAddress: contract.address,
            eventName: parsed.name,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            logIndex: log.index,
            args,
            timestamp,
          });

          lastBlock = Math.max(lastBlock, log.blockNumber);
        } catch {}
      }

      lastBlock = Math.max(lastBlock, end);
    } catch (e: any) {
      logger.warn("event-indexer", `getLogs failed for ${contract.name} [${start}-${end}]: ${e.message}`);
      // If chunk is too large, try smaller
      if (e.message?.includes("too large") || e.message?.includes("limit")) {
        const mid = Math.floor((start + end) / 2);
        try {
          const logs1 = await provider.getLogs({ address: contract.address, topics: [topics], fromBlock: start, toBlock: mid });
          const logs2 = await provider.getLogs({ address: contract.address, topics: [topics], fromBlock: mid + 1, toBlock: end });
          // Process both (reuse logic)
          for (const log of [...logs1, ...logs2]) {
            try {
              const parsed = contract.iface.parseLog({ topics: log.topics as string[], data: log.data });
              if (!parsed) continue;
              const args: Record<string, any> = {};
              parsed.args.forEach((val: any, key: any) => {
                if (typeof key === "string") args[key] = typeof val === "bigint" ? val.toString() : val;
              });
              let timestamp = Math.floor(Date.now() / 1000);
              try { const block = await provider.getBlock(log.blockNumber); if (block) timestamp = block.timestamp; } catch {}
              storeEvent({ contractName: contract.name, contractAddress: contract.address, eventName: parsed.name, blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.index, args, timestamp });
            } catch {}
          }
          lastBlock = Math.max(lastBlock, end);
        } catch {
          logger.error("event-indexer", `Chunked query also failed for ${contract.name}`);
        }
      }
    }
  }

  return lastBlock;
}

let _running = false;
let _timer: NodeJS.Timeout | null = null;
let _lastRun = 0;
let _totalIndexed = 0;

export async function runIndexer(): Promise<{ indexed: number; contracts: number; errors: string[] }> {
  if (_running) return { indexed: 0, contracts: 0, errors: ["Already running"] };
  _running = true;

  const provider = getProvider();
  const contracts = getIndexedContracts();
  const errors: string[] = [];
  let totalNew = 0;

  try {
    const currentBlock = await provider.getBlockNumber();

    for (const contract of contracts) {
      try {
        const fromBlock = getCheckpoint(contract.name) + 1;
        if (fromBlock > currentBlock) continue;

        const indexed = await indexContract(contract, fromBlock, currentBlock);
        setCheckpoint(contract.name, currentBlock);
        if (indexed > fromBlock) {
          totalNew += currentBlock - fromBlock;
        }
      } catch (e: any) {
        errors.push(`${contract.name}: ${e.message}`);
        logger.error("event-indexer", `Failed to index ${contract.name}: ${e.message}`);
      }
    }

    _lastRun = Date.now();
    _totalIndexed += totalNew;
    logger.info("event-indexer", `Indexed ${contracts.length} contracts up to block ${currentBlock}`);
  } catch (e: any) {
    errors.push(e.message);
  } finally {
    _running = false;
  }

  return { indexed: totalNew, contracts: contracts.length, errors };
}

export function startIndexer(): void {
  if (_timer) return;
  logger.info("event-indexer", `Starting event indexer (poll every ${POLL_INTERVAL_MS / 1000}s)`);

  // Run immediately
  runIndexer().catch(e => logger.error("event-indexer", `Initial run failed: ${e.message}`));

  _timer = setInterval(() => {
    runIndexer().catch(e => logger.error("event-indexer", `Poll failed: ${e.message}`));
  }, POLL_INTERVAL_MS);
}

export function stopIndexer(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info("event-indexer", "Stopped event indexer");
  }
}

export function getIndexerStatus(): { running: boolean; lastRun: number; totalIndexed: number } {
  return { running: _running, lastRun: _lastRun, totalIndexed: _totalIndexed };
}

export function getIndexedEvents(filters: {
  contractName?: string;
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  offset?: number;
} = {}): any[] {
  let sql = "SELECT * FROM indexed_events WHERE 1=1";
  const params: any[] = [];

  if (filters.contractName) {
    sql += " AND contract_name = ?";
    params.push(filters.contractName);
  }
  if (filters.eventName) {
    sql += " AND event_name = ?";
    params.push(filters.eventName);
  }
  if (filters.fromBlock) {
    sql += " AND block_number >= ?";
    params.push(filters.fromBlock);
  }
  if (filters.toBlock) {
    sql += " AND block_number <= ?";
    params.push(filters.toBlock);
  }

  sql += " ORDER BY block_number DESC, log_index DESC";

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;
  sql += " LIMIT ? OFFSET ?";
  params.push(limit, offset);

  return runQuery(sql, ...params);
}

export function getIndexedEventStats(): { contracts: Record<string, number>; total: number; eventTypes: Record<string, number> } {
  const contractRows = runQuery<{ contract_name: string; count: number }>(
    "SELECT contract_name, COUNT(*) as count FROM indexed_events GROUP BY contract_name"
  );
  const typeRows = runQuery<{ event_name: string; count: number }>(
    "SELECT event_name, COUNT(*) as count FROM indexed_events GROUP BY event_name ORDER BY count DESC"
  );
  const totalRow = runSingle<{ total: number }>("SELECT COUNT(*) as total FROM indexed_events");

  const contracts: Record<string, number> = {};
  for (const r of contractRows) contracts[r.contract_name] = r.count;

  const eventTypes: Record<string, number> = {};
  for (const r of typeRows) eventTypes[r.event_name] = r.count;

  return { contracts, total: totalRow?.total || 0, eventTypes };
}
