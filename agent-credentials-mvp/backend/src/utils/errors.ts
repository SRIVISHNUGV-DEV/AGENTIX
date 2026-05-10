import type { Response } from "express"

export class AppError extends Error {
    statusCode: number
    expose: boolean

    constructor(statusCode:number, message:string, expose = true){
        super(message)
        this.statusCode = statusCode
        this.expose = expose
    }
}

export function respondWithError(res:Response, error:unknown, context:string){
    if(error instanceof AppError){
        return res.status(error.statusCode).json({
            error: error.expose ? error.message : "internal server error"
        })
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[${context}]`, message)

    return res.status(500).json({
        error: "internal server error"
    })
}
