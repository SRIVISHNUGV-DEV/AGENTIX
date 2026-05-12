const { newMemEmptyTrie } = require("circomlibjs")

export const REVOCATION_TREE_DEPTH = 20
const REVOCATION_KEY_SPACE = 1n << BigInt(REVOCATION_TREE_DEPTH)

export function toRevocationKey(secretHash: bigint) {
    return secretHash % REVOCATION_KEY_SPACE
}

export class SparseRevocationTree {

    orgId:number

    constructor(orgId:number = 0){
        this.orgId = orgId
    }

    async build(db:any) {
        const tree = await newMemEmptyTrie()
        const entries = await db.all(
            `
            SELECT smt_key, revoked_value
            FROM revoked_secrets
            WHERE org_id = ?
            ORDER BY id ASC
            `,
            this.orgId
        )

        for (const entry of entries) {
            await tree.insert(
                BigInt(entry.smt_key),
                BigInt(entry.revoked_value)
            )
        }

        return tree
    }

    async getRoot(db:any) {
        const tree = await this.build(db)
        return BigInt(tree.F.toString(tree.root))
    }

    async generateProof(db:any, secretHash:bigint) {
        const tree = await this.build(db)
        const key = toRevocationKey(secretHash)
        const result = await tree.find(key)
        const siblings = [...result.siblings].map((sibling:any) => tree.F.toString(sibling))

        while (siblings.length < REVOCATION_TREE_DEPTH) {
            siblings.push("0")
        }

        if (result.found) {
            return {
                key: key.toString(),
                root: tree.F.toString(tree.root),
                siblings,
                oldKey: key.toString(),
                oldValue: tree.F.toString(result.foundValue),
                isOld0: 0
            }
        }

        return {
            key: key.toString(),
            root: tree.F.toString(tree.root),
            siblings,
            oldKey: result.isOld0 ? "0" : tree.F.toString(result.notFoundKey),
            oldValue: result.isOld0 ? "0" : tree.F.toString(result.notFoundValue),
            isOld0: result.isOld0 ? 1 : 0
        }
    }
}
