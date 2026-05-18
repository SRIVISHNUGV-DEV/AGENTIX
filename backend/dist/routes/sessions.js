"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const blockchain_1 = require("../services/blockchain");
const merkle_1 = require("../services/merkle");
const revocationTree_1 = require("../services/revocationTree");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const blockchain = new blockchain_1.BlockchainService();
const router = express_1.default.Router();
router.post("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const agentId = (0, validation_1.requireInteger)(req.body.agentId, "agentId", 1);
        const sessionId = (0, validation_1.requireString)(req.body.sessionId, "sessionId", { minLength: 1, maxLength: 256 });
        const sessionKey = (0, validation_1.requireAddress)(req.body.sessionKey, "sessionKey");
        const maxValue = (0, validation_1.requireInteger)(req.body.maxValue, "maxValue", 0);
        const expiry = (0, validation_1.requireInteger)(req.body.expiry, "expiry", 1);
        const proof = (0, validation_1.requireObject)(req.body.proof, "proof");
        const publicSignals = (0, validation_1.requireArray)(req.body.publicSignals, "publicSignals");
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        const tx = await blockchain.submitSessionForOrg(db, agent.org_id, sessionId, sessionKey, maxValue, expiry, proof, publicSignals);
        await db.run(`
            INSERT INTO sessions
            (agent_id,session_id,nullifier,proof,public_signals,tx_hash)
            VALUES (?,?,?,?,?,?)
            `, agentId, sessionId, publicSignals[0], JSON.stringify(proof), JSON.stringify({
            sessionId,
            sessionKey,
            maxValue,
            expiry,
            publicSignals
        }), tx.txHash);
        res.json({
            success: true,
            txHash: tx.txHash
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "sessions.create");
    }
});
router.get("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const sessions = req.auth
            ? await db.all(`
                SELECT s.*
                FROM sessions s
                INNER JOIN agents a ON a.id = s.agent_id
                WHERE a.org_id = ?
                `, req.auth.orgId)
            : await db.all(`
                SELECT id, agent_id, session_id, nullifier, tx_hash, created_at
                FROM sessions
                `);
        res.json(sessions);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "sessions.list");
    }
});
router.get("/proof/:agentId", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const credential = await db.get(`
            SELECT leaf_index, secret_hash, org_id
            FROM credentials
            WHERE agent_id = ?
            `, agentId);
        if (!credential) {
            return res.status(404).json({
                error: "credential not found"
            });
        }
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId: credential.org_id });
        await tree.rebuildFromCredentials(db);
        const proof = await tree.generateProof(db, credential.leaf_index);
        const root = await tree.getRoot(db);
        if (!credential.secret_hash) {
            return res.status(400).json({
                error: "credential is missing secret hash"
            });
        }
        const revokedProof = await new revocationTree_1.SparseRevocationTree(credential.org_id).generateProof(db, BigInt(credential.secret_hash));
        res.json({
            activePathElements: proof.pathElements,
            activePathIndices: proof.pathIndices,
            activeRoot: root.toString(),
            revokedSiblings: revokedProof.siblings,
            revokedOldKey: revokedProof.oldKey,
            revokedOldValue: revokedProof.oldValue,
            revokedIsOld0: revokedProof.isOld0,
            revokedRoot: revokedProof.root
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "sessions.proof");
    }
});
exports.default = router;
