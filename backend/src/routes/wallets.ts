import express from "express"
import { ethers } from "ethers"
import { initDB } from "../db"
import { requireSignedAction } from "../services/actionAuth"
import { BlockchainService } from "../services/blockchain"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import {
    ensureBodyObject,
    optionalInteger,
    requireAddress,
    requireArray,
    requireHex,
    requireObject,
    requireString
} from "../utils/validation"

const router = express.Router()
const blockchain = new BlockchainService()
const walletInterface = new ethers.Interface(blockchain.getWalletAbi())

router.post("/", async (req,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const ownerAddress = requireAddress(req.body.ownerAddress, "ownerAddress")
        const agentId = optionalInteger(req.body.agentId, "agentId", 1)

        let orgId:number | null = null
        if(agentId !== undefined){
            const agent = await db.get(`SELECT org_id FROM agents WHERE id = ?`, agentId)
            if(!agent){
                return res.status(404).json({ error:"agent not found" })
            }
            orgId = agent.org_id
        }

        const wallet = await blockchain.createWalletForOrg(
            db,
            orgId ?? 0,
            ownerAddress
        )

        await db.run(
            `
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
            `,
            agentId ?? null,
            orgId,
            ownerAddress,
            wallet.walletAddress,
            wallet.sessionManagerAddress,
            wallet.implementationAddress ?? null,
            wallet.entryPointAddress ?? null,
            wallet.factorySalt ?? null,
            wallet.walletKind ?? "erc4337"
        )

        res.json({
            success:true,
            ...wallet
        })
    }catch(error){
        respondWithError(res, error, "wallets.create")
    }
})

router.get("/", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const wallets = req.auth
            ? await db.all(
                `
                SELECT *
                FROM wallets
                WHERE org_id = ?
                ORDER BY id DESC
                `,
                req.auth.orgId
            )
            : await db.all(
                `
                SELECT id, agent_id, org_id, owner_address, wallet_address, session_manager_address, implementation_address, entry_point_address, factory_salt, wallet_kind, created_at
                FROM wallets
                ORDER BY id DESC
                `
            )

        res.json(wallets)
    }catch(error){
        respondWithError(res, error, "wallets.list")
    }
})

router.post("/:walletAddress/userop/prepare", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")
        const wallet = await db.get(
            `
            SELECT *
            FROM wallets
            WHERE wallet_address = ?
            `,
            walletAddress
        )

        if(!wallet || (req.auth && wallet.org_id !== req.auth.orgId)){
            return res.status(404).json({ error:"wallet not found" })
        }

        ensureBodyObject(req.body)

        let callData:string
        if(req.body.calls !== undefined){
            const calls = requireArray(req.body.calls, "calls")
            if(calls.length === 0){
                return res.status(400).json({ error:"calls must not be empty" })
            }

            const targets:string[] = []
            const values:bigint[] = []
            const payloads:string[] = []

            for(let index = 0; index < calls.length; index++){
                const call = requireObject(calls[index], `calls[${index}]`)
                targets.push(requireAddress(call.target, `calls[${index}].target`))
                values.push(BigInt(requireString(call.valueWei ?? "0", `calls[${index}].valueWei`, { maxLength: 78 })))
                payloads.push(requireHex(call.data ?? "0x", `calls[${index}].data`))
            }

            callData = walletInterface.encodeFunctionData("executeBatch", [targets, values, payloads])
        }else{
            const target = requireAddress(req.body.target, "target")
            const valueWei = BigInt(requireString(req.body.valueWei ?? "0", "valueWei", { maxLength: 78 }))
            const data = requireHex(req.body.data ?? "0x", "data")
            callData = walletInterface.encodeFunctionData("execute", [target, valueWei, data])
        }

        const initCode = req.body.initCode === undefined ? "0x" : requireHex(req.body.initCode, "initCode")

        await requireSignedAction(db, {
            orgId: wallet.org_id,
            action: "PREPARE_USER_OPERATION",
            target: `wallet:${walletAddress}`,
            payload: req.body ?? {}
        })

        const prepared = await blockchain.prepareUserOperationForWallet(
            db,
            walletAddress,
            callData,
            initCode
        )

        res.json({
            success:true,
            ...prepared
        })
    }catch(error){
        respondWithError(res, error, "wallets.prepareUserOperation")
    }
})

