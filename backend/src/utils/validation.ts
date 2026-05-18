import { isAddress } from "ethers"
import { AppError } from "./errors"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Security: Pattern to detect XSS payloads in user input
const XSS_PATTERN = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const HTML_TAG_PATTERN = /<[^>]+>/g

type StringOptions = {
    minLength?: number
    maxLength?: number
    allowHtml?: boolean // Default: false - strips HTML tags
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

    let trimmed = value.trim()
    const minLength = options.minLength ?? 1
    const maxLength = options.maxLength ?? 256

    // Security: Strip HTML tags unless explicitly allowed
    if (!options.allowHtml) {
        // First flag potential XSS attempts (script tags)
        if (XSS_PATTERN.test(trimmed)) {
            throw new AppError(400, `${field} contains disallowed content`)
        }
        // Reset regex lastIndex
        XSS_PATTERN.lastIndex = 0

        // Strip all HTML tags
        trimmed = trimmed.replace(HTML_TAG_PATTERN, "")
    }

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

    // Security: Check for XSS patterns in optional strings too
    if (typeof value === "string") {
        if (XSS_PATTERN.test(value)) {
            throw new AppError(400, `${field} contains disallowed content`)
        }
        XSS_PATTERN.lastIndex = 0
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

export function requireHex(value:unknown, field:string, options:{ minBytes?:number; maxBytes?:number } = {}){
    // Limit hex strings to 4KB max (8KB hex chars + 2 for "0x") to prevent DoS
    const hex = requireString(value, field, { minLength: 2, maxLength: Math.min(options.maxBytes ? options.maxBytes * 2 + 2 : 4096, 8194) })

    if(!/^0x[0-9a-fA-F]*$/.test(hex)){
        throw new AppError(400, `${field} must be a hex string`)
    }

    if((hex.length - 2) % 2 !== 0){
        throw new AppError(400, `${field} must have an even-length hex payload`)
    }

    const byteLength = (hex.length - 2) / 2
    if(options.minBytes !== undefined && byteLength < options.minBytes){
        throw new AppError(400, `${field} must be at least ${options.minBytes} bytes`)
    }

    if(options.maxBytes !== undefined && byteLength > options.maxBytes){
        throw new AppError(400, `${field} must be at most ${options.maxBytes} bytes`)
    }

    return hex
}

// V-004 FIX: Validate metadata to prevent prototype pollution
export function validateMetadata(value: unknown, field: string): Record<string, unknown> | undefined {
    if (value === undefined || value === null) {
        return undefined
    }

    if (typeof value !== "object" || Array.isArray(value)) {
        throw new AppError(400, `${field} must be an object`)
    }

    const obj = value as Record<string, unknown>

    // Security: Check for prototype pollution keys
    const dangerousKeys = ['__proto__', 'constructor', 'prototype']
    for (const key of dangerousKeys) {
        if (key in obj || Object.prototype.hasOwnProperty.call(obj, key)) {
            throw new AppError(400, `${field} contains disallowed key: ${key}`)
        }
    }

    // Limit metadata size (max 10 keys, max 1KB per value)
    const keys = Object.keys(obj)
    if (keys.length > 10) {
        throw new AppError(400, `${field} can have at most 10 keys`)
    }

    for (const [key, val] of Object.entries(obj)) {
        // Check key is a safe string
        if (!/^[a-zA-Z0-9_]+$/.test(key)) {
            throw new AppError(400, `${field} key "${key}" contains invalid characters`)
        }

        // Check value is a safe primitive
        if (typeof val === 'string') {
            if (val.length > 1024) {
                throw new AppError(400, `${field}.${key} exceeds maximum length`)
            }
        } else if (typeof val === 'number' || typeof val === 'boolean') {
            // OK
        } else if (val === null) {
            // OK
        } else {
            throw new AppError(400, `${field}.${key} must be a primitive value`)
        }
    }

    return obj
}
