import { initDB } from "../db"
import { AuthService } from "../services/auth"

const auth = new AuthService()

export async function attachAuth(req:any,_res:any,next:any){
    const header = req.headers.authorization
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null

    if(token){
        const db = await initDB()
        const session = await auth.getSession(db, token)
        if(session){
            req.auth = {
                userId: session.user_id,
                orgId: session.org_id,
                email: session.email,
                name: session.name,
                role: session.role,
                expiresAt: session.expires_at
            }
        }
    }

    next()
}

export function requireAuth(req:any,res:any,next:any){
    if(!req.auth){
        return res.status(401).json({ error:"authentication required" })
    }

    next()
}
