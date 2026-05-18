"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparseRevocationTree = exports.REVOCATION_TREE_DEPTH = void 0;
exports.toRevocationKey = toRevocationKey;
const { newMemEmptyTrie } = require("circomlibjs");
exports.REVOCATION_TREE_DEPTH = 20;
const REVOCATION_KEY_SPACE = 1n << BigInt(exports.REVOCATION_TREE_DEPTH);
function toRevocationKey(secretHash) {
    return secretHash % REVOCATION_KEY_SPACE;
}
class SparseRevocationTree {
    orgId;
    constructor(orgId = 0) {
        this.orgId = orgId;
    }
    async build(db) {
        const tree = await newMemEmptyTrie();
        const entries = await db.all(`
            SELECT smt_key, revoked_value
            FROM revoked_secrets
            WHERE org_id = ?
            ORDER BY id ASC
            `, this.orgId);
        for (const entry of entries) {
            await tree.insert(BigInt(entry.smt_key), BigInt(entry.revoked_value));
        }
        return tree;
    }
    async getRoot(db) {
        const tree = await this.build(db);
        return BigInt(tree.F.toString(tree.root));
    }
    async generateProof(db, secretHash) {
        const tree = await this.build(db);
        const key = toRevocationKey(secretHash);
        const result = await tree.find(key);
        const siblings = [...result.siblings].map((sibling) => tree.F.toString(sibling));
        while (siblings.length < exports.REVOCATION_TREE_DEPTH) {
            siblings.push("0");
        }
        if (result.found) {
            return {
                key: key.toString(),
                root: tree.F.toString(tree.root),
                siblings,
                oldKey: key.toString(),
                oldValue: tree.F.toString(result.foundValue),
                isOld0: 0
            };
        }
        return {
            key: key.toString(),
            root: tree.F.toString(tree.root),
            siblings,
            oldKey: result.isOld0 ? "0" : tree.F.toString(result.notFoundKey),
            oldValue: result.isOld0 ? "0" : tree.F.toString(result.notFoundValue),
            isOld0: result.isOld0 ? 1 : 0
        };
    }
}
exports.SparseRevocationTree = SparseRevocationTree;
