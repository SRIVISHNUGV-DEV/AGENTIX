import { logger } from "./logger"

export type EnvVar = {
    name: string
    required: boolean
    description: string
    validate?: (value: string) => boolean
}

const REQUIRED_ENV_VARS: EnvVar[] = [
    { name: "DATABASE_URL", required: false, description: "PostgreSQL connection string (or POSTGRES_URL)" },
    { name: "RPC_URL", required: true, description: "Ethereum RPC URL" },
    { name: "PRIVATE_KEY", required: true, description: "Backend operator wallet private key" },
    { name: "SESSION_MANAGER_ADDRESS", required: true, description: "Deployed SessionManager address" },
    { name: "CREDENTIAL_REGISTRY_ADDRESS", required: true, description: "Deployed CredentialRegistry address" },
    { name: "AGENT_WALLET_FACTORY_ADDRESS", required: true, description: "Deployed AgentWalletFactory address" },
    { name: "AGENT_WALLET_IMPLEMENTATION_ADDRESS", required: true, description: "Deployed AgentWallet implementation address" },
    { name: "VERIFIER_ADDRESS", required: true, description: "Deployed Groth16Verifier address" },
    { name: "ENTRY_POINT_ADDRESS", required: true, description: "ERC-4337 EntryPoint address" },
    { name: "CORS_ORIGIN", required: false, description: "Allowed CORS origins (comma-separated)" },
    { name: "SESSION_ENCRYPTION_KEY", required: true, description: "AES-256-GCM master key (32 bytes hex)" },
    { name: "REDIS_URL", required: false, description: "Redis connection string" },
]

export function validateEnvironment(): string[] {
    const errors: string[] = []

    for (const envVar of REQUIRED_ENV_VARS) {
        const value = process.env[envVar.name]
        const datbaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL

        // DATABASE_URL can be POSTGRES_URL as fallback
        if (envVar.name === "DATABASE_URL") {
            if (!datbaseUrl) {
                errors.push(`Missing required env var: DATABASE_URL or POSTGRES_URL — ${envVar.description}`)
            }
            continue
        }

        if (envVar.required && !value) {
            errors.push(`Missing required env var: ${envVar.name} — ${envVar.description}`)
            continue
        }

        if (value && envVar.validate && !envVar.validate(value)) {
            errors.push(`Invalid value for: ${envVar.name} — ${envVar.description}`)
        }
    }

    return errors
}

export function validateEnvAndExit() {
    const errors = validateEnvironment()
    if (errors.length > 0) {
        for (const err of errors) {
            logger.fatal("environment validation failed", { error: err })
        }
        process.exit(1)
    }
    logger.info("environment validation passed")
}
