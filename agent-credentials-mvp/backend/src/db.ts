import { Pool, PoolClient, QueryResult } from "pg"

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
if (!DATABASE_URL) {
    throw new Error("DATABASE_URL or POSTGRES_URL environment variable is required")
}

const DB_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || "10", 10)
const DB_SSL_MODE = process.env.DB_SSL_MODE || "prefer"
const DB_CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || "10000", 10)
const DB_IDLE_TIMEOUT_MS = parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10)
const DB_STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "60000", 10)
const DB_APPLICATION_NAME = process.env.DB_APPLICATION_NAME || "agentix-backend"

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
        connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
        idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
        statement_timeout: DB_STATEMENT_TIMEOUT_MS,
        application_name: DB_APPLICATION_NAME,
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
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                level INTEGER NOT NULL,
                node_index INTEGER NOT NULL,
                hash TEXT NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_merkle_org_level_index ON merkle_tree(org_id, level, node_index)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS revoked_secrets (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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
                owner_address TEXT,
                wallet_address TEXT NOT NULL,
                session_manager_address TEXT,
                implementation_address TEXT,
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
            CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_address_unique ON wallets(wallet_address)
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
            CREATE UNIQUE INDEX IF NOT EXISTS idx_org_contracts_org_id_unique ON organization_contracts(org_id)
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
                nonce TEXT UNIQUE,
                org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                wallet_address TEXT,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                requested_at INTEGER,
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
            CREATE UNIQUE INDEX IF NOT EXISTS idx_action_auth_nonce_unique ON action_authorizations(nonce)
        `)

        // Make org_id nullable for new org creation flow
        await client.query(`
            DO $$
            BEGIN
                ALTER TABLE action_authorizations ALTER COLUMN org_id DROP NOT NULL;
            EXCEPTION
                WHEN others THEN NULL;
            END $$;
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

        // AI agents tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_agents (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key_encrypted TEXT,
                config TEXT DEFAULT '{}',
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ai_agents_org_id ON ai_agents(org_id)
        `)

        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_agent_runs (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                prompt TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                output TEXT,
                error TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                completed_at INTEGER
            )
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_id ON ai_agent_runs(agent_id)
        `)

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_status ON ai_agent_runs(status)
        `)

        await ensureColumn(client, "merkle_tree", "org_id", "INTEGER")
        await ensureColumn(client, "merkle_tree", "level", "INTEGER")
        await ensureColumn(client, "merkle_tree", "node_index", "INTEGER")
        await ensureColumn(client, "merkle_tree", "hash", "TEXT")

        await ensureColumn(client, "revoked_secrets", "agent_id", "INTEGER")
        await ensureColumn(client, "revoked_secrets", "org_id", "INTEGER")

        await ensureColumn(client, "wallets", "owner_address", "TEXT")
        await ensureColumn(client, "wallets", "session_manager_address", "TEXT")
        await ensureColumn(client, "wallets", "implementation_address", "TEXT")

        await ensureColumn(client, "action_authorizations", "nonce", "TEXT")
        await ensureColumn(client, "action_authorizations", "wallet_address", "TEXT")
        await ensureColumn(client, "action_authorizations", "requested_at", "INTEGER")

        console.log("[db] Database tables initialized")
    } finally {
        client.release()
    }

    return createPostgresWrapper(pool)
}

function createPostgresWrapper(pool: Pool): DB {
    // Cache prepared statements for PostgreSQL to handle SQLite-style queries
    const statementCache: Map<string, string> = new Map()
    let transactionClient: PoolClient | null = null

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

    function maybeAppendReturningId(sql: string): string {
        const trimmed = sql.trim().replace(/;$/, "")
        if (!/^insert\s+/i.test(trimmed) || /\breturning\b/i.test(trimmed)) {
            return trimmed
        }
        return `${trimmed} RETURNING id`
    }

    async function execute(sql: string, params: any[] = [], options?: { returningId?: boolean }): Promise<QueryResult<any>> {
        const preparedSql = options?.returningId ? maybeAppendReturningId(convertSql(sql)) : convertSql(sql)
        const runner = transactionClient ?? pool
        return runner.query(preparedSql, params)
    }

    return {
        query: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await execute(sql, params)
            return result.rows
        },
        run: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await execute(sql, params, { returningId: true })
            return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 }
        },
        get: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await execute(sql, params)
            return result.rows[0]
        },
        all: async (sql: string, ...args: any[]) => {
            const params = normalizeParams(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
            const result = await execute(sql, params)
            return result.rows
        },
        exec: async (sql: string) => {
            const normalized = sql.trim().toUpperCase()

            if (normalized === "BEGIN") {
                if (transactionClient) {
                    throw new Error("transaction already open")
                }
                transactionClient = await pool.connect()
                await transactionClient.query("BEGIN")
                return
            }

            if (normalized === "COMMIT" || normalized === "ROLLBACK") {
                if (!transactionClient) {
                    await pool.query(normalized)
                    return
                }

                const client = transactionClient
                transactionClient = null
                try {
                    await client.query(normalized)
                } finally {
                    client.release()
                }
                return
            }

            const runner = transactionClient ?? pool
            await runner.query(convertSql(sql))
        }
    } as DB
}

async function ensureColumn(client: PoolClient, table: string, column: string, definition: string) {
    assertSafeIdentifier(table, "table")
    assertSafeIdentifier(column, "column")
    assertSafeDefinition(definition)

    const result = await client.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        `,
        [table, column]
    )

    if (result.rowCount === 0) {
        await client.query(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
    }
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
