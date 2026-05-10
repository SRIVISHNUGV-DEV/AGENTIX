import { poseidonHash } from "../utils/crypto"

export class IncrementalMerkleTree {

    depth:number
    zero:bigint
    nodesTable:string
    indexQuery:string
    orgId:number

    constructor(
        depth:number,
        options?:{
            nodesTable?:string,
            indexQuery?:string,
            orgId?:number
        }
    ){
        this.depth = depth
        this.zero = 0n
        this.nodesTable = options?.nodesTable ?? "merkle_tree"
        this.orgId = options?.orgId ?? 0
        this.indexQuery =
            options?.indexQuery ??
            `SELECT COALESCE(MAX(leaf_index), -1) + 1 as c FROM credentials WHERE org_id = ${this.orgId}`
    }

    async insert(db:any, leaf:bigint, leafIndex?:number){

        let current = leaf
        let index = leafIndex ?? await this.getNextLeafIndex(db)

        await this.storeNode(db,0,index,current)

        for(let level=1; level<=this.depth; level++){

            const isRight = index % 2

            let left:bigint
            let right:bigint

            if(isRight){

                left = await this.getNode(db,level-1,index-1)
                right = current

            }else{

                left = current
                right = this.zero
            }

            current = poseidonHash([left,right])

            index = Math.floor(index/2)

            await this.storeNode(db,level,index,current)
        }

        return current
    }

    async rebuildFromCredentials(db:any){

        await db.run(`DELETE FROM ${this.nodesTable} WHERE org_id = ?`, this.orgId)

        const credentials = await db.all(
            `
            SELECT leaf_index, commitment
            FROM credentials
            WHERE org_id = ?
            ORDER BY leaf_index ASC
            `,
            this.orgId
        )

        for (const credential of credentials) {
            await this.insertAt(
                db,
                credential.leaf_index,
                BigInt(credential.commitment)
            )
        }
    }

    async getRoot(db:any){

        const row = await db.get(
            `
            SELECT hash
            FROM ${this.nodesTable}
            WHERE org_id = ?
              AND level = ?
              AND node_index = 0
            `,
            this.orgId,
            this.depth
        )

        return row ? BigInt(row.hash) : 0n
    }

    async generateProof(db:any, leafIndex:number){

        const pathElements:string[]=[]
        const pathIndices:number[]=[]

        let index = leafIndex

        for(let level=0; level<this.depth; level++){

            const isRight = index % 2
            const pairIndex = isRight ? index-1 : index+1

            const sibling = await this.getNode(
                db,
                level,
                pairIndex
            )

            pathElements.push(
                sibling ? sibling.toString() : "0"
            )

            pathIndices.push(isRight)

            index = Math.floor(index/2)
        }

        return {
            pathElements,
            pathIndices
        }
    }

    async storeNode(db:any, level:number, index:number, hash:bigint){

        await db.run(
            `
            DELETE FROM ${this.nodesTable}
            WHERE org_id = ? AND level = ? AND node_index = ?
            `,
            this.orgId,
            level,
            index
        )

        await db.run(
            `
            INSERT INTO ${this.nodesTable}
            (org_id, level, node_index, hash)
            VALUES (?,?,?,?)
            `,
            this.orgId,
            level,
            index,
            hash.toString()
        )
    }

    async getNode(db:any, level:number, index:number){

        const row = await db.get(
            `
            SELECT hash
            FROM ${this.nodesTable}
            WHERE org_id = ? AND level = ? AND node_index = ?
            `,
            this.orgId,
            level,
            index
        )

        return row ? BigInt(row.hash) : this.zero
    }

    async getNextLeafIndex(db:any){

        const row = await db.get(
            this.indexQuery
        )

        return row.c
    }

    private async insertAt(db:any, leafIndex:number, leaf:bigint){

        let current = leaf
        let index = leafIndex

        await this.storeNode(db,0,index,current)

        for(let level=1; level<=this.depth; level++){

            const isRight = index % 2

            let left:bigint
            let right:bigint

            if(isRight){

                left = await this.getNode(db,level-1,index-1)
                right = current

            }else{

                left = current
                right = await this.getNode(db,level-1,index+1)
            }

            current = poseidonHash([left,right])

            index = Math.floor(index/2)

            await this.storeNode(db,level,index,current)
        }
    }
}
