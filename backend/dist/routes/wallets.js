"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ethers_1 = require("ethers");
const db_1 = require("../db");
const actionAuth_1 = require("../services/actionAuth");
const blockchain_1 = require("../services/blockchain");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
const blockchain = new blockchain_1.BlockchainService();
const walletInterface = new ethers_1.ethers.Interface(blockchain.getWalletAbi());
router.post("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        (0, validation_1.ensureBodyObject)(req.body);
        const ownerAddress = (0, validation_1.requireAddress)(req.body.ownerAddress, "ownerAddress");
        const agentId = (0, validation_1.optionalInteger)(req.body.agentId, "agentId", 1);
        let orgId = null;
        if (agentId !== undefined) {
            const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId);
            if (!agent) {
                return res.status(404).json({ error: "agent not found" });
            }
            orgId = agent.org_id;
        }
        const wallet = await blockchain.createWalletForOrg(db, orgId ?? 0, ownerAddress);
        await db.run(`
            INSERT INTO wallets
            (
                agent_id,
                org_id,
                owner_address,
                wallet_address,
                session_manager_address,
                implementation_address,
                entry_point_address,
                factory_salt,
                wallet_kind
            )
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                agent_id = COALESCE(wallets.agent_id, excluded.agent_id),
                org_id = COALESCE(wallets.org_id, excluded.org_id),
                owner_address = excluded.owner_address,
                session_manager_address = excluded.session_manager_address,
                implementation_address = COALESCE(excluded.implementation_address, wallets.implementation_address),
                entry_point_address = COALESCE(excluded.entry_point_address, wallets.entry_point_address),
                factory_salt = COALESCE(excluded.factory_salt, wallets.factory_salt),
                wallet_kind = COALESCE(excluded.wallet_kind, wallets.wallet_kind)
            `, agentId ?? null, orgId, ownerAddress, wallet.walletAddress, wallet.sessionManagerAddress, wallet.implementationAddress ?? null, wallet.entryPointAddress ?? null, wallet.factorySalt ?? null, wallet.walletKind ?? "erc4337");
        res.json({
            success: true,
            ...wallet
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.create");
    }
});
router.get("/", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const wallets = req.auth
            ? await db.all(`
                SELECT *
                FROM wallets
                WHERE org_id = ?
                ORDER BY id DESC
                `, req.auth.orgId)
            : await db.all(`
                SELECT id, agent_id, org_id, owner_address, wallet_address, session_manager_address, implementation_address, entry_point_address, factory_salt, wallet_kind, created_at
                FROM wallets
                ORDER BY id DESC
                `);
        res.json(wallets);
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.list");
    }
});
router.post("/:walletAddress/userop/prepare", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        const wallet = await db.get(`
            SELECT *
            FROM wallets
            WHERE wallet_address = ?
            `, walletAddress);
        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "wallet not found" });
        }
        (0, validation_1.ensureBodyObject)(req.body);
        let callData;
        if (req.body.calls !== undefined) {
            const calls = (0, validation_1.requireArray)(req.body.calls, "calls");
            if (calls.length === 0) {
                return res.status(400).json({ error: "calls must not be empty" });
            }
            const targets = [];
            const values = [];
            const payloads = [];
            for (let index = 0; index < calls.length; index++) {
                const call = (0, validation_1.requireObject)(calls[index], `calls[${index}]`);
                targets.push((0, validation_1.requireAddress)(call.target, `calls[${index}].target`));
                values.push(BigInt((0, validation_1.requireString)(call.valueWei ?? "0", `calls[${index}].valueWei`, { maxLength: 78 })));
                payloads.push((0, validation_1.requireHex)(call.data ?? "0x", `calls[${index}].data`));
            }
            callData = walletInterface.encodeFunctionData("executeBatch", [targets, values, payloads]);
        }
        else {
            const target = (0, validation_1.requireAddress)(req.body.target, "target");
            const valueWei = BigInt((0, validation_1.requireString)(req.body.valueWei ?? "0", "valueWei", { maxLength: 78 }));
            const data = (0, validation_1.requireHex)(req.body.data ?? "0x", "data");
            callData = walletInterface.encodeFunctionData("execute", [target, valueWei, data]);
        }
        const initCode = req.body.initCode === undefined ? "0x" : (0, validation_1.requireHex)(req.body.initCode, "initCode");
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: wallet.org_id,
            action: "PREPARE_USER_OPERATION",
            target: `wallet:${walletAddress}`,
            payload: req.body ?? {}
        });
        const prepared = await blockchain.prepareUserOperationForWallet(db, walletAddress, callData, initCode);
        res.json({
            success: true,
            ...prepared
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.prepareUserOperation");
    }
});
router.post("/:walletAddress/userop/submit", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        const wallet = await db.get(`
            SELECT *
            FROM wallets
            WHERE wallet_address = ?
            `, walletAddress);
        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "wallet not found" });
        }
        (0, validation_1.ensureBodyObject)(req.body);
        const userOp = (0, validation_1.requireObject)(req.body.userOp, "userOp");
        const entryPointAddress = (0, validation_1.requireAddress)(req.body.entryPointAddress ?? wallet.entry_point_address, "entryPointAddress");
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: wallet.org_id,
            action: "SUBMIT_USER_OPERATION",
            target: `wallet:${walletAddress}`,
            payload: req.body ?? {}
        });
        const result = await blockchain.submitUserOperation({
            sender: (0, validation_1.requireAddress)(userOp.sender, "userOp.sender"),
            nonce: (0, validation_1.requireHex)(userOp.nonce, "userOp.nonce"),
            initCode: (0, validation_1.requireHex)(userOp.initCode ?? "0x", "userOp.initCode"),
            callData: (0, validation_1.requireHex)(userOp.callData, "userOp.callData"),
            accountGasLimits: (0, validation_1.requireHex)(userOp.accountGasLimits, "userOp.accountGasLimits", { minBytes: 32, maxBytes: 32 }),
            preVerificationGas: (0, validation_1.requireHex)(userOp.preVerificationGas, "userOp.preVerificationGas"),
            gasFees: (0, validation_1.requireHex)(userOp.gasFees, "userOp.gasFees", { minBytes: 32, maxBytes: 32 }),
            paymasterAndData: (0, validation_1.requireHex)(userOp.paymasterAndData ?? "0x", "userOp.paymasterAndData"),
            signature: (0, validation_1.requireHex)(userOp.signature, "userOp.signature")
        }, entryPointAddress);
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.submitUserOperation");
    }
});
router.get("/userops/:userOpHash", async (_req, res) => {
    try {
        const userOpHash = (0, validation_1.requireHex)(_req.params.userOpHash, "userOpHash", { minBytes: 32, maxBytes: 32 });
        const entryPointAddress = _req.query.entryPointAddress
            ? (0, validation_1.requireAddress)(_req.query.entryPointAddress, "entryPointAddress")
            : undefined;
        const receipt = await blockchain.getUserOperationReceipt(userOpHash, entryPointAddress);
        res.json({
            success: true,
            receipt
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.getUserOperationReceipt");
    }
});
// Whitelist management routes
// Get whitelisted parties for a wallet
router.get("/:walletAddress/whitelist", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" });
        }
        const whitelistedParties = await blockchain.getWhitelistedParties(walletAddress, db);
        res.json({
            success: true,
            walletAddress,
            whitelistedParties
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.getWhitelist");
    }
});
// Add address to whitelist
router.post("/:walletAddress/whitelist", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        (0, validation_1.ensureBodyObject)(req.body);
        const party = (0, validation_1.requireAddress)(req.body.party, "party");
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: wallet.org_id,
            action: "ADD_WHITELIST",
            target: `wallet:${walletAddress}`,
            payload: req.body
        });
        // Store in database first (for immediate UI feedback)
        // On-chain update requires wallet owner - skip if not available
        let txHash;
        try {
            const result = await blockchain.setWhitelistedParty(walletAddress, party, true);
            txHash = result.txHash;
        }
        catch (blockchainError) {
            console.log(`[addWhitelist] Blockchain call skipped: ${blockchainError.message}`);
        }
        // Store in database for quick lookups (bypasses Alchemy event query limits)
        await db.run(`INSERT INTO wallet_whitelist (wallet_address, address, is_active)
             VALUES (?, ?, 1)
             ON CONFLICT(wallet_address, address) DO UPDATE SET is_active = 1`, walletAddress.toLowerCase(), party.toLowerCase());
        res.json({
            success: true,
            walletAddress,
            party,
            added: true,
            txHash: txHash || null
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.addWhitelist");
    }
});
// Remove address from whitelist
router.delete("/:walletAddress/whitelist/:party", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        const party = (0, validation_1.requireAddress)(req.params.party, "party");
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: wallet.org_id,
            action: "REMOVE_WHITELIST",
            target: `wallet:${walletAddress}`,
            payload: req.body
        });
        // On-chain update requires wallet owner - skip if not available
        let txHash;
        try {
            const result = await blockchain.setWhitelistedParty(walletAddress, party, false);
            txHash = result.txHash;
        }
        catch (blockchainError) {
            console.log(`[removeWhitelist] Blockchain call skipped: ${blockchainError.message}`);
        }
        // Update database to mark as inactive
        await db.run(`UPDATE wallet_whitelist SET is_active = 0 WHERE wallet_address = ? AND address = ?`, walletAddress.toLowerCase(), party.toLowerCase());
        res.json({
            success: true,
            walletAddress,
            party,
            removed: true,
            txHash: txHash || null
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.removeWhitelist");
    }
});
// Batch add/remove whitelisted addresses
router.post("/:walletAddress/whitelist/batch", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        (0, validation_1.ensureBodyObject)(req.body);
        const parties = req.body.parties;
        const statuses = req.body.statuses;
        if (!Array.isArray(parties) || !Array.isArray(statuses)) {
            return res.status(400).json({ error: "parties and statuses must be arrays" });
        }
        if (parties.length !== statuses.length) {
            return res.status(400).json({ error: "parties and statuses must have same length" });
        }
        if (parties.length === 0) {
            return res.status(400).json({ error: "At least one party required" });
        }
        // Validate all addresses
        for (const party of parties) {
            (0, validation_1.requireAddress)(party, "party");
        }
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" });
        }
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: wallet.org_id,
            action: "BATCH_WHITELIST",
            target: `wallet:${walletAddress}`,
            payload: req.body
        });
        // Store in database first (for immediate UI feedback)
        // Note: On-chain whitelist update requires the wallet owner to execute
        // For now, we store in database and skip the on-chain transaction
        // In production, this would use ERC-4337 userOps or direct owner transaction
        let txHash;
        try {
            const result = await blockchain.setWhitelistedPartyBatch(walletAddress, parties, statuses);
            txHash = result.txHash;
        }
        catch (blockchainError) {
            // If blockchain call fails (e.g., not owner), still store in database
            console.log(`[batchWhitelist] Blockchain call skipped: ${blockchainError.message}`);
        }
        // Store all in database for quick lookups
        for (let i = 0; i < parties.length; i++) {
            const party = parties[i];
            const status = statuses[i];
            if (status) {
                await db.run(`INSERT INTO wallet_whitelist (wallet_address, address, is_active)
                     VALUES (?, ?, 1)
                     ON CONFLICT(wallet_address, address) DO UPDATE SET is_active = 1`, walletAddress.toLowerCase(), party.toLowerCase());
            }
            else {
                await db.run(`UPDATE wallet_whitelist SET is_active = 0 WHERE wallet_address = ? AND address = ?`, walletAddress.toLowerCase(), party.toLowerCase());
            }
        }
        res.json({
            success: true,
            walletAddress,
            parties,
            statuses,
            txHash: txHash || null,
            stored: true,
            note: txHash ? "Stored on-chain and in database" : "Stored in database (on-chain update requires wallet owner)"
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.batchWhitelist");
    }
});
// ============================================
// Gas Deposit Endpoints
// ============================================
/**
 * GET /wallets/:walletAddress/entrypoint-balance
 * Get the EntryPoint balance for the agent wallet (gas funds)
 */
