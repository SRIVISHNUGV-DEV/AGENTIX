import type { NextFunction, Response } from "express"
import { initDB } from "../db"
import { AuthService } from "../services/auth"
import type { AuthRequest } from "../types/http"
import { AppError } from "../utils/errors"

const auth = new AuthService()

export async function attachAuth(req:AuthRequest,_res:Response,next:NextFunction){
    try{
        const header = req.headers.authorization
        if(!header){
            return next()
        }

        if(!header.startsWith("Bearer ")){
            return next(new AppError(401, "invalid authorization header"))
        }

        const token = header.slice("Bearer ".length).trim()
        if(!token){
            return next(new AppError(401, "invalid authorization header"))
        }

        const db = await initDB()
        const session = await auth.getSession(db, token)
        const now = Math.floor(Date.now() / 1000)

        if(session && Number(session.expires_at) > now){
            req.auth = {
                userId: session.user_id,
                orgId: session.org_id,
                email: session.email,
                name: session.name,
                role: session.role,
                expiresAt: Number(session.expires_at)
            }
        }

        next()
    }catch(error){
        next(error)
    }
}

export function requireAuth(req:AuthRequest,res:Response,next:NextFunction){
    if(!req.auth){
        return res.status(401).json({ error:"authentication required" })
    }

    next()
}
