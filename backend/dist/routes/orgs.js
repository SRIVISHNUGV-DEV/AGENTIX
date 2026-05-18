"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const blockchain_1 = require("../services/blockchain");
const platform_1 = require("../services/platform");
const actionAuth_1 = require("../services/actionAuth");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
const blockchain = new blockchain_1.BlockchainService();
const platform = new platform_1.PlatformService();
router.post("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const name = (0, validation_1.requireString)(req.body.name, "name", { minLength: 2, maxLength: 120 });
        // Require wallet signature for org creation
        const signatureResult = await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: 0, // New org, no ID yet
            action: "CREATE_ORG",
            target: "org:new",
            payload: req.body ?? {}
        });
        // Use signer's wallet address as owner
        const ownerWalletAddress = signatureResult.walletAddress;
        const result = await db.run(`
            INSERT INTO organizations (name, owner_wallet_address)
            VALUES (?,?)
            `, name, ownerWalletAddress);
        res.json({
            id: result.lastID,
            name,
            ownerWalletAddress
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "orgs.create");
    }
});
router.get("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        // Public endpoint - no auth required
        const orgs = await db.all("SELECT id, name, owner_wallet_address, created_at FROM organizations");
        res.json(orgs);
    }
    catch (error) {
        console.error("[orgs.list] Error:", error);
        (0, errors_1.respondWithError)(res, error, "orgs.list");
    }
});
router.post("/:orgId/deploy-contracts", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = (0, validation_1.requireInteger)(req.params.orgId, "orgId", 1);
        const org = await db.get(`SELECT * FROM organizations WHERE id = ?`, orgId);
        if (!org) {
            return res.status(404).json({ error: "organization not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "DEPLOY_CONTRACTS",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        });
        const force = Boolean(req.body?.force);
        const contracts = await blockchain.deployOrganizationContracts(db, orgId, { force });
        res.json({
            success: true,
            organization: org,
            contracts,
            redeployed: force
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "orgs.deployContracts");
    }
});
router.get("/:orgId/state", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = (0, validation_1.requireInteger)(req.params.orgId, "orgId", 1);
        const organization = await db.get(`SELECT * FROM organizations WHERE id = ?`, orgId);
        if (!organization) {
            return res.status(404).json({ error: "organization not found" });
        }
        const contracts = await db.get(`SELECT * FROM organization_contracts WHERE org_id = ?`, orgId);
        const agents = await db.all(`SELECT * FROM agents WHERE org_id = ? ORDER BY id DESC`, orgId);
        const wallets = await db.all(`SELECT * FROM wallets WHERE org_id = ? ORDER BY id DESC`, orgId);
        const sessions = await db.all(`
            SELECT s.*
            FROM sessions s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE a.org_id = ?
            ORDER BY s.id DESC
            `, orgId);
        const events = await db.all(`
            SELECT *
            FROM contract_events
            WHERE org_id = ?
            ORDER BY block_number DESC, log_index DESC
            LIMIT 200
            `, orgId);
        res.json({
            organization,
            contracts,
            agents,
            wallets,
            sessions,
            events
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "orgs.state");
    }
});
router.post("/:orgId/fund", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgId = (0, validation_1.requireInteger)(req.params.orgId, "orgId", 1);
        (0, validation_1.ensureBodyObject)(req.body);
        const amountEth = (0, validation_1.requireString)(req.body.amountEth, "amountEth", { minLength: 1, maxLength: 40 });
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "FUND_ORG",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        });
        const result = await platform.fundOrganization(db, orgId, amountEth);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "orgs.fund");
    }
});
router.delete("/:orgId", async (req, res) => {
    let db = null;
    try {
        db = await (0, db_1.initDB)();
        const orgId = (0, validation_1.requireInteger)(req.params.orgId, "orgId", 1);
        const org = await db.get(`SELECT * FROM organizations WHERE id = ?`, orgId);
        if (!org) {
            return res.status(404).json({ error: "organization not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId,
            action: "DELETE_ORG",
            target: `org:${orgId}`,
            payload: req.body ?? {}
        });
        await db.exec("BEGIN");
        await db.run(`DELETE FROM action_authorizations WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM contract_events WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM wallets WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM revoked_merkle_tree WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM revoked_secrets WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM merkle_tree WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM organization_contracts WHERE org_id = ?`, orgId);
        await db.run(`
            DELETE FROM sessions
            WHERE agent_id IN (SELECT id FROM agents WHERE org_id = ?)
            `, orgId);
        await db.run(`DELETE FROM credentials WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM agents WHERE org_id = ?`, orgId);
        await db.run(`DELETE FROM users WHERE org_id = ?`, orgId);
        await db.run(`
            DELETE FROM auth_sessions
            WHERE user_id NOT IN (SELECT id FROM users)
            `);
        await db.run(`DELETE FROM organizations WHERE id = ?`, orgId);
        await db.exec("COMMIT");
        res.json({
            success: true,
            orgId
        });
    }
    catch (error) {
        try {
            if (db) {
                await db.exec("ROLLBACK");
            }
        }
        catch { }
        (0, errors_1.respondWithError)(res, error, "orgs.delete");
    }
});
exports.default = router;