router.get("/:walletAddress/entrypoint-balance", async (req, res) => {
    try {
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        const balance = await blockchain.getEntryPointBalance(walletAddress);
        res.json({
            walletAddress,
            balance: ethers_1.ethers.formatEther(balance),
            balanceWei: balance.toString()
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.getEntryPointBalance");
    }
});
/**
 * POST /wallets/:walletAddress/deposit-gas
 * Deposit ETH to the EntryPoint for the agent wallet
 *
 * The owner wallet signs a request to deposit ETH to the EntryPoint.
 * This funds the agent's smart account for gas payment during execution.
 *
 * Body: { amount: string }  // ETH amount
 */
router.post("/:walletAddress/deposit-gas", async (req, res) => {
    try {
        const db = await (0, db_1.initDB)();
        const walletAddress = (0, validation_1.requireAddress)(req.params.walletAddress, "walletAddress");
        (0, validation_1.ensureBodyObject)(req.body);
        const amount = (0, validation_1.requireString)(req.body.amount, "amount");
        const amountWei = ethers_1.ethers.parseEther(amount);
        // Get wallet info
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet) {
            return res.status(404).json({ error: "Wallet not found" });
        }
        // Require signed action for security
        await (0, actionAuth_1.requireSignedAction)(db, {
            orgId: wallet.org_id,
            action: "DEPOSIT_GAS",
            target: `wallet:${walletAddress}`,
            payload: req.body
        });
        // Execute deposit to EntryPoint
        const result = await blockchain.depositToEntryPoint(walletAddress, amountWei);
        res.json({
            success: true,
            walletAddress,
            amount,
            amountWei: amountWei.toString(),
            txHash: result.txHash,
            newBalance: result.newBalance
        });
    }
    catch (error) {
        (0, errors_1.respondWithError)(res, error, "wallets.depositGas");
    }
});
exports.default = router;