router.post("/:walletAddress/userop/submit", async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")
        const wallet = await db.get(
            `
            SELECT *
            FROM wallets
            WHERE wallet_address = ?
            `,
            walletAddress
        )

        if(!wallet || (req.auth && wallet.org_id !== req.auth.orgId)){
            return res.status(404).json({ error:"wallet not found" })
        }

        ensureBodyObject(req.body)
        const userOp = requireObject(req.body.userOp, "userOp")
        const entryPointAddress = requireAddress(
            req.body.entryPointAddress ?? wallet.entry_point_address,
            "entryPointAddress"
        )

        await requireSignedAction(db, {
            orgId: wallet.org_id,
            action: "SUBMIT_USER_OPERATION",
            target: `wallet:${walletAddress}`,
            payload: req.body ?? {}
        })

        const result = await blockchain.submitUserOperation(
            {
                sender: requireAddress(userOp.sender, "userOp.sender"),
                nonce: requireHex(userOp.nonce, "userOp.nonce"),
                initCode: requireHex(userOp.initCode ?? "0x", "userOp.initCode"),
                callData: requireHex(userOp.callData, "userOp.callData"),
                accountGasLimits: requireHex(userOp.accountGasLimits, "userOp.accountGasLimits", { minBytes: 32, maxBytes: 32 }),
                preVerificationGas: requireHex(userOp.preVerificationGas, "userOp.preVerificationGas"),
                gasFees: requireHex(userOp.gasFees, "userOp.gasFees", { minBytes: 32, maxBytes: 32 }),
                paymasterAndData: requireHex(userOp.paymasterAndData ?? "0x", "userOp.paymasterAndData"),
                signature: requireHex(userOp.signature, "userOp.signature")
            },
            entryPointAddress
        )

        res.json({
            success:true,
            ...result
        })
    }catch(error){
        respondWithError(res, error, "wallets.submitUserOperation")
    }
})

router.get("/userops/:userOpHash", async (_req:AuthRequest,res)=>{
    try{
        const userOpHash = requireHex(_req.params.userOpHash, "userOpHash", { minBytes: 32, maxBytes: 32 })
        const entryPointAddress = _req.query.entryPointAddress
            ? requireAddress(_req.query.entryPointAddress, "entryPointAddress")
            : undefined

        const receipt = await blockchain.getUserOperationReceipt(userOpHash, entryPointAddress)
        res.json({
            success:true,
            receipt
        })
    }catch(error){
        respondWithError(res, error, "wallets.getUserOperationReceipt")
    }
})

// Whitelist management routes

// Get whitelisted parties for a wallet
router.get("/:walletAddress/whitelist", async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")

        const wallet = await db.get(
            `SELECT * FROM wallets WHERE wallet_address = ?`,
            walletAddress
        )

        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" })
        }

        const whitelistedParties = await blockchain.getWhitelistedParties(walletAddress, db)

        res.json({
            success: true,
            walletAddress,
            whitelistedParties
        })
    } catch (error) {
        respondWithError(res, error, "wallets.getWhitelist")
    }
})

// Add address to whitelist
router.post("/:walletAddress/whitelist", async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")

        ensureBodyObject(req.body)
        const party = requireAddress(req.body.party, "party")

        const wallet = await db.get(
            `SELECT * FROM wallets WHERE wallet_address = ?`,
            walletAddress
        )

        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" })
        }

        await requireSignedAction(db, {
            orgId: wallet.org_id,
            action: "ADD_WHITELIST",
            target: `wallet:${walletAddress}`,
            payload: req.body
        })

        // Store in database first (for immediate UI feedback)
        // On-chain update requires wallet owner - skip if not available
        let txHash: string | undefined
        try {
            const result = await blockchain.setWhitelistedParty(walletAddress, party, true)
            txHash = result.txHash
        } catch (blockchainError: any) {
            console.log(`[addWhitelist] Blockchain call skipped: ${blockchainError.message}`)
        }

        // Store in database for quick lookups (bypasses Alchemy event query limits)
        await db.run(
            `INSERT INTO wallet_whitelist (wallet_address, address, is_active)
             VALUES (?, ?, 1)
             ON CONFLICT(wallet_address, address) DO UPDATE SET is_active = 1`,
            walletAddress.toLowerCase(),
            party.toLowerCase()
        )

        res.json({
            success: true,
            walletAddress,
            party,
            added: true,
            txHash: txHash || null
        })
    } catch (error) {
        respondWithError(res, error, "wallets.addWhitelist")
    }
})

// Remove address from whitelist
router.delete("/:walletAddress/whitelist/:party", async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")
        const party = requireAddress(req.params.party, "party")

        const wallet = await db.get(
            `SELECT * FROM wallets WHERE wallet_address = ?`,
            walletAddress
        )

        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" })
        }

        await requireSignedAction(db, {
            orgId: wallet.org_id,
            action: "REMOVE_WHITELIST",
            target: `wallet:${walletAddress}`,
            payload: req.body
        })

        // On-chain update requires wallet owner - skip if not available
        let txHash: string | undefined
        try {
            const result = await blockchain.setWhitelistedParty(walletAddress, party, false)
            txHash = result.txHash
        } catch (blockchainError: any) {
            console.log(`[removeWhitelist] Blockchain call skipped: ${blockchainError.message}`)
        }

        // Update database to mark as inactive
        await db.run(
            `UPDATE wallet_whitelist SET is_active = 0 WHERE wallet_address = ? AND address = ?`,
            walletAddress.toLowerCase(),
            party.toLowerCase()
        )

        res.json({
            success: true,
            walletAddress,
            party,
            removed: true,
            txHash: txHash || null
        })
    } catch (error) {
        respondWithError(res, error, "wallets.removeWhitelist")
    }
})

