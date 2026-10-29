import { ethers } from "ethers";
import { getProvider } from "./provider";
import { loadConfig } from "./config";
import { getAbiByName } from "../contracts";
import { runQuery, runSingle, runExecute } from "./database";
import { logger } from "./logger";

/**
 * Public Base Sepolia RPCs cap eth_getLogs at a 200-block range
 * (-32614 "eth_getLogs is limited to a 200 range"). Chunks must therefore be
 * AT or UNDER 200 blocks — the previous 2000-block chunks could never
 * complete a first-run scan on the default RPC, and the old single-halving
 * retry failed again at 1000 blocks. Ranges that a stricter RPC still
 * rejects are split further by queryLogsWithSplitRetry, down to 1 block.
 */
const BLOCK_CHUNK = 200;
const POLL_INTERVAL_MS = 30_000;
// Never scan before this block — prevents scanning 43M+ blocks on first run.
// Contracts deployed ~2026-07-01 on Base Sepolia. Bump when redeploying.
const GENESIS_BLOCK = 43_500_000;
// Cap first-run scan to this many blocks behind current head
const FIRST_RUN_MAX_SCAN = 200_000;

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
  // Never return below GENESIS_BLOCK — prevents scanning from block 0
  return Math.max(row?.last_block || 0, GENESIS_BLOCK);
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
}): boolean {
  try {
    // Check for duplicate by tx_hash + log_index
    const existing = runSingle<{ id: number }>(
      "SELECT id FROM indexed_events WHERE tx_hash = ? AND log_index = ?",
      params.txHash, params.logIndex
    );
    if (existing) return false;

    const result = runExecute(
      // OR IGNORE: (tx_hash, log_index) is UNIQUE, so re-polling an overlapping
         // block range is a no-op instead of raising a constraint error that gets
         // swallowed as a noisy "Store event failed" warning on every duplicate.
         `INSERT OR IGNORE INTO indexed_events
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
    return result.changes > 0;
  } catch (e: any) {
    logger.warn("event-indexer", `Store event failed: ${e.message}`);
    return false;
  }
}

/** True when an eth_getLogs failure is a range cap (splitting can help),
 * as opposed to any other RPC/chain error (splitting cannot). Covers the
 * observed public-RPC form (-32614 "eth_getLogs is limited to a 200 range")
 * and generic "too large"/"limit" wordings. */
function isRangeLimitError(e: any): boolean {
  const codes = [e?.code, e?.error?.code];
  if (codes.includes(-32614) || codes.includes("-32614")) return true;
  const messages = [e?.message, e?.error?.message].filter(Boolean).join(" ");
  return /limit|too large|range/i.test(messages);
}

export interface LogProvider {
  getLogs(filter: { address: string; topics: any[]; fromBlock: number; toBlock: number }): Promise<any[]>;
  getBlock(blockNumber: number): Promise<{ timestamp: number } | null>;
}

/**
 * Fetch one range, splitting it in half on range-cap errors until it
 * succeeds or reaches a single block. A single-block range that still fails
 * throws: the caller must then STOP and surface the error, never skip past
 * the failed range (a skipped range is lost event history, silently).
 * Non-range errors throw immediately — retrying them by splitting is futile.
 */
export async function queryLogsWithSplitRetry(
  provider: LogProvider,
  address: string,
  topics: any[],
  fromBlock: number,
  toBlock: number
): Promise<any[]> {
  try {
    return await provider.getLogs({ address, topics: [topics], fromBlock, toBlock });
  } catch (e: any) {
    if (!isRangeLimitError(e)) throw e;
    if (fromBlock >= toBlock) throw e;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await queryLogsWithSplitRetry(provider, address, topics, fromBlock, mid);
    const right = await queryLogsWithSplitRetry(provider, address, topics, mid + 1, toBlock);
    return [...left, ...right];
  }
}

/** Parse + store one batch of logs. Returns the number of events stored
 * (duplicates and unparsable logs are not counted). */
async function processLogs(contract: ContractEntry, logs: any[], provider: LogProvider): Promise<number> {
  let stored = 0;
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

      if (storeEvent({
        contractName: contract.name,
        contractAddress: contract.address,
        eventName: parsed.name,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.index,
        args,
        timestamp,
      })) stored++;
    } catch {}
  }
  return stored;
}

export interface IndexContractResult {
  /** Highest block such that every block in [fromBlock, lastBlock] was fully
   * indexed. fromBlock - 1 when the first chunk failed (no progress). The
   * caller must checkpoint at most this value — never past a failed range. */
  lastBlock: number;
  /** Events actually stored (not blocks scanned — the old metric). */
  eventsStored: number;
  /** One entry per failed chunk; non-empty means indexing stopped early. */
  errors: string[];
}

async function indexContract(contract: ContractEntry, fromBlock: number, toBlock: number): Promise<IndexContractResult> {
  const provider = getProvider();

  // Get all event topics from the ABI
  const events = contract.iface.fragments.filter((f: any) => f.type === "event") as ethers.EventFragment[];
  const topics = events
    .filter(f => INDEXED_EVENT_NAMES.has(f.name))
    .map(f => { const ev = contract.iface.getEvent(f.name); return ev ? ev.topicHash : null; })
    .filter((t): t is string => t !== null);

  if (topics.length === 0) return { lastBlock: toBlock, eventsStored: 0, errors: [] };

  // Query in chunks, in order. On the FIRST chunk that cannot be fetched
  // (even after split-retry down to single blocks), STOP: later chunks are
  // not processed and the checkpoint is not advanced past the gap, so the
  // failed range is retried on the next run instead of being lost forever.
  // The old code swallowed the failure, kept looping, and advanced the
  // checkpoint past it — silent data loss.
  let frontier = fromBlock - 1;
  let eventsStored = 0;
  const errors: string[] = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = Math.min(start + BLOCK_CHUNK - 1, toBlock);
    try {
      const logs = await queryLogsWithSplitRetry(provider, contract.address, topics, start, end);
      eventsStored += await processLogs(contract, logs, provider);
      frontier = end;
    } catch (e: any) {
      const msg = `${contract.name} [${start}-${end}]: ${e.message}`;
      errors.push(msg);
      logger.error("event-indexer", `getLogs failed for ${msg} — checkpoint NOT advanced past this range`);
      break;
    }
  }

  return { lastBlock: frontier, eventsStored, errors };
}

let _running = false;
let _timer: NodeJS.Timeout | null = null;
let _lastRun = 0;
/** Cumulative EVENTS stored by runIndexer/reindexFromBlock (not blocks scanned). */
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
        let fromBlock = getCheckpoint(contract.name) + 1;
        // Cap first-run scan to avoid scanning millions of blocks
        if (currentBlock - fromBlock > FIRST_RUN_MAX_SCAN) {
          fromBlock = currentBlock - FIRST_RUN_MAX_SCAN;
          logger.info("event-indexer", `Capping ${contract.name} scan to last ${FIRST_RUN_MAX_SCAN} blocks (from ${fromBlock})`);
        }
        if (fromBlock > currentBlock) continue;

        const result = await indexContract(contract, fromBlock, currentBlock);
        // Checkpoint ONLY to the contiguous frontier. If the first chunk
        // failed, result.lastBlock < fromBlock and the checkpoint is left
        // untouched, so the next run retries the failed range instead of
        // silently skipping it. `indexed` counts events stored, not blocks.
        if (result.lastBlock >= fromBlock) {
          setCheckpoint(contract.name, result.lastBlock);
        }
        totalNew += result.eventsStored;
        errors.push(...result.errors);
      } catch (e: any) {
        errors.push(`${contract.name}: ${e.message}`);
        logger.error("event-indexer", `Failed to index ${contract.name}: ${e.message}`);
      }
    }

    _lastRun = Date.now();
    _totalIndexed += totalNew;
    logger.info("event-indexer", `Indexed ${totalNew} events from ${contracts.length} contracts up to block ${currentBlock}${errors.length ? ` (${errors.length} range error(s) — checkpoints held at the failed ranges)` : ""}`);
  } catch (e: any) {
    errors.push(e.message);
  } finally {
    _running = false;
  }

  return { indexed: totalNew, contracts: contracts.length, errors };
}

/**
 * Re-index from a specific block number. Useful for:
 * - Recovering lost data after database deletion
 * - Re-scanning after contract upgrades
 * - Filling gaps in event history
 */
export async function reindexFromBlock(fromBlock: number): Promise<{ indexed: number; contracts: number; errors: string[] }> {
  if (_running) return { indexed: 0, contracts: 0, errors: ["Already running"] };
  _running = true;

  const provider = getProvider();
  const contracts = getIndexedContracts();
  const errors: string[] = [];
  let totalNew = 0;

  try {
    const currentBlock = await provider.getBlockNumber();
    const startBlock = Math.max(fromBlock, GENESIS_BLOCK);

    logger.info("event-indexer", `Re-indexing from block ${startBlock} to ${currentBlock}`);

    for (const contract of contracts) {
      try {
        // Reset checkpoint to force re-scan from the specified block
        setCheckpoint(contract.name, startBlock - 1);

        const result = await indexContract(contract, startBlock, currentBlock);
        // Advance only to the contiguous frontier (see runIndexer). The
        // checkpoint already sits at startBlock - 1, so a failed first
        // chunk leaves it there for a later retry, never past the gap.
        if (result.lastBlock >= startBlock) {
          setCheckpoint(contract.name, result.lastBlock);
        }
        totalNew += result.eventsStored;
        errors.push(...result.errors);
      } catch (e: any) {
        errors.push(`${contract.name}: ${e.message}`);
        logger.error("event-indexer", `Failed to re-index ${contract.name}: ${e.message}`);
      }
    }

    _lastRun = Date.now();
    _totalIndexed += totalNew;
    logger.info("event-indexer", `Re-indexed ${contracts.length} contracts from block ${startBlock}`);
  } catch (e: any) {
    errors.push(e.message);
  } finally {
    _running = false;
  }

  return { indexed: totalNew, contracts: contracts.length, errors };
}

/**
 * Reproduce local state from indexed on-chain events.
 * This rebuilds credentials, sessions, wallets, and organizations from
 * the event history stored in indexed_events table.
 * 
 * Use case: If the local database is corrupted or deleted, this function
 * can reconstruct the essential state from on-chain events.
 */
export async function reproduceLocalState(): Promise<{
  wallets: number;
  sessions: number;
  credentials: number;
  organizations: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let wallets = 0;
  let sessions = 0;
  let credentials = 0;
  let organizations = 0;

  try {
    // 1. Reproduce wallets from WalletCreated events
    const walletEvents = runQuery<any>(
      "SELECT args FROM indexed_events WHERE event_name = 'WalletCreated' ORDER BY block_number ASC"
    );
    for (const evt of walletEvents) {
      try {
        const args = JSON.parse(evt.args || '{}');
        const walletAddr = args.wallet || args.walletAddress;
        const ownerAddr = args.owner || args.ownerAddress;
        if (walletAddr && ownerAddr) {
          runExecute(
            `INSERT OR IGNORE INTO wallets (wallet_address, owner_address, created_at) VALUES (?, ?, unixepoch())`,
            walletAddr, ownerAddr
          );
          wallets++;
        }
      } catch (e: any) {
        errors.push(`WalletCreated: ${e.message}`);
      }
    }

    // 2. Reproduce sessions from SessionCreated/LightSessionCreated events
    const sessionEvents = runQuery<any>(
      "SELECT args, event_name FROM indexed_events WHERE event_name IN ('SessionCreated', 'LightSessionCreated') ORDER BY block_number ASC"
    );
    for (const evt of sessionEvents) {
      try {
        const args = JSON.parse(evt.args || '{}');
        const sessionId = args.sessionId || args.session_id;
        const walletAddr = args.wallet || args.walletAddress;
        if (sessionId) {
          runExecute(
            `INSERT OR IGNORE INTO sessions (session_id, wallet_address, session_key, created_at) VALUES (?, ?, ?, unixepoch())`,
            sessionId, walletAddr || '', args.sessionKey || ''
          );
          sessions++;
        }
      } catch (e: any) {
        errors.push(`${evt.event_name}: ${e.message}`);
      }
    }

    // 3. Reproduce organizations from OrganizationRegistered events
    const orgEvents = runQuery<any>(
      "SELECT args FROM indexed_events WHERE event_name = 'OrganizationRegistered' ORDER BY block_number ASC"
    );
    for (const evt of orgEvents) {
      try {
        const args = JSON.parse(evt.args || '{}');
        const orgId = args.organizationId || args.orgId;
        const name = args.name || '';
        const owner = args.owner || args.ownerAddress;
        if (orgId) {
          runExecute(
            `INSERT OR IGNORE INTO organizations (id, name, owner_address, created_at) VALUES (?, ?, ?, unixepoch())`,
            orgId, name, owner || ''
          );
          organizations++;
        }
      } catch (e: any) {
        errors.push(`OrganizationRegistered: ${e.message}`);
      }
    }

    // 4. Reproduce credentials from ActiveRootUpdated events (root anchoring)
    const credEvents = runQuery<any>(
      "SELECT args FROM indexed_events WHERE event_name = 'ActiveRootUpdated' ORDER BY block_number ASC"
    );
    for (const evt of credEvents) {
      try {
        const args = JSON.parse(evt.args || '{}');
        const root = args.root || args.newRoot;
        const epoch = args.epoch || 0;
        const orgId = args.organizationId || '';
        if (root) {
          runExecute(
            `INSERT OR IGNORE INTO credential_roots (organization_id, root, epoch, created_at) VALUES (?, ?, ?, unixepoch())`,
            orgId, root.toString(), Number(epoch)
          );
          credentials++;
        }
      } catch (e: any) {
        errors.push(`ActiveRootUpdated: ${e.message}`);
      }
    }

    logger.info("event-indexer", `Reproduced state: ${wallets} wallets, ${sessions} sessions, ${organizations} orgs, ${credentials} credential roots`);
  } catch (e: any) {
    errors.push(e.message);
  }

  return { wallets, sessions, credentials, organizations, errors };
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
