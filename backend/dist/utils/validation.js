"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBodyObject = ensureBodyObject;
exports.requireString = requireString;
exports.optionalString = optionalString;
exports.requireEmail = requireEmail;
exports.requirePassword = requirePassword;
exports.requireInteger = requireInteger;
exports.optionalInteger = optionalInteger;
exports.requireAddress = requireAddress;
exports.optionalAddress = optionalAddress;
exports.requireArray = requireArray;
exports.requireObject = requireObject;
exports.requireHex = requireHex;
exports.validateMetadata = validateMetadata;
const ethers_1 = require("ethers");
const errors_1 = require("./errors");
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Security: Pattern to detect XSS payloads in user input
const XSS_PATTERN = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;
function ensureBodyObject(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new errors_1.AppError(400, "invalid request body");
    }
}
function requireString(value, field, options = {}) {
    if (typeof value !== "string") {
        throw new errors_1.AppError(400, `${field} is required`);
    }
    let trimmed = value.trim();
    const minLength = options.minLength ?? 1;
    const maxLength = options.maxLength ?? 256;
    // Security: Strip HTML tags unless explicitly allowed
    if (!options.allowHtml) {
        // First flag potential XSS attempts (script tags)
        if (XSS_PATTERN.test(trimmed)) {
            throw new errors_1.AppError(400, `${field} contains disallowed content`);
        }
        // Reset regex lastIndex
        XSS_PATTERN.lastIndex = 0;
        // Strip all HTML tags
        trimmed = trimmed.replace(HTML_TAG_PATTERN, "");
    }
    if (trimmed.length < minLength) {
        throw new errors_1.AppError(400, `${field} is required`);
    }
    if (trimmed.length > maxLength) {
        throw new errors_1.AppError(400, `${field} is too long`);
    }
    return trimmed;
}
function optionalString(value, field, options = {}) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    // Security: Check for XSS patterns in optional strings too
    if (typeof value === "string") {
        if (XSS_PATTERN.test(value)) {
            throw new errors_1.AppError(400, `${field} contains disallowed content`);
        }
        XSS_PATTERN.lastIndex = 0;
    }
    return requireString(value, field, options);
}
function requireEmail(value) {
    const email = requireString(value, "email", { minLength: 5, maxLength: 320 }).toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
        throw new errors_1.AppError(400, "email is invalid");
    }
    return email;
}
function requirePassword(value) {
    const password = requireString(value, "password", { minLength: 12, maxLength: 128 });
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        throw new errors_1.AppError(400, "password must include upper, lower, and numeric characters");
    }
    return password;
}
function requireInteger(value, field, min, max) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed)) {
        throw new errors_1.AppError(400, `${field} must be an integer`);
    }
    if (min !== undefined && parsed < min) {
        throw new errors_1.AppError(400, `${field} must be at least ${min}`);
    }
    if (max !== undefined && parsed > max) {
        throw new errors_1.AppError(400, `${field} must be at most ${max}`);
    }
    return parsed;
}
function optionalInteger(value, field, min, max) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    return requireInteger(value, field, min, max);
}
function requireAddress(value, field) {
    const address = requireString(value, field, { minLength: 42, maxLength: 42 });
    if (!(0, ethers_1.isAddress)(address)) {
        throw new errors_1.AppError(400, `${field} is invalid`);
    }
    return address;
}
function optionalAddress(value, field) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return requireAddress(value, field);
}
function requireArray(value, field) {
    if (!Array.isArray(value)) {
        throw new errors_1.AppError(400, `${field} must be an array`);
    }
    return value;
}
function requireObject(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new errors_1.AppError(400, `${field} must be an object`);
    }
    return value;
}
function requireHex(value, field, options = {}) {
    // Limit hex strings to 4KB max (8KB hex chars + 2 for "0x") to prevent DoS
    const hex = requireString(value, field, { minLength: 2, maxLength: Math.min(options.maxBytes ? options.maxBytes * 2 + 2 : 4096, 8194) });
    if (!/^0x[0-9a-fA-F]*$/.test(hex)) {
        throw new errors_1.AppError(400, `${field} must be a hex string`);
    }
    if ((hex.length - 2) % 2 !== 0) {
        throw new errors_1.AppError(400, `${field} must have an even-length hex payload`);
    }
    const byteLength = (hex.length - 2) / 2;
    if (options.minBytes !== undefined && byteLength < options.minBytes) {
        throw new errors_1.AppError(400, `${field} must be at least ${options.minBytes} bytes`);
    }
    if (options.maxBytes !== undefined && byteLength > options.maxBytes) {
        throw new errors_1.AppError(400, `${field} must be at most ${options.maxBytes} bytes`);
    }
    return hex;
}
// V-004 FIX: Validate metadata to prevent prototype pollution
function validateMetadata(value, field) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new errors_1.AppError(400, `${field} must be an object`);
    }
    const obj = value;
    // Security: Check for prototype pollution keys (only check if explicitly set)
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of dangerousKeys) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            throw new errors_1.AppError(400, `${field} contains disallowed key: ${key}`);
        }
    }
    // Limit metadata size (max 10 keys, max 1KB per value)
    const keys = Object.keys(obj);
    if (keys.length > 10) {
        throw new errors_1.AppError(400, `${field} can have at most 10 keys`);
    }
    for (const [key, val] of Object.entries(obj)) {
        // Check key is a safe string
        if (!/^[a-zA-Z0-9_]+$/.test(key)) {
            throw new errors_1.AppError(400, `${field} key "${key}" contains invalid characters`);
        }
        // Check value is a safe primitive
        if (typeof val === 'string') {
            if (val.length > 1024) {
                throw new errors_1.AppError(400, `${field}.${key} exceeds maximum length`);
            }
        }
        else if (typeof val === 'number' || typeof val === 'boolean') {
            // OK
        }
        else if (val === null) {
            // OK
        }
        else {
            throw new errors_1.AppError(400, `${field}.${key} must be a primitive value`);
        }
    }
    return obj;
}
