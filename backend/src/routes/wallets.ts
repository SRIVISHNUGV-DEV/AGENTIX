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

export default router
