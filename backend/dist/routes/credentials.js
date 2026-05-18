"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const merkle_1 = require("../services/merkle");
const blockchain_1 = require("../services/blockchain");
const revocationTree_1 = require("../services/revocationTree");
// FLAW 13 FIX: Import audit logging
const audit_1 = require("../services/audit");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
// FLAW 10 FIX: Use singleton blockchain service
const blockchain = (0, blockchain_1.getBlockchainService)();
router.post("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const agentId = (0, validation_1.requireInteger)(req.body.agentId, "agentId", 1);
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        const permissions = (0, validation_1.requireInteger)(req.body.permissions, "permissions", 0);
        const expiry = (0, validation_1.requireInteger)(req.body.expiry, "expiry", 1);
        const commitment = (0, validation_1.requireString)(req.body.commitment, "commitment", { minLength: 1, maxLength: 256 });
        const secretHash = req.body.secretHash === undefined || req.body.secretHash === null
            ? null
            : (0, validation_1.requireString)(req.body.secretHash, "secretHash", { minLength: 1, maxLength: 256 });
        const existing = await db.get(`
            SELECT id
            FROM credentials
            WHERE agent_id = ?
            `, agentId);
        if (existing) {
            return res.status(409).json({
                error: "credential already exists for agent"
            });
        }
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId });
        const leafIndex = await tree.getNextLeafIndex(db);
        await db.run(`
            INSERT INTO credentials
            (agent_id,org_id,permissions,expiry,commitment,secret_hash,leaf_index)
            VALUES (?,?,?,?,?,?,?)
            `, agentId, orgId, permissions, expiry, commitment, secretHash, leafIndex);
        await tree.insert(db, BigInt(commitment), leafIndex);
        await tree.rebuildFromCredentials(db);
        const root = await tree.getRoot(db);
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`;
        await blockchain.updateActiveRootForOrg(db, orgId, rootHex);
        // FLAW 13 FIX: Audit logging for credential issuance
        await (0, audit_1.logAuditEvent)({
            orgId,
            action: "credential.issue",
            resourceType: "credential",
            resourceId: String(agentId),
            details: { agentId, permissions, expiry, leafIndex },
            ipAddress: (0, audit_1.extractClientIP)(req.headers),
            userAgent: (0, audit_1.extractUserAgent)(req.headers)
        });
        res.json({
            success: true,
            leafIndex,
            root: root.toString(),
            rootHex
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "credentials.issue");
    }
});
router.get("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const creds = req.auth
            ? await db.all(`
                SELECT *
                FROM credentials
                WHERE org_id = ?
                ORDER BY leaf_index ASC
                `, req.auth.orgId)
            : await db.all(`
                SELECT id, agent_id, org_id, permissions, expiry, leaf_index, created_at
                FROM credentials
                ORDER BY leaf_index ASC
                `);
        res.json(creds);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "credentials.list");
    }
});
router.post("/revoke", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const agentId = (0, validation_1.requireInteger)(req.body.agentId, "agentId", 1);
        const secretHash = (0, validation_1.requireString)(req.body.secretHash, "secretHash", { minLength: 1, maxLength: 256 });
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        const orgId = agent.org_id;
        const revocationTree = new revocationTree_1.SparseRevocationTree(orgId);
        const existing = await db.get(`
            SELECT id
            FROM revoked_secrets
            WHERE org_id = ? AND secret_hash = ?
            `, orgId, secretHash);
        if (existing) {
            return res.status(409).json({
                error: "secret already revoked"
            });
        }
        const smtKey = (0, revocationTree_1.toRevocationKey)(BigInt(secretHash)).toString();
        const existingKey = await db.get(`
            SELECT secret_hash
            FROM revoked_secrets
            WHERE org_id = ? AND smt_key = ?
            `, orgId, smtKey);
        if (existingKey && existingKey.secret_hash !== secretHash) {
            return res.status(409).json({
                error: "revocation key collision"
            });
        }
        const leafIndex = (await db.get("SELECT COALESCE(MAX(leaf_index), -1) + 1 as c FROM revoked_secrets")).c;
        await db.run(`
            INSERT INTO revoked_secrets
            (agent_id,org_id,secret_hash,smt_key,revoked_value,leaf_index)
            VALUES (?,?,?,?,?,?)
            `, agentId, orgId, secretHash, smtKey, 1, leafIndex);
        const root = await revocationTree.getRoot(db);
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`;
        await blockchain.updateRevokedRootForOrg(db, orgId, rootHex);
        // FLAW 13 FIX: Audit logging for credential revocation
        await (0, audit_1.logAuditEvent)({
            orgId,
            action: "credential.revoke",
            resourceType: "credential",
            resourceId: String(agentId),
            details: { agentId, leafIndex },
            ipAddress: (0, audit_1.extractClientIP)(req.headers),
            userAgent: (0, audit_1.extractUserAgent)(req.headers)
        });
        res.json({
            success: true,
            leafIndex,
            root: root.toString(),
            rootHex
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "credentials.revoke");
    }
});
exports.default = router;
