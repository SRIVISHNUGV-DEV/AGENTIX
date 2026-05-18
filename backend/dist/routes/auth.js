"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const auth_1 = require("../services/auth");
const blockchain_1 = require("../services/blockchain");
const auth_2 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
const auth = new auth_1.AuthService();
const blockchain = new blockchain_1.BlockchainService();
router.post("/register", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const orgName = (0, validation_1.requireString)(req.body.orgName, "orgName", { minLength: 2, maxLength: 120 });
        const name = (0, validation_1.requireString)(req.body.name, "name", { minLength: 2, maxLength: 120 });
        const email = (0, validation_1.requireEmail)(req.body.email);
        const password = (0, validation_1.requirePassword)(req.body.password);
        const existing = await db.get(`SELECT id FROM users WHERE email = ?`, email);
        if (existing) {
            return res.status(409).json({ error: "user already exists" });
        }
        const orgResult = await db.run(`INSERT INTO organizations (name) VALUES (?)`, orgName);
        const orgId = orgResult.lastID;
        await blockchain.ensureOrganizationContracts(db, orgId);
        const userResult = await db.run(`
            INSERT INTO users (org_id, email, name, password_hash, role)
            VALUES (?, ?, ?, ?, 'owner')
            `, orgId, email, name, auth.hashPassword(password));
        const session = await auth.createSession(db, userResult.lastID);
        res.json({
            success: true,
            token: session.token,
            expiresAt: session.expiresAt,
            user: {
                id: userResult.lastID,
                orgId,
                email,
                name,
                role: "owner"
            }
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "auth.register");
    }
});
router.post("/login", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const email = (0, validation_1.requireEmail)(req.body.email);
        const password = (0, validation_1.requireString)(req.body.password, "password", { minLength: 1, maxLength: 128 });
        const user = await db.get(`
            SELECT *
            FROM users
            WHERE email = ?
            `, email);
        if (!user || !auth.verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: "invalid credentials" });
        }
        const session = await auth.createSession(db, user.id);
        res.json({
            success: true,
            token: session.token,
            expiresAt: session.expiresAt,
            user: {
                id: user.id,
                orgId: user.org_id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "auth.login");
    }
});
router.post("/logout", auth_2.requireAuth, async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const header = req.headers.authorization;
        const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
        if (token) {
            await auth.revokeSession(db, token);
        }
        res.json({ success: true });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "auth.logout");
    }
});
router.get("/me", auth_2.requireAuth, async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const organization = await db.get(`SELECT * FROM organizations WHERE id = ?`, req.auth.orgId);
        res.json({
            success: true,
            user: req.auth,
            organization
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "auth.me");
    }
});
exports.default = router;
