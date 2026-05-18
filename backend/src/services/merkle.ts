import { poseidonHash } from "../utils/crypto"

// FLAW 6 FIX: Merkle tree caching
// Cache the tree state in memory and persist to merkle_tree_state table
// Avoid rebuilding the tree on every operation

// In-memory cache: orgId -> tree state
const treeCache: Map<number, { root: bigint; leafCount: number; lastUpdate: number }> = new Map()
const CACHE_TTL_MS = 60000 // 1 minute cache TTL

export class IncrementalMerkleTree {

    depth: number
    zero: bigint
    nodesTable: string
    indexQuery: string
    orgId: number

    constructor(
        depth: number,
        options?: {
            nodesTable?: string,
            indexQuery?: string,
            orgId?: number
        }
    ) {
        this.depth = depth
        this.zero = 0n
        this.nodesTable = options?.nodesTable ?? "merkle_tree"
        this.orgId = options?.orgId ?? 0
        this.indexQuery =
            options?.indexQuery ??
            `SELECT COALESCE(MAX(leaf_index), -1) + 1 as c FROM credentials WHERE org_id = ${this.orgId}`
    }

    // Load tree state from cache or database
    async loadState(db: any): Promise<{ root: bigint; leafCount: number } | null> {
        // Check memory cache first
        const cached = treeCache.get(this.orgId)
        if (cached && Date.now() - cached.lastUpdate < CACHE_TTL_MS) {
            return { root: cached.root, leafCount: cached.leafCount }
        }

        // Load from database
        const row = await db.get(
            `
            SELECT root, leaf_count
            FROM merkle_tree_state
            WHERE org_id = $1 AND tree_type = 'active'
            `,
            this.orgId
        )

        if (row) {
            const state = {
                root: BigInt(row.root),
                leafCount: row.leaf_count
            }
            treeCache.set(this.orgId, {
                ...state,
                lastUpdate: Date.now()
            })
            return state
        }

        return null
    }

    // Save tree state to cache and database
    async saveState(db: any, root: bigint, leafCount: number): Promise<void> {
        // Update memory cache
        treeCache.set(this.orgId, {
            root,
            leafCount,
            lastUpdate: Date.now()
        })

        // Persist to database
        await db.run(
            `
            INSERT INTO merkle_tree_state (org_id, tree_type, root, leaf_count, updated_at)
            VALUES ($1, 'active', $2, $3, EXTRACT(EPOCH FROM NOW())::INTEGER)
            ON CONFLICT (org_id, tree_type) DO UPDATE
            SET root = $2, leaf_count = $3, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
            `,
            this.orgId,
            root.toString(),
            leafCount
        )
    }

    // Invalidate cache for this org
    invalidateCache(): void {
        treeCache.delete(this.orgId)
    }

    async insert(db: any, leaf: bigint, leafIndex?: number) {

        let current = leaf
        let index = leafIndex ?? await this.getNextLeafIndex(db)

        await this.storeNode(db, 0, index, current)

        for (let level = 1; level <= this.depth; level++) {

            const isRight = index % 2

            let left: bigint
            let right: bigint

            if (isRight) {

                left = await this.getNode(db, level - 1, index - 1)
                right = current

            } else {

                left = current
                right = this.zero
            }

            current = poseidonHash([left, right])

            index = Math.floor(index / 2)

            await this.storeNode(db, level, index, current)
        }

        // Update cached state
        const state = await this.loadState(db)
        const newLeafCount = (state?.leafCount ?? 0) + 1
        await this.saveState(db, current, newLeafCount)

        return current
    }

    async rebuildFromCredentials(db: any) {

        await db.run(`DELETE FROM ${this.nodesTable} WHERE org_id = $1`, this.orgId)

        const credentials = await db.all(
            `
            SELECT leaf_index, commitment
            FROM credentials
            WHERE org_id = $1
            ORDER BY leaf_index ASC
            `,
            this.orgId
        )

        let root = 0n
        for (const credential of credentials) {
            root = await this.insertAt(
                db,
                credential.leaf_index,
                BigInt(credential.commitment)
            )
        }

        // Save rebuilt state
        await this.saveState(db, root, credentials.length)
    }

    async getRoot(db: any) {
        // Check cache first
        const state = await this.loadState(db)
        if (state) {
            return state.root
        }

        // Fallback to database query
        const row = await db.get(
            `
            SELECT hash
            FROM ${this.nodesTable}
            WHERE org_id = $1
              AND level = $2
              AND node_index = 0
            `,
            this.orgId,
            this.depth
        )

        const root = row ? BigInt(row.hash) : 0n

        // Cache the result
        const leafCount = await this.getLeafCount(db)
        await this.saveState(db, root, leafCount)

        return root
    }

    async getLeafCount(db: any): Promise<number> {
        const state = await this.loadState(db)
        if (state) {
            return state.leafCount
        }

        const row = await db.get(
            `
            SELECT COUNT(*) as count
            FROM credentials
            WHERE org_id = $1
            `,
            this.orgId
        )

        return row?.count ?? 0
    }

    async generateProof(db: any, leafIndex: number) {

        const pathElements: string[] = []
        const pathIndices: number[] = []

        let index = leafIndex

        for (let level = 0; level < this.depth; level++) {

            const isRight = index % 2
            const pairIndex = isRight ? index - 1 : index + 1

            const sibling = await this.getNode(
                db,
                level,
                pairIndex
            )

            pathElements.push(
                sibling ? sibling.toString() : "0"
            )

            pathIndices.push(isRight)

            index = Math.floor(index / 2)
        }

        return {
            pathElements,
            pathIndices
        }
    }

    async storeNode(db: any, level: number, index: number, hash: bigint) {

        await db.run(
            `
            DELETE FROM ${this.nodesTable}
            WHERE org_id = $1 AND level = $2 AND node_index = $3
            `,
            this.orgId,
            level,
            index
        )

        await db.run(
            `
            INSERT INTO ${this.nodesTable}
            (org_id, level, node_index, hash)
            VALUES ($1, $2, $3, $4)
            `,
            this.orgId,
            level,
            index,
            hash.toString()
        )
    }

    async getNode(db: any, level: number, index: number) {

        const row = await db.get(
            `
            SELECT hash
            FROM ${this.nodesTable}
            WHERE org_id = $1 AND level = $2 AND node_index = $3
            `,
            this.orgId,
            level,
            index
        )

        return row ? BigInt(row.hash) : this.zero
    }

    async getNextLeafIndex(db: any) {

        const row = await db.get(
            this.indexQuery
        )

        return row.c
    }

    private async insertAt(db: any, leafIndex: number, leaf: bigint) {

        let current = leaf
        let index = leafIndex

        await this.storeNode(db, 0, index, current)

        for (let level = 1; level <= this.depth; level++) {

            const isRight = index % 2

            let left: bigint
            let right: bigint

            if (isRight) {

                left = await this.getNode(db, level - 1, index - 1)
                right = current

            } else {

                left = current
                right = await this.getNode(db, level - 1, index + 1)
            }

            current = poseidonHash([left, right])

            index = Math.floor(index / 2)

            await this.storeNode(db, level, index, current)
        }

        return current
    }
}
