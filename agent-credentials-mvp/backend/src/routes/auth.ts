import express from "express"
import { initDB } from "../db"
import { AuthService } from "../services/auth"
import { BlockchainService } from "../services/blockchain"
import { requireAuth } from "../middleware/auth"
import type { AuthRequest } from "../types/http"
import { respondWithError } from "../utils/errors"
import { ensureBodyObject, requireEmail, requirePassword, requireString } from "../utils/validation"

const router = express.Router()
const auth = new AuthService()
const blockchain = new BlockchainService()

router.post("/register", async (req,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const orgName = requireString(req.body.orgName, "orgName", { minLength: 2, maxLength: 120 })
        const name = requireString(req.body.name, "name", { minLength: 2, maxLength: 120 })
        const email = requireEmail(req.body.email)
        const password = requirePassword(req.body.password)

        const existing = await db.get(`SELECT id FROM users WHERE email = ?`, email)
        if(existing){
            return res.status(409).json({ error:"user already exists" })
        }

        const orgResult = await db.run(
            `INSERT INTO organizations (name) VALUES (?)`,
            orgName
        )
        const orgId = orgResult.lastID
        await blockchain.ensureOrganizationContracts(db, orgId)

        const userResult = await db.run(
            `
            INSERT INTO users (org_id, email, name, password_hash, role)
            VALUES (?, ?, ?, ?, 'owner')
            `,
            orgId,
            email,
            name,
            auth.hashPassword(password)
        )

        const session = await auth.createSession(db, userResult.lastID)

        res.json({
            success:true,
            token: session.token,
            expiresAt: session.expiresAt,
            user: {
                id: userResult.lastID,
                orgId,
                email,
                name,
                role: "owner"
            }
        })
    }catch(error){
        respondWithError(res, error, "auth.register")
    }
})

router.post("/login", async (req,res)=>{
    try{
        const db = await initDB()
        ensureBodyObject(req.body)

        const email = requireEmail(req.body.email)
        const password = requireString(req.body.password, "password", { minLength: 1, maxLength: 128 })

        const user = await db.get(
            `
            SELECT *
            FROM users
            WHERE email = ?
            `,
            email
        )

        if(!user || !auth.verifyPassword(password, user.password_hash)){
            return res.status(401).json({ error:"invalid credentials" })
        }

        const session = await auth.createSession(db, user.id)

        res.json({
            success:true,
            token: session.token,
            expiresAt: session.expiresAt,
            user: {
                id: user.id,
                orgId: user.org_id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        })
    }catch(error){
        respondWithError(res, error, "auth.login")
    }
})

router.post("/logout", requireAuth, async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const header = req.headers.authorization
        const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null
        if(token){
            await auth.revokeSession(db, token)
        }
        res.json({ success:true })
    }catch(error){
        respondWithError(res, error, "auth.logout")
    }
})

router.get("/me", requireAuth, async (req:AuthRequest,res)=>{
    try{
        const db = await initDB()
        const organization = await db.get(
            `SELECT * FROM organizations WHERE id = ?`,
            req.auth!.orgId
        )

        res.json({
            success:true,
            user: req.auth,
            organization
        })
    }catch(error){
        respondWithError(res, error, "auth.me")
    }
})

export default router
