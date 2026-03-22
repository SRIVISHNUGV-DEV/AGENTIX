import { Contract, JsonRpcProvider, Interface, Log } from "ethers"
import { initDB } from "../db"
import { BlockchainService } from "./blockchain"

const POLL_INTERVAL_MS = 60000
const MAX_BLOCK_RANGE = 25
const WALLET_SYNC_EVERY_N_PASSES = 4
const MAX_WALLETS_PER_PASS = 10

function isRateLimitError(error:any){
    const message = String(error?.message ?? error ?? "")
    return (
        message.includes("\"code\": 429") ||
        message.includes("compute units per second capacity") ||
        message.includes("Too Many Requests") ||
        message.includes("rate limit")
    )
}

export class EventSyncService {

    blockchain: BlockchainService
    provider: JsonRpcProvider
    timer: NodeJS.Timeout | null
    passCount: number

    constructor(){
        this.blockchain = new BlockchainService()
        this.provider = this.blockchain.provider
        this.timer = null
        this.passCount = 0
    }

    async start(){
        try {
            await this.syncOnce()
        } catch (error:any) {
            console.error("Initial event sync failed:", error.message)
        }

        this.timer = setInterval(() => {
            this.syncOnce().catch((error) => {
                console.error("Event sync failed:", error.message)
            })
        }, POLL_INTERVAL_MS)
    }

    async syncOnce(){
        this.passCount += 1
        const db = await initDB()
        const contracts = await this.blockchain.getEventContracts(db)

        for (const contract of contracts) {
            try{
                await this.syncContractEvents(
                    db,
                    contract.orgId,
                    contract.name,
                    contract.address,
                    contract.abi
                )
            }catch(error:any){
                if(isRateLimitError(error)){
                    console.warn(`Skipping ${contract.name} event sync for now due to RPC rate limit`)
                    continue
                }
                throw error
            }
        }

        if(this.passCount % WALLET_SYNC_EVERY_N_PASSES !== 0){
            return
        }

        const wallets = await db.all(
            `
            SELECT wallet_address, org_id
            FROM wallets
            ORDER BY id DESC
            LIMIT ?
            `,
            MAX_WALLETS_PER_PASS
        )

        for (const wallet of wallets) {
            try{
                await this.syncContractEvents(
                    db,
                    wallet.org_id ?? 0,
                    "AgentWallet",
                    wallet.wallet_address,
                    this.blockchain.getWalletAbi()
                )
            }catch(error:any){
                if(isRateLimitError(error)){
                    console.warn(`Skipping wallet event sync for ${wallet.wallet_address} due to RPC rate limit`)
                    continue
                }
                throw error
            }
        }
    }

    private async syncContractEvents(db:any, orgId:number, contractName:string, address:string, abi:any){
        if(!address){
            return
        }

        const contract = new Contract(address, abi, this.provider)
        const key = `${orgId}:${contractName}:${address.toLowerCase()}`
        const latestBlock = await this.provider.getBlockNumber()
        const cursor = await db.get(
            `
            SELECT last_block
            FROM event_cursors
            WHERE contract_key = ?
            `,
            key
        )
        const fromBlock = cursor ? cursor.last_block + 1 : latestBlock

        if(fromBlock > latestBlock){
            return
        }
        const iface = new Interface(abi)

        for (let start = fromBlock; start <= latestBlock; start += MAX_BLOCK_RANGE) {
            const end = Math.min(start + MAX_BLOCK_RANGE - 1, latestBlock)
            const logs = await contract.queryFilter("*" as any, start, end)

            for (const log of logs) {
                await this.storeEvent(db, contractName, address, iface, log)
                await this.assignEventOrg(db, log.transactionHash, log.index, orgId)
            }
        }

        await db.run(
            `
            INSERT INTO event_cursors (contract_key, last_block)
            VALUES (?, ?)
            ON CONFLICT(contract_key)
            DO UPDATE SET last_block = excluded.last_block
            `,
            key,
            latestBlock
        )
    }

    private async storeEvent(db:any, contractName:string, address:string, iface:Interface, log:Log){
        const parsed = iface.parseLog(log)

        if(!parsed){
            return
        }

        const payload = parsed.args.toObject ? parsed.args.toObject() : parsed.args
        const normalizedPayload = JSON.stringify(
            this.normalizeValue(payload)
        )

        const sessionId = this.extractValue(payload, ["sessionId"])
        const walletAddress =
            this.extractValue(payload, ["wallet"]) ??
            (contractName === "AgentWallet" ? address : null)

        await db.run(
            `
            INSERT OR IGNORE INTO contract_events
            (org_id, contract_name, contract_address, event_name, tx_hash, block_number, log_index, session_id, wallet_address, payload)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            `,
            null,
            contractName,
            address,
            parsed.name,
            log.transactionHash,
            log.blockNumber,
            log.index,
            sessionId,
            walletAddress,
            normalizedPayload
        )

        if(contractName === "AgentWalletFactory" && parsed.name === "WalletCreated"){
            const deployment = await db.get(
                `
                SELECT org_id, session_manager_address, agent_wallet_implementation_address
                FROM organization_contracts
                WHERE agent_wallet_factory_address = ?
                `,
                address
            )

            await db.run(
                `
                INSERT INTO wallets
                (org_id, owner_address, wallet_address, session_manager_address, implementation_address)
                VALUES (?,?,?,?,?)
                ON CONFLICT(wallet_address) DO UPDATE SET
                    org_id = COALESCE(wallets.org_id, excluded.org_id),
                    owner_address = excluded.owner_address,
                    session_manager_address = excluded.session_manager_address,
                    implementation_address = COALESCE(excluded.implementation_address, wallets.implementation_address)
                `,
                deployment?.org_id ?? null,
                this.extractValue(payload, ["owner"]),
                this.extractValue(payload, ["wallet"]),
                deployment?.session_manager_address ?? "",
                deployment?.agent_wallet_implementation_address ?? process.env.AGENT_WALLET_IMPLEMENTATION_ADDRESS ?? ""
            )
        }
    }

    private async assignEventOrg(db:any, txHash:string, logIndex:number, orgId:number){
        await db.run(
            `
            UPDATE contract_events
            SET org_id = COALESCE(org_id, ?)
            WHERE tx_hash = ? AND log_index = ?
            `,
            orgId,
            txHash,
            logIndex
        )
    }

    private extractValue(payload:any, keys:string[]){
        for (const key of keys) {
            const value = payload?.[key]
            if (value !== undefined && value !== null) {
                return typeof value === "bigint" ? value.toString() : value.toString()
            }
        }
        return null
    }

    private normalizeValue(value:any):any{
        if (typeof value === "bigint") {
            return value.toString()
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeValue(item))
        }

        if (value && typeof value === "object") {
            return Object.fromEntries(
                Object.entries(value).filter(([key]) => Number.isNaN(Number(key))).map(
                    ([key, item]) => [key, this.normalizeValue(item)]
                )
            )
        }

        return value
    }
}