// Batch add/remove whitelisted addresses
router.post("/:walletAddress/whitelist/batch", async (req: AuthRequest, res) => {
    try {
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")

        ensureBodyObject(req.body)
        const parties = req.body.parties
        const statuses = req.body.statuses

        if (!Array.isArray(parties) || !Array.isArray(statuses)) {
            return res.status(400).json({ error: "parties and statuses must be arrays" })
        }
        if (parties.length !== statuses.length) {
            return res.status(400).json({ error: "parties and statuses must have same length" })
        }
        if (parties.length === 0) {
            return res.status(400).json({ error: "At least one party required" })
        }

        // Validate all addresses
        for (const party of parties) {
            requireAddress(party, "party")
        }

        const wallet = await db.get(
            `SELECT * FROM wallets WHERE wallet_address = ?`,
            walletAddress
        )

        if (!wallet || (req.auth && wallet.org_id !== req.auth.orgId)) {
            return res.status(404).json({ error: "Wallet not found" })
        }

        await requireSignedAction(db, {
            orgId: wallet.org_id,
            action: "BATCH_WHITELIST",
            target: `wallet:${walletAddress}`,
            payload: req.body
        })

        // Store in database first (for immediate UI feedback)
        // Note: On-chain whitelist update requires the wallet owner to execute
        // For now, we store in database and skip the on-chain transaction
        // In production, this would use ERC-4337 userOps or direct owner transaction
        let txHash: string | undefined
        try {
            const result = await blockchain.setWhitelistedPartyBatch(walletAddress, parties, statuses)
            txHash = result.txHash
        } catch (blockchainError: any) {
            // If blockchain call fails (e.g., not owner), still store in database
            console.log(`[batchWhitelist] Blockchain call skipped: ${blockchainError.message}`)
        }

        // Store all in database for quick lookups
        for (let i = 0; i < parties.length; i++) {
            const party = parties[i]
            const status = statuses[i]
            if (status) {
                await db.run(
                    `INSERT INTO wallet_whitelist (wallet_address, address, is_active)
                     VALUES (?, ?, 1)
                     ON CONFLICT(wallet_address, address) DO UPDATE SET is_active = 1`,
                    walletAddress.toLowerCase(),
                    party.toLowerCase()
                )
            } else {
                await db.run(
                    `UPDATE wallet_whitelist SET is_active = 0 WHERE wallet_address = ? AND address = ?`,
                    walletAddress.toLowerCase(),
                    party.toLowerCase()
                )
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
        })
    } catch (error) {
        respondWithError(res, error, "wallets.batchWhitelist")
    }
})

// ============================================
// Gas Deposit Endpoints
// ============================================

/**
 * GET /wallets/:walletAddress/entrypoint-balance
 * Get the EntryPoint balance for the agent wallet (gas funds)
 */
router.get("/:walletAddress/entrypoint-balance", async (req: express.Request, res: express.Response) => {
    try {
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")

        const balance = await blockchain.getEntryPointBalance(walletAddress)

        res.json({
            walletAddress,
            balance: ethers.formatEther(balance),
            balanceWei: balance.toString()
        })
    } catch (error) {
        respondWithError(res, error, "wallets.getEntryPointBalance")
    }
})

/**
 * POST /wallets/:walletAddress/deposit-gas
 * Deposit ETH to the EntryPoint for the agent wallet
 *
 * The owner wallet signs a request to deposit ETH to the EntryPoint.
 * This funds the agent's smart account for gas payment during execution.
 *
 * Body: { amount: string }  // ETH amount
 */
router.post("/:walletAddress/deposit-gas", async (req: express.Request, res: express.Response) => {
    try {
        const db = await initDB()
        const walletAddress = requireAddress(req.params.walletAddress, "walletAddress")

        ensureBodyObject(req.body)
        const amount = requireString(req.body.amount, "amount")
        const amountWei = ethers.parseEther(amount)

        // Get wallet info
        const wallet = await db.get(
            `SELECT * FROM wallets WHERE wallet_address = ?`,
            walletAddress
        )

        if (!wallet) {
            return res.status(404).json({ error: "Wallet not found" })
        }

        // Require signed action for security
        await requireSignedAction(db, {
            orgId: wallet.org_id,
            action: "DEPOSIT_GAS",
            target: `wallet:${walletAddress}`,
            payload: req.body
        })

        // Execute deposit to EntryPoint
        const result = await blockchain.depositToEntryPoint(walletAddress, amountWei)

        res.json({
            success: true,
            walletAddress,
            amount,
            amountWei: amountWei.toString(),
            txHash: result.txHash,
            newBalance: result.newBalance
        })
    } catch (error) {
        respondWithError(res, error, "wallets.depositGas")
    }
})

export default router
