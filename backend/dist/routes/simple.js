"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const blockchain_1 = require("../services/blockchain");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
const blockchain = new blockchain_1.BlockchainService();
router.post("/agents/provision", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const orgName = (0, validation_1.optionalString)(req.body.orgName, "orgName", { minLength: 2, maxLength: 120 });
        const agentName = (0, validation_1.optionalString)(req.body.agentName, "agentName", { minLength: 2, maxLength: 120 });
        const requestedOrgId = (0, validation_1.optionalInteger)(req.body.orgId, "orgId", 1);
        let resolvedOrgId = req.auth?.orgId ?? requestedOrgId;
        if (!resolvedOrgId) {
            if (!orgName) {
                return res.status(400).json({ error: "orgId or orgName is required" });
            }
            const createdOrg = await db.run(`
                INSERT INTO organizations (name)
                VALUES (?)
                `, orgName);
            resolvedOrgId = createdOrg.lastID;
        }
        const org = await db.get(`SELECT id FROM organizations WHERE id = ?`, resolvedOrgId);
        if (!org) {
            return res.status(404).json({ error: "organization not found" });
        }
        const agent = await db.run(`
            INSERT INTO agents (org_id, agent_name)
            VALUES (?, ?)
            `, resolvedOrgId, agentName ?? `Agent ${Date.now()}`);
        const agentId = agent.lastID;
        const contracts = await blockchain.ensureOrganizationContracts(db, resolvedOrgId);
        res.json({
            success: true,
            orgId: resolvedOrgId,
            agentId,
            contracts,
            next: {
                credentialRegisterUrl: `/credentials`,
                proofBundleUrl: `/proofs/${agentId}`,
                sessionSubmitUrl: `/sessions`,
                revokeUrl: `/credentials/revoke`,
                walletCreateUrl: `/wallets`
            }
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "simple.provision");
    }
});
router.get("/agents/:agentId/state", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const agent = await db.get(`SELECT * FROM agents WHERE id = ?`, agentId);
        if (!agent || (req.auth && agent.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "agent not found" });
        }
        const credential = await db.get(`SELECT * FROM credentials WHERE agent_id = ?`, agentId);
        const wallets = await db.all(`SELECT * FROM wallets WHERE agent_id = ? ORDER BY id DESC`, agentId);
        const sessions = await db.all(`SELECT * FROM sessions WHERE agent_id = ? ORDER BY id DESC`, agentId);
        const contracts = await blockchain.getOrganizationContracts(db, agent.org_id);
        const events = await db.all(`
            SELECT ce.*
            FROM contract_events ce
            LEFT JOIN wallets w ON ce.wallet_address = w.wallet_address
            WHERE w.agent_id = ?
               OR ce.session_id IN (
                    SELECT session_id
                    FROM sessions
                    WHERE agent_id = ?
               )
            ORDER BY ce.block_number DESC, ce.log_index DESC
            `, agentId, agentId);
        res.json({
            agent,
            credential,
            wallets,
            sessions,
            events,
            contracts
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "simple.agentState");
    }
});
exports.default = router;
