"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventSyncService = void 0;
const ethers_1 = require("ethers");
const db_1 = require("../db");
const blockchain_1 = require("./blockchain");
const POLL_INTERVAL_MS = 60000;
const MAX_BLOCK_RANGE = 10;
const MAX_BLOCKS_PER_PASS = 1000;
const WALLET_SYNC_EVERY_N_PASSES = 4;
const MAX_WALLETS_PER_PASS = 10;
function isRateLimitError(error) {
    const message = String(error?.message ?? error ?? "");
    return (message.includes("\"code\": 429") ||
        message.includes("compute units per second capacity") ||
        message.includes("Too Many Requests") ||
        message.includes("rate limit"));
}
class EventSyncService {
    blockchain;
    provider;
    timer;
    passCount;
    constructor() {
        this.blockchain = new blockchain_1.BlockchainService();
        this.provider = this.blockchain.provider;
        this.timer = null;
        this.passCount = 0;
    }
    async start() {
        try {
            await this.syncOnce();
        }
        catch (error) {
            console.error("Initial event sync failed:", error.message);
        }
        this.timer = setInterval(() => {
            this.syncOnce().catch((error) => {
                console.error("Event sync failed:", error.message);
            });
        }, POLL_INTERVAL_MS);
    }
    async syncOnce() {
        this.passCount += 1;
        const db = await (0, db_1.initDB)();
        const latestBlock = await this.provider.getBlockNumber();
        const contracts = await this.blockchain.getEventContracts(db);
        for (const contract of contracts) {
            try {
                await this.syncContractEvents(db, contract.orgId, contract.name, contract.address, contract.abi, latestBlock);
            }
            catch (error) {
                if (isRateLimitError(error)) {
                    console.warn(`Skipping ${contract.name} event sync for now due to RPC rate limit`);
                    continue;
                }
                throw error;
            }
        }
        if (this.passCount % WALLET_SYNC_EVERY_N_PASSES !== 0) {
            return;
        }
        const wallets = await db.all(`
            SELECT wallet_address, org_id
            FROM wallets
            ORDER BY id DESC
            LIMIT ?
            `, MAX_WALLETS_PER_PASS);
        for (const wallet of wallets) {
            try {
                await this.syncContractEvents(db, wallet.org_id ?? 0, "AgentWallet", wallet.wallet_address, this.blockchain.getWalletAbi(), latestBlock);
            }
            catch (error) {
                if (isRateLimitError(error)) {
                    console.warn(`Skipping wallet event sync for ${wallet.wallet_address} due to RPC rate limit`);
                    continue;
                }
                throw error;
            }
        }
    }
    async syncContractEvents(db, orgId, contractName, address, abi, latestBlock) {
        if (!address) {
            return;
        }
        const contract = new ethers_1.Contract(address, abi, this.provider);
        const key = `${orgId}:${contractName}:${address.toLowerCase()}`;
        const cursor = await db.get(`
            SELECT last_block
            FROM event_cursors
            WHERE contract_key = ?
            `, key);
        const fromBlock = cursor ? cursor.last_block + 1 : latestBlock;
        if (fromBlock > latestBlock) {
            return;
        }
        const syncToBlock = Math.min(fromBlock + MAX_BLOCKS_PER_PASS - 1, latestBlock);
        const iface = new ethers_1.Interface(abi);
        for (let start = fromBlock; start <= syncToBlock; start += MAX_BLOCK_RANGE) {
            const end = Math.min(start + MAX_BLOCK_RANGE - 1, syncToBlock);
            // Use provider.getLogs directly for better reliability than contract.queryFilter
            let logs = [];
            try {
                logs = await this.provider.getLogs({
                    address: address,
                    fromBlock: start,
                    toBlock: end,
                });
            }
            catch (error) {
                if (isRateLimitError(error)) {
                    console.warn(`Rate limit hit for ${contractName}, will retry next pass`);
                    return; // Exit early, will retry on next interval
                }
                throw error;
            }
            for (const log of logs) {
                try {
                    await this.storeEvent(db, orgId, contractName, address, iface, log);
                    await this.assignEventOrg(db, log.transactionHash, log.index, orgId);
                }
                catch (logError) {
                    console.error(`Error processing log in ${contractName}:`, logError.message);
                    // Continue processing other logs
                }
            }
        }
        await db.run(`
            INSERT INTO event_cursors (contract_key, last_block)
            VALUES (?, ?)
            ON CONFLICT(contract_key)
            DO UPDATE SET last_block = excluded.last_block
            `, key, syncToBlock);
        if (syncToBlock < latestBlock) {
            console.log(`${contractName} sync caught up to block ${syncToBlock}, ${latestBlock - syncToBlock} blocks remaining (will continue next pass)`);
        }
    }
    async storeEvent(db, orgId, contractName, address, iface, log) {
        // Handle raw logs from provider.getLogs() which have topics/data instead of parsed args
        let parsed = null;
        try {
            parsed = iface.parseLog({
                topics: [...log.topics],
                data: log.data,
            });
        }
        catch (parseError) {
            // Log from a different contract or unknown event, skip silently
            return;
        }
        if (!parsed) {
            return;
        }
        const payload = parsed.args.toObject ? parsed.args.toObject() : parsed.args;
        const normalizedPayload = JSON.stringify(this.normalizeValue(payload));
        const sessionId = this.extractValue(payload, ["sessionId"]);
        const walletAddress = this.extractValue(payload, ["wallet"]) ??
            (contractName === "AgentWallet" ? address : null);
        // Handle log properties - they might be accessed differently depending on log type
        const txHash = log.transactionHash;
        const blockNumber = log.blockNumber;
        const logIndex = log.index;
        await db.run(`
            INSERT INTO contract_events
            (org_id, event_type, contract_name, contract_address, event_name, tx_hash, block_number, log_index, session_id, wallet_address, event_data)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (tx_hash, log_index) DO NOTHING
            `, orgId, parsed.name, // event_type is the event name
        contractName, address, parsed.name, txHash, blockNumber, logIndex, sessionId, walletAddress, normalizedPayload);
        if (contractName === "AgentWalletFactory" && parsed.name === "WalletCreated") {
            const deployment = await db.get(`
                SELECT org_id, session_manager_address, agent_wallet_implementation_address, entry_point_address
                FROM organization_contracts
                WHERE agent_wallet_factory_address = ?
                `, address);
            await db.run(`
                INSERT INTO wallets
                (org_id, owner_address, wallet_address, session_manager_address, implementation_address, entry_point_address, wallet_kind)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(wallet_address) DO UPDATE SET
                    org_id = COALESCE(wallets.org_id, excluded.org_id),
                    owner_address = excluded.owner_address,
                    session_manager_address = excluded.session_manager_address,
                    implementation_address = COALESCE(excluded.implementation_address, wallets.implementation_address),
                    entry_point_address = COALESCE(excluded.entry_point_address, wallets.entry_point_address),
                    wallet_kind = COALESCE(excluded.wallet_kind, wallets.wallet_kind)
                `, deployment?.org_id ?? null, this.extractValue(payload, ["owner"]), this.extractValue(payload, ["wallet"]), deployment?.session_manager_address ?? "", deployment?.agent_wallet_implementation_address ?? process.env.AGENT_WALLET_IMPLEMENTATION_ADDRESS ?? "", deployment?.entry_point_address ?? process.env.ENTRY_POINT_ADDRESS ?? null, "erc4337");
        }
    }
    async assignEventOrg(db, txHash, logIndex, orgId) {
        await db.run(`
            UPDATE contract_events
            SET org_id = COALESCE(org_id, ?)
            WHERE tx_hash = ? AND log_index = ?
            `, orgId, txHash, logIndex);
    }
    extractValue(payload, keys) {
        for (const key of keys) {
            const value = payload?.[key];
            if (value !== undefined && value !== null) {
                return typeof value === "bigint" ? value.toString() : value.toString();
            }
        }
        return null;
    }
    normalizeValue(value) {
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeValue(item));
        }
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).filter(([key]) => Number.isNaN(Number(key))).map(([key, item]) => [key, this.normalizeValue(item)]));
        }
        return value;
    }
}
exports.EventSyncService = EventSyncService;
