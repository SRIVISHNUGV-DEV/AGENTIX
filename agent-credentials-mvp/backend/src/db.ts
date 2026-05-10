import { Pool, PoolClient } from "pg"
import path from "path"

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
if (!DATABASE_URL) {
    throw new Error("DATABASE_URL or POSTGRES_URL environment variable is required")
}

const DB_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || "10", 10)
const DB_SSL_MODE = process.env.DB_SSL_MODE || "prefer"

const REVOCATION_KEY_SPACE = 1n << 20n
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const SAFE_DEFINITION = /^[A-Za-z0-9_ (),'-]+$/

let dbPromise: Promise<DB> | null = null

// Normalize parameters to array
function normalizeParams(params: any): any[] {
    if (params === undefined) return []
    if (Array.isArray(params)) return params
    return [params]
}

export type DB = {
    query(sql: string, ...params: any[]): Promise<any[]>
    query(sql: string, params: any[]): Promise<any[]>
    run(sql: string, ...params: any[]): Promise<{ lastID?: number; changes?: number }>
    run(sql: string, params: any[]): Promise<{ lastID?: number; changes?: number }>
    get(sql: string, ...params: any[]): Promise<any | undefined>
    get(sql: string, params: any[]): Promise<any | undefined>
    all(sql: string, ...params: any[]): Promise<any[]>
    all(sql: string, params: any[]): Promise<any[]>
    exec(sql: string): Promise<void>
}

export async function initDB(): Promise<DB> {
    if (!dbPromise) {
        dbPromise = createPostgresDB().catch((error) => {
            dbPromise = null
            throw error
        })
    }
    return dbPromise
}

async function createPostgresDB(): Promise<DB> {
    // Build pool configuration with SSL handling
    const poolConfig: any = {
        connectionString: DATABASE_URL,
        max: DB_POOL_SIZE,
    }

    // Configure SSL based on DB_SSL_MODE
    // AWS RDS uses self-signed certificates - we need to accept them
    if (DB_SSL_MODE === "require" || DB_SSL_MODE === "prefer") {
        poolConfig.ssl = { rejectUnauthorized: false }
    } else if (DB_SSL_MODE === "disable") {
        poolConfig.ssl = false
    }

    const pool = new Pool(poolConfig)

    // Test connection on startup
    const testClient = await pool.connect()
    try {
        await testClient.query("SELECT 1")
        console.log("[db] PostgreSQL connection established")
    } finally {
        testClient.release()
    }

    // Handle pool errors
    pool.on("error", (err) => {
        console.error("[db] Unexpected PostgreSQL pool error:", err)
    })

    const client = await pool.connect()
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS organizations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                owner_wallet_address TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'owner',
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS agents (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                agent_name TEXT,
                managed_secret TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS credentials (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL,
                org_id INTEGER NOT NULL,
                permissions INTEGER NOT NULL,
                expiry INTEGER NOT NULL,
                commitment TEXT NOT NULL,
                secret_hash TEXT,
                leaf_index INTEGER NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_credentials_agent_id ON credentials(agent_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_credentials_org_id ON credentials(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_credentials_secret_hash ON credentials(secret_hash)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                session_id TEXT,
                nullifier TEXT,
                proof TEXT,
                public_signals TEXT,
                tx_hash TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS merkle_tree (
                id SERIAL PRIMARY KEY,
                leaf_index INTEGER NOT NULL,
                commitment TEXT NOT NULL,
                secret_hash TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_merkle_leaf_index ON merkle_tree(leaf_index)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS revoked_secrets (
                id SERIAL PRIMARY KEY,
                secret_hash TEXT NOT NULL,
                leaf_index INTEGER NOT NULL DEFAULT 0,
                smt_key TEXT,
                revoked_value INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_revoked_secret_hash ON revoked_secrets(secret_hash)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_revoked_smt_key ON revoked_secrets(smt_key)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS wallets (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                wallet_address TEXT NOT NULL,
                wallet_kind TEXT NOT NULL DEFAULT 'erc4337',
                entry_point_address TEXT,
                factory_salt TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_wallets_agent_id ON wallets(agent_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_wallets_org_id ON wallets(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(wallet_address)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                event_data TEXT NOT NULL,
                tx_hash TEXT,
                block_number INTEGER,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_events_org_id ON events(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS organization_contracts (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                chain_id INTEGER NOT NULL,
                network_name TEXT NOT NULL,
                verifier_address TEXT NOT NULL,
                credential_registry_address TEXT NOT NULL,
                session_manager_address TEXT NOT NULL,
                agent_wallet_factory_address TEXT NOT NULL,
                agent_wallet_implementation_address TEXT NOT NULL,
                entry_point_address TEXT,
                deployment_tx_hashes TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_org_contracts_org_id ON organization_contracts(org_id)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS shared_contracts (
                id SERIAL PRIMARY KEY CHECK (id = 1),
                verifier_address TEXT,
                agent_wallet_implementation_address TEXT,
                entry_point_address TEXT,
                deployment_tx_hashes TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS external_agents (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
                agent_type TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                agent_endpoint TEXT,
                agent_api_key TEXT,
                agent_api_secret TEXT,
                status TEXT DEFAULT 'disconnected',
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                last_heartbeat_at INTEGER,
                metadata TEXT DEFAULT '{}'
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_external_agents_org_id ON external_agents(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_external_agents_linked_agent ON external_agents(linked_agent_id)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS agent_vault_credentials (
                id SERIAL PRIMARY KEY,
                external_agent_id INTEGER NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
                credential_name TEXT NOT NULL,
                encrypted_value TEXT NOT NULL,
                credential_type TEXT DEFAULT 'api_key',
                is_secret INTEGER DEFAULT 1,
                expires_at INTEGER,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_vault_creds_agent ON agent_vault_credentials(external_agent_id)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS agent_funding_accounts (
                id SERIAL PRIMARY KEY,
                external_agent_id INTEGER NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
                wallet_address TEXT NOT NULL,
                wallet_private_key_encrypted TEXT NOT NULL,
                balance TEXT DEFAULT '0',
                daily_limit TEXT DEFAULT '0',
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_funding_accounts_agent ON agent_funding_accounts(external_agent_id)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS agent_whitelisted_contracts (
                id SERIAL PRIMARY KEY,
                external_agent_id INTEGER NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
                contract_address TEXT NOT NULL,
                contract_name TEXT,
                contract_abi TEXT,
                is_enabled INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_whitelisted_contracts_agent ON agent_whitelisted_contracts(external_agent_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_whitelisted_contracts_address ON agent_whitelisted_contracts(contract_address)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS contract_events (
                id SERIAL PRIMARY KEY,
                org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                event_name TEXT,
                contract_name TEXT,
                contract_address TEXT,
                tx_hash TEXT,
                block_number INTEGER,
                log_index INTEGER,
                session_id TEXT,
                wallet_address TEXT,
                event_data TEXT NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                UNIQUE(tx_hash, log_index)
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_contract_events_org_id ON contract_events(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_contract_events_block ON contract_events(block_number DESC, log_index DESC)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_contract_events_session ON contract_events(session_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_contract_events_wallet ON contract_events(wallet_address)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS proof_cache (
                id SERIAL PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                proof TEXT NOT NULL,
                public_signals TEXT NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                expires_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_proof_cache_key ON proof_cache(key)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_proof_cache_expires ON proof_cache(expires_at)
        `)

        await client.query(`
            DELETE FROM proof_cache WHERE expires_at < EXTRACT(EPOCH FROM NOW())::INTEGER
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS action_authorizations (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                authorized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                signature TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                expires_at INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_action_auth_org ON action_authorizations(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_action_auth_action ON action_authorizations(action, target)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS revoked_merkle_tree (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                leaf_index INTEGER NOT NULL,
                commitment TEXT NOT NULL,
                secret_hash TEXT,
                revoked_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_revoked_merkle_org ON revoked_merkle_tree(org_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_revoked_merkle_leaf ON revoked_merkle_tree(leaf_index)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS event_cursors (
                id SERIAL PRIMARY KEY,
                contract_key TEXT NOT NULL UNIQUE,
                last_block INTEGER NOT NULL,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_event_cursors_key ON event_cursors(contract_key)
        `)

        // Proof queue job tracking table
        await client.query(`
            CREATE TABLE IF NOT EXISTS proof_jobs (
                id SERIAL PRIMARY KEY,
                job_id TEXT NOT NULL UNIQUE,
                agent_id INTEGER NOT NULL,
                org_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                result TEXT,
                error TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                completed_at INTEGER,
                expires_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_proof_jobs_job_id ON proof_jobs(job_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_proof_jobs_agent_id ON proof_jobs(agent_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_proof_jobs_expires_at ON proof_jobs(expires_at)
        `)

        // Clean up old completed jobs
        await client.query(`
            DELETE FROM proof_jobs WHERE expires_at < EXTRACT(EPOCH FROM NOW())::INTEGER
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_event_cursors_key ON event_cursors(contract_key)
        `)

        console.log("[db] Database tables initialized")
    } finally {
        client.release()
    }

    return createPostgresWrapper(pool)
}

function createPostgresWrapper(pool: Pool): DB {
    // Cache prepared statements for PostgreSQL to handle SQLite-style queries
    const statementCache: Map<string, string> = new Map()

    function convertSql(sql: string): string {
        if (statementCache.has(sql)) {
            return statementCache.get(sql)!
        }
        // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
        let converted = sql
        let paramIndex = 1
        while (converted.includes("?")) {
            converted = converted.replace("?", `$${paramIndex}`)
            paramIndex++
        }
        // Convert SQLite datetime functions to PostgreSQL equivalents
        converted = converted.replace(/strftime\('%s','now'\)/g, "EXTRACT(EPOCH FROM NOW())::INTEGER")
        converted = converted.replace(/CURRENT_TIMESTAMP/g, "NOW()")
        statementCache.set(sql, converted)
        return converted
    }

    return {
        query: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await pool.query(convertSql(sql), params)
            return result.rows
        },
        run: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await pool.query(convertSql(sql), params)
            return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 }
        },
        get: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await pool.query(convertSql(sql), params)
            return result.rows[0]
        },
        all: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await pool.query(convertSql(sql), params)
            return result.rows
        },
        exec: async (sql: string) => {
            // Execute SQL directly without parameter conversion
            // exec is for DDL/transaction commands that don't have parameters
            await pool.query(sql)
        }
    } as DB
}

function assertSafeIdentifier(value: string, field: string) {
    if (!SAFE_IDENTIFIER.test(value)) {
        throw new Error(`unsafe ${field} identifier`)
    }
}

function assertSafeDefinition(value: string) {
    if (!SAFE_DEFINITION.test(value)) {
        throw new Error("unsafe column definition")
    }
}
