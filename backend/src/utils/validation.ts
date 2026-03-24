import { isAddress } from "ethers"
import { AppError } from "./errors"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type StringOptions = {
    minLength?: number
    maxLength?: number
}

export function ensureBodyObject(body:unknown){
    if(!body || typeof body !== "object" || Array.isArray(body)){
        throw new AppError(400, "invalid request body")
    }
}

export function requireString(value:unknown, field:string, options:StringOptions = {}){
    if(typeof value !== "string"){
        throw new AppError(400, `${field} is required`)
    }

    const trimmed = value.trim()
    const minLength = options.minLength ?? 1
    const maxLength = options.maxLength ?? 256

    if(trimmed.length < minLength){
        throw new AppError(400, `${field} is required`)
    }

    if(trimmed.length > maxLength){
        throw new AppError(400, `${field} is too long`)
    }

    return trimmed
}

export function optionalString(value:unknown, field:string, options:StringOptions = {}){
    if(value === undefined || value === null || value === ""){
        return null
    }

    return requireString(value, field, options)
}

export function requireEmail(value:unknown){
    const email = requireString(value, "email", { minLength: 5, maxLength: 320 }).toLowerCase()

    if(!EMAIL_REGEX.test(email)){
        throw new AppError(400, "email is invalid")
    }

    return email
}

export function requirePassword(value:unknown){
    const password = requireString(value, "password", { minLength: 12, maxLength: 128 })

    if(!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)){
        throw new AppError(400, "password must include upper, lower, and numeric characters")
    }

    return password
}

export function requireInteger(value:unknown, field:string, min?:number, max?:number){
    const parsed = typeof value === "number" ? value : Number(value)

    if(!Number.isInteger(parsed)){
        throw new AppError(400, `${field} must be an integer`)
    }

    if(min !== undefined && parsed < min){
        throw new AppError(400, `${field} must be at least ${min}`)
    }

    if(max !== undefined && parsed > max){
        throw new AppError(400, `${field} must be at most ${max}`)
    }

    return parsed
}

export function optionalInteger(value:unknown, field:string, min?:number, max?:number){
    if(value === undefined || value === null || value === ""){
        return undefined
    }

    return requireInteger(value, field, min, max)
}

export function requireAddress(value:unknown, field:string){
    const address = requireString(value, field, { minLength: 42, maxLength: 42 })

    if(!isAddress(address)){
        throw new AppError(400, `${field} is invalid`)
    }

    return address
}

export function optionalAddress(value:unknown, field:string){
    if(value === undefined || value === null || value === ""){
        return null
    }

    return requireAddress(value, field)
}

export function requireArray(value:unknown, field:string){
    if(!Array.isArray(value)){
        throw new AppError(400, `${field} must be an array`)
    }

    return value
}

export function requireObject(value:unknown, field:string){
    if(!value || typeof value !== "object" || Array.isArray(value)){
        throw new AppError(400, `${field} must be an object`)
    }

    return value as Record<string, unknown>
}
