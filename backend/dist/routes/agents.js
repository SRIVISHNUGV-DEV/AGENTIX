"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const platform_1 = require("../services/platform");
const actionAuth_1 = require("../services/actionAuth");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
const platform = new platform_1.PlatformService();
// Wallet-only auth: Create agent requires wallet signature
router.post("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const agentName = (0, validation_1.requireString)(req.body.agentName, "agentName", { minLength: 2, maxLength: 120 });
        const orgId = (0, validation_1.requireInteger)(req.body.orgId, "orgId", 1);
        // Verify org exists
        const org = await db.get(`SELECT id, owner_wallet_address FROM organizations WHERE id = ?`, orgId);
        if (!org) {
            return res.status(404).json({ error: "organization not found" });
        }
        // Require wallet signature for agent creation
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: orgId,
            action: "CREATE_AGENT",
            target: "agent:new",
            payload: req.body ?? {}
        });
        const result = await db.run(`
            INSERT INTO agents (org_id,agent_name)
            VALUES (?,?)
            `, orgId, agentName);
        res.json({
            agentId: result.lastID
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.create");
    }
});
// List agents for an org - requires orgId in query params
// If no orgId provided, return empty array (no org context)
router.get("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const orgIdParam = req.query.orgId;
        if (!orgIdParam) {
            // No org context - return empty array
            return res.json([]);
        }
        const orgId = (0, validation_1.requireInteger)(orgIdParam, "orgId", 1);
        // Return agents for the specified org
        const agents = await db.all(`
            SELECT *
            FROM agents
            WHERE org_id = ?
            `, orgId);
        res.json(agents);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.list");
    }
});
// Wallet-only auth: Issue credential
router.post("/:agentId/credentials/issue", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        (0, validation_1.ensureBodyObject)(req.body);
        const permissions = (0, validation_1.requireInteger)(req.body.permissions, "permissions", 0);
        const expiry = (0, validation_1.requireInteger)(req.body.expiry, "expiry", 1);
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: agent.org_id,
            action: "ISSUE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await platform.issueCredential(db, agentId, permissions, expiry);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.issueCredential");
    }
});
// Wallet-only auth: Create session
router.post("/:agentId/sessions/create", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        (0, validation_1.ensureBodyObject)(req.body);
        const maxValue = (0, validation_1.optionalInteger)(req.body.maxValue, "maxValue", 0);
        const expiry = (0, validation_1.optionalInteger)(req.body.expiry, "expiry", 1);
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: agent.org_id,
            action: "CREATE_SESSION",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await platform.createSession(db, agentId, { maxValue, expiry });
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.createSession");
    }
});
// Wallet-only auth: Revoke credential
router.post("/:agentId/revoke", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: agent.org_id,
            action: "REVOKE_CREDENTIAL",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await platform.revokeCredential(db, agentId);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.revoke");
    }
});
// Wallet-only auth: Create wallet
router.post("/:agentId/wallets/create", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        (0, validation_1.ensureBodyObject)(req.body);
        const ownerAddress = (0, validation_1.optionalAddress)(req.body.ownerAddress, "ownerAddress");
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: agent.org_id,
            action: "CREATE_WALLET",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await platform.createWallet(db, agentId, ownerAddress ?? undefined);
        res.json(result);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.createWallet");
    }
});
// Wallet-only auth: Fund agent
router.post("/:agentId/fund", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const agentId = (0, validation_1.requireInteger)(req.params.agentId, "agentId", 1);
        const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
        if (!agent) {
            return res.status(404).json({ error: "agent not found" });
        }
        (0, validation_1.ensureBodyObject)(req.body);
        const amountEth = (0, validation_1.requireString)(req.body.amountEth, "amountEth", { minLength: 1, maxLength: 40 });
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: agent.org_id,
            action: "FUND_AGENT",
            target: `agent:${agentId}`,
            payload: req.body ?? {}
        });
        const result = await platform.fundAgent(db, agentId, amountEth);
        res.json({ success: true, ...result });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "agents.fund");
    }
});
exports.default = router;
