import express from "express"
import { initDB } from "../db"
import { AuthService } from "../services/auth"
import { BlockchainService } from "../services/blockchain"
import { requireAuth } from "../middleware/auth"

const router = express.Router()
const auth = new AuthService()
const blockchain = new BlockchainService()

router.post("/register", async (req,res)=>{
    try{
        const db = await initDB()
        const { orgName, name, email, password } = req.body

        if(!orgName || !name || !email || !password){
            return res.status(400).json({ error:"orgName, name, email and password are required" })
        }

        const existing = await db.get(`SELECT id FROM users WHERE email = ?`, email.toLowerCase())
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
            email.toLowerCase(),
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
                email: email.toLowerCase(),
                name,
                role: "owner"
            }
        })
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.post("/login", async (req,res)=>{
    try{
        const db = await initDB()
        const { email, password } = req.body

        if(!email || !password){
            return res.status(400).json({ error:"email and password are required" })
        }

        const user = await db.get(
            `
            SELECT *
            FROM users
            WHERE email = ?
            `,
            email.toLowerCase()
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
    }catch(err:any){
        res.status(500).json({ error: err.message })
    }
})

router.post("/logout", requireAuth, async (req:any,res)=>{
    const db = await initDB()
    const token = req.headers.authorization?.slice("Bearer ".length)
    if(token){
        await auth.revokeSession(db, token)
    }
    res.json({ success:true })
})

router.get("/me", requireAuth, async (req:any,res)=>{
    const db = await initDB()
    const organization = await db.get(
        `SELECT * FROM organizations WHERE id = ?`,
        req.auth.orgId
    )

    res.json({
        success:true,
        user: req.auth,
        organization
    })
})

export default router
