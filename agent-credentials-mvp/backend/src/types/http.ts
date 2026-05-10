import type { Request } from "express"

export type AuthContext = {
    userId: number
    orgId: number
    email: string
    name: string
    role: string
    expiresAt: number
}

export interface AuthRequest extends Request {
    auth?: AuthContext
}
