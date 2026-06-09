import { Wallet } from "ethers"
import { IncrementalMerkleTree } from "./merkle"
import { SparseRevocationTree, toRevocationKey } from "./revocationTree"
import { BlockchainService, getBlockchainService } from "./blockchain"

export class PlatformService {
    blockchain: BlockchainService

    constructor() {
        this.blockchain = getBlockchainService()
    }

    /**
     * Issue credential from a client-generated commitment.
     * The backend NEVER sees the raw secret — only the commitment (hash) and optional secretHash.
     */
    async issueCredential(
        db: any,
        agentId: number,
        orgId: number,
        permissions: number,
        expiry: number,
        commitment: string,
        secretHash?: string | null
    ) {
        const existing = await db.get(
            `SELECT id FROM credentials WHERE agent_id = ?`,
            agentId
        )

        if (existing) {
            throw new Error("credential already exists for agent")
        }

        const tree = new IncrementalMerkleTree(20, { orgId })
        const leafIndex = await tree.getNextLeafIndex(db)

        await db.run(
            `INSERT INTO credentials (agent_id, org_id, permissions, expiry, commitment, secret_hash, leaf_index)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            agentId, orgId, permissions, expiry, commitment, secretHash ?? null, leafIndex
        )

        await tree.insert(db, BigInt(commitment), leafIndex)
        await tree.rebuildFromCredentials(db)
        const root = await tree.getRoot(db)
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`
        const chain = await this.blockchain.updateActiveRootForOrg(db, orgId, rootHex)

        return { success: true, agentId, orgId, rootHex, chain }
    }

    async createWallet(db:any, agentId:number, ownerAddress?:string){
        const agent = await db.get(`SELECT * FROM agents WHERE id = ?`, agentId)
        const ownerWallet = ownerAddress ? null : Wallet.createRandom()
        const owner = ownerAddress ?? ownerWallet!.address
        const wallet = await this.blockchain.createWalletForOrg(db, agent.org_id, owner)

        await db.run(
            `
            INSERT INTO wallets
            (
                agent_id,
                org_id,
                owner_address,
                wallet_address,
                session_manager_address,
                implementation_address,
                entry_point_address,
                factory_salt,
                wallet_kind
            )
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                agent_id = COALESCE(wallets.agent_id, excluded.agent_id),
                org_id = COALESCE(wallets.org_id, excluded.org_id),
                owner_address = excluded.owner_address,
                session_manager_address = excluded.session_manager_address,
                implementation_address = COALESCE(excluded.implementation_address, wallets.implementation_address),
                entry_point_address = COALESCE(excluded.entry_point_address, wallets.entry_point_address),
                factory_salt = COALESCE(excluded.factory_salt, wallets.factory_salt),
                wallet_kind = COALESCE(excluded.wallet_kind, wallets.wallet_kind)
            `,
            agentId,
            agent.org_id,
            owner,
            wallet.walletAddress,
            wallet.sessionManagerAddress,
            wallet.implementationAddress ?? null,
            wallet.entryPointAddress ?? null,
            wallet.factorySalt ?? null,
            wallet.walletKind ?? "erc4337"
        )

        return {
            success: true,
            ...wallet
        }
    }

    async revokeCredential(db: any, agentId: number, secretHash: string) {
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
        if (!agent) throw new Error("agent not found")

        const revocationTree = new SparseRevocationTree(agent.org_id)

        const existing = await db.get(
            `SELECT id FROM revoked_secrets WHERE org_id = ? AND secret_hash = ?`,
            agent.org_id, secretHash
        )
        if (existing) throw new Error("secret already revoked")

        const smtKey = toRevocationKey(BigInt(secretHash)).toString()
        const leafIndex = (
            await db.get(
                `SELECT COALESCE(MAX(leaf_index), -1) + 1 as c FROM revoked_secrets WHERE org_id = ?`,
                agent.org_id
            )
        ).c

        await db.run(
            `INSERT INTO revoked_secrets (agent_id, org_id, secret_hash, smt_key, revoked_value, leaf_index)
             VALUES (?, ?, ?, ?, ?, ?)`,
            agentId, agent.org_id, secretHash, smtKey, 1, leafIndex
        )

        const root = await revocationTree.getRoot(db)
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`
        const chain = await this.blockchain.updateRevokedRootForOrg(db, agent.org_id, rootHex)

        return { success: true, agentId, orgId: agent.org_id, rootHex, chain }
    }

    async fundAgent(db:any, agentId:number, amountEth:string){
        const wallet = await db.get(
            `
            SELECT *
            FROM wallets
            WHERE agent_id = ?
            ORDER BY id DESC
            `,
            agentId
        )

        if(!wallet){
            throw new Error("wallet not found for agent")
        }

        return this.blockchain.fundAddress(wallet.wallet_address, amountEth)
    }

    async fundOrganization(db:any, orgId:number, amountEth:string){
        const wallets = await db.all(
            `
            SELECT wallet_address, agent_id
            FROM wallets
            WHERE org_id = ?
            ORDER BY id ASC
            `,
            orgId
        )

        if(wallets.length === 0){
            throw new Error("no wallets found for organization")
        }

        const transfers = []
        for(const wallet of wallets){
            const transfer = await this.blockchain.fundAddress(wallet.wallet_address, amountEth)
            transfers.push({
                ...transfer,
                agentId: wallet.agent_id
            })
        }

        return {
            success:true,
            orgId,
            amountEth,
            transfers
        }
    }
}
