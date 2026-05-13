import { Pool, PoolClient, QueryResult } from "pg"
import { runMigrations } from "./migrations"

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
        // FLAW 5 FIX: Use migration system instead of inline schema
        await runMigrations(client)

        // Make org_id nullable for new org creation flow (migration 12)
        await client.query(`
            DO $$
            BEGIN
                ALTER TABLE action_authorizations ALTER COLUMN org_id DROP NOT NULL;
            EXCEPTION
                WHEN others THEN NULL;
            END $$;
        `)

        // Clean up old completed jobs
        await client.query(`
            DELETE FROM proof_jobs WHERE expires_at < EXTRACT(EPOCH FROM NOW())::INTEGER
        `)

        // Clean up expired proof cache
        await client.query(`
            DELETE FROM proof_cache WHERE expires_at < EXTRACT(EPOCH FROM NOW())::INTEGER
        `)

        console.log("[db] Database initialized successfully")
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
