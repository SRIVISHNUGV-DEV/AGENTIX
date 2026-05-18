/**
 * Migration script: SQLite to PostgreSQL
 *
 * Usage:
 *   1. Set DATABASE_URL environment variable for PostgreSQL
 *   2. Run: npx tsx scripts/migrate-to-postgres.ts
 *
 * Environment variables:
 *   - DB_PATH: Path to SQLite database (default: ../db/database.sqlite)
 *   - DATABASE_URL: PostgreSQL connection string (required)
 *   - DRY_RUN: Set to 'true' to preview without writing
 */

import { Pool } from "pg"
import sqlite3 from "sqlite3"
import { open } from "sqlite"
import path from "path"

const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, "../db/database.sqlite")

const POSTGRES_URL = process.env.DATABASE_URL || ""
const DRY_RUN = process.env.DRY_RUN === "true"

if (!POSTGRES_URL && !DRY_RUN) {
    console.error("Error: DATABASE_URL environment variable required")
    process.exit(1)
}

interface TableConfig {
    name: string
    columns: string[]
    idColumn?: string
}

const tables: TableConfig[] = [
    { name: "organizations", columns: ["id", "name", "owner_wallet_address", "created_at"] },
    { name: "users", columns: ["id", "org_id", "email", "name", "password_hash", "role", "created_at"] },
    { name: "auth_sessions", columns: ["id", "user_id", "token_hash", "expires_at", "created_at"] },
    { name: "agents", columns: ["id", "org_id", "agent_name", "managed_secret", "created_at"] },
    { name: "credentials", columns: ["id", "agent_id", "org_id", "permissions", "expiry", "commitment", "secret_hash", "leaf_index", "created_at"] },
    { name: "sessions", columns: ["id", "agent_id", "session_id", "nullifier", "proof", "public_signals", "tx_hash", "created_at"] },
    { name: "wallets", columns: ["id", "agent_id", "org_id", "wallet_address", "wallet_kind", "entry_point_address", "factory_salt", "created_at"] },
    { name: "merkle_tree", columns: ["id", "leaf_index", "commitment", "secret_hash", "created_at"] },
    { name: "revoked_secrets", columns: ["id", "secret_hash", "leaf_index", "smt_key", "revoked_value", "created_at"] },
    { name: "events", columns: ["id", "org_id", "event_type", "event_data", "tx_hash", "block_number", "created_at"] },
    { name: "organization_contracts", columns: ["id", "org_id", "chain_id", "network_name", "verifier_address", "credential_registry_address", "session_manager_address", "agent_wallet_factory_address", "agent_wallet_implementation_address", "entry_point_address", "deployment_tx_hashes", "created_at", "updated_at"] },
    { name: "shared_contracts", columns: ["id", "verifier_address", "agent_wallet_implementation_address", "entry_point_address", "deployment_tx_hashes", "created_at", "updated_at"] },
    { name: "external_agents", columns: ["id", "org_id", "linked_agent_id", "agent_type", "agent_name", "agent_endpoint", "agent_api_key", "agent_api_secret", "status", "is_active", "created_at", "updated_at", "last_heartbeat_at", "metadata"] },
    { name: "agent_vault_credentials", columns: ["id", "external_agent_id", "credential_name", "encrypted_value", "credential_type", "is_secret", "expires_at", "created_at"] },
    { name: "agent_funding_accounts", columns: ["id", "external_agent_id", "wallet_address", "wallet_private_key_encrypted", "balance", "daily_limit", "is_active", "created_at", "updated_at"] },
    { name: "agent_whitelisted_contracts", columns: ["id", "external_agent_id", "contract_address", "contract_name", "contract_abi", "is_enabled", "created_at"] },
]

async function migrate() {
    console.log("SQLite to PostgreSQL Migration")
    console.log("==============================")
    console.log(`Source: ${DB_PATH}`)
    console.log(`Target: ${DRY_RUN ? "DRY RUN (no writes)" : POSTGRES_URL.replace(/:.*@/, ":****@")}`)
    console.log("")

    // Connect to SQLite
    const sqlite = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    })

    // Connect to PostgreSQL
    const pgPool = new Pool({ connectionString: POSTGRES_URL })
    const pgClient = await pgPool.connect()

    try {
        // Disable foreign key checks for faster inserts
        if (!DRY_RUN) {
            await pgClient.query("SET session_replication_role = 'replica'")
        }

        let totalRows = 0
        let totalTables = 0

        for (const table of tables) {
            console.log(`Migrating table: ${table.name}...`)

            // Get data from SQLite
            const rows: any[] = await sqlite.all(`SELECT ${table.columns.join(", ")} FROM ${table.name}`)

            if (rows.length === 0) {
                console.log(`  -> No rows to migrate`)
                continue
            }

            if (!DRY_RUN) {
                // Build INSERT query
                const placeholders = table.columns.map((_, i) => `$${i + 1}`).join(", ")
                const insertQuery = `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${placeholders})`

                // Insert in batches
                const batchSize = 100
                for (let i = 0; i < rows.length; i += batchSize) {
                    const batch = rows.slice(i, i + batchSize)
                    await pgClient.query("BEGIN")

                    try {
                        for (const row of batch) {
                            const values = table.columns.map(col => row[col])
                            await pgClient.query(insertQuery, values)
                        }
                        await pgClient.query("COMMIT")
                    } catch (err) {
                        await pgClient.query("ROLLBACK")
                        throw err
                    }
                }
            }

            totalRows += rows.length
            totalTables++
            console.log(`  -> Migrated ${rows.length} rows`)
        }

        // Re-enable foreign keys
        if (!DRY_RUN) {
            await pgClient.query("SET session_replication_role = 'origin'")
        }

        console.log("")
        console.log("Migration complete!")
        console.log(`Tables migrated: ${totalTables}`)
        console.log(`Total rows migrated: ${totalRows}`)

        if (DRY_RUN) {
            console.log("\nNOTE: This was a dry run. No data was written.")
            console.log("Remove DRY_RUN=true to execute the migration.")
        }
    } finally {
        pgClient.release()
        await pgPool.end()
        await sqlite.close()
    }
}

migrate().catch((err) => {
    console.error("Migration failed:", err)
    process.exit(1)
})
