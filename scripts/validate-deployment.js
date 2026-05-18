#!/usr/bin/env node
/**
 * Pre-deployment validation script
 * Checks for security issues before deploying to production
 * Run: node scripts/validate-deployment.js
 */

const fs = require("fs")
const path = require("path")

// ANSI color codes
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

let errors = 0
let warnings = 0

function error(msg) {
    console.error(`${RED}ERROR${RESET}: ${msg}`)
    errors++
}

function warn(msg) {
    console.warn(`${YELLOW}WARN${RESET}: ${msg}`)
    warnings++
}

function success(msg) {
    console.log(`${GREEN}PASS${RESET}: ${msg}`)
}

function checkEnvFile(filePath) {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    // Check for placeholder values
    const placeholderPatterns = [
        { pattern: /replace-with-64-hex-characters/i, name: "encryption key placeholder" },
        { pattern: /YOUR_\w+_KEY/, name: "placeholder API keys" },
        { pattern: /0xYOUR_/, name: "placeholder private key" },
        { pattern: /sk-ant-/, name: "placeholder Anthropic key" },
        { pattern: /sk-[a-zA-Z0-9]{10,}/, name: "potential hardcoded OpenAI key" },
    ]

    placeholderPatterns.forEach(({ pattern, name }) => {
        if (pattern.test(content)) {
            error(`Found ${name} in ${filePath}`)
        }
    })

    // Check for required variables
    const requiredVars = [
        "DATABASE_URL",
        "ENCRYPTION_KEY",
        "PRIVATE_KEY",
    ]

    requiredVars.forEach((varName) => {
        const regex = new RegExp(`^${varName}=`, "m")
        if (!regex.test(content)) {
            error(`Missing required variable: ${varName} in ${filePath}`)
        }
    })

    // Validate encryption key format
    const encryptionKeyMatch = content.match(/ENCRYPTION_KEY=(.+)/)
    if (encryptionKeyMatch) {
        const key = encryptionKeyMatch[1].trim()
        if (key.length !== 64) {
            error(`ENCRYPTION_KEY must be exactly 64 hex characters (got ${key.length})`)
        }
        if (!/^[0-9a-fA-F]+$/.test(key)) {
            error(`ENCRYPTION_KEY must be hex characters only`)
        }
    }

    // Validate private key format
    const privateKeyMatch = content.match(/PRIVATE_KEY=(.+)/)
    if (privateKeyMatch) {
        const key = privateKeyMatch[1].trim()
        if (!key.startsWith("0x") || key.length !== 66) {
            warn(`PRIVATE_KEY should be 0x + 64 hex characters (got ${key.length})`)
        }
    }

    if (errors === 0) {
        success(`Environment file validation passed: ${filePath}`)
    }
}

function checkDependencies() {
    const packageJsonPath = path.join(process.cwd(), "backend", "package.json")
    if (!fs.existsSync(packageJsonPath)) {
        warn("backend/package.json not found")
        return
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))

    // Check for SQLite packages (should not exist post-migration)
    const sqliteDeps = ["sqlite", "sqlite3"]
    sqliteDeps.forEach((dep) => {
        if (packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep]) {
            error(`SQLite dependency ${dep} should be removed (PostgreSQL migration)`)
        }
    })

    // Ensure PostgreSQL driver exists
    if (!packageJson.dependencies?.["pg"]) {
        error("PostgreSQL driver 'pg' not found in dependencies")
    }

    if (errors === 0) {
        success("Dependency validation passed")
    }
}

function checkSourceCode() {
    const backendSrc = path.join(process.cwd(), "backend", "src")
    if (!fs.existsSync(backendSrc)) {
        warn("backend/src directory not found")
        return
    }

    // Walk through source files
    function walk(dir) {
        const files = fs.readdirSync(dir)
        files.forEach((file) => {
            const fullPath = path.join(dir, file)
            const stat = fs.statSync(fullPath)
            if (stat.isDirectory()) {
                walk(fullPath)
            } else if (file.endsWith(".ts") || file.endsWith(".js")) {
                const content = fs.readFileSync(fullPath, "utf-8")

                // Check for hardcoded secrets
                if (/password\s*=\s*["'][^"']{8,}["']/.test(content)) {
                    warn(`Possible hardcoded password in ${fullPath}`)
                }

                // Check for SQLite references (should be gone)
                if (/sqlite/i.test(content) && !content.includes("//")) {
                    warn(`Possible SQLite reference in ${fullPath}`)
                }

                // Check for TODO/FIXME
                if (/TODO|FIXME/i.test(content)) {
                    warn(`TODO/FIXME found in ${fullPath}`)
                }
            }
        })
    }

    walk(backendSrc)

    if (warnings === 0 && errors === 0) {
        success("Source code validation passed")
    }
}

// Main validation
console.log("\n=== Agentix Deployment Validation ===\n")

// Get environment file path from args or use default
const envFile = process.argv.find((arg) => arg.startsWith("--env="))?.split("=")[1] || "./backend/.env"

if (!fs.existsSync(envFile)) {
    error(`Environment file not found: ${envFile}`)
} else {
    checkEnvFile(envFile)
}

checkDependencies()
checkSourceCode()

// Summary
console.log("\n=== Validation Summary ===")
if (errors > 0) {
    console.log(`${RED}${errors} error(s)${RESET}, ${YELLOW}${warnings} warning(s)${RESET}`)
    console.log("\nDeployment blocked. Please fix errors before deploying.")
    process.exit(1)
} else if (warnings > 0) {
    console.log(`${GREEN}0 errors${RESET}, ${YELLOW}${warnings} warning(s)${RESET}`)
    console.log("\nDeployment allowed with warnings.")
    process.exit(0)
} else {
    console.log(`${GREEN}All checks passed!${RESET}`)
    console.log("\nReady for deployment.")
    process.exit(0)
}
