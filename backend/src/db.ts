import sqlite3 from "sqlite3"
import { open } from "sqlite"
import fs from "fs"
import path from "path"

const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, "../db/database.sqlite")
const SCHEMA_PATH = path.resolve(__dirname, "../db/schema.sql")
const REVOCATION_KEY_SPACE = 1n << 20n
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const SAFE_DEFINITION = /^[A-Za-z0-9_ (),'-]+$/

let dbPromise: Promise<any> | null = null

export async function initDB() {
    if(!dbPromise){
        dbPromise = createDB().catch((error) => {
            dbPromise = null
            throw error
        })
    }

    return dbPromise
}

async function createDB() {
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    })

    await db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
    `)

    await db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"))
    await ensureLeafIndex(db)
    await ensureSecretHash(db)
    await ensureRevokedLeafIndex(db)
    await ensureRevokedSparseColumns(db)
    await ensureSessionColumns(db)
    await ensureOrgScopedColumns(db)
    await ensureOrganizationContractsTable(db)
    await ensureSharedContractsTable(db)
    await ensureManagedSecretColumn(db)
    await ensureOrganizationOwnerWalletColumn(db)
    await ensureWallet4337Columns(db)
    await ensureExternalAgentTables(db)
    await ensureAgentVaultCredentials(db)
    await ensureAgentFundingAccounts(db)
    await ensureAgentWhitelistedContracts(db)

    return db
}

async function ensureLeafIndex(db:any){
    const columns = await db.all(`PRAGMA table_info("credentials")`)
    const hasLeafIndex = columns.some((column:any) => column.name === "leaf_index")

    if(!hasLeafIndex){
        await db.exec(`
            ALTER TABLE "credentials"
            ADD COLUMN "leaf_index" INTEGER NOT NULL DEFAULT 0
        `)

        const credentials = await db.all(`
            SELECT id
            FROM credentials
            ORDER BY id ASC
        `)

        for(let index = 0; index < credentials.length; index++){
            await db.run(
                `
                UPDATE credentials
                SET leaf_index = ?
                WHERE id = ?
                `,
                index,
                credentials[index].id
            )
        }
    }
}

async function ensureSecretHash(db:any){
    const columns = await db.all(`PRAGMA table_info("credentials")`)
    const hasSecretHash = columns.some((column:any) => column.name === "secret_hash")

    if(!hasSecretHash){
        await db.exec(`
            ALTER TABLE "credentials"
            ADD COLUMN "secret_hash" TEXT
        `)

        const credentials = await db.all(`
            SELECT id, commitment, expiry
            FROM credentials
            WHERE commitment IS NOT NULL
        `)

        for(const cred of credentials){
            await db.run(
                `UPDATE credentials SET secret_hash = ? WHERE id = ?`,
                cred.commitment,
                cred.id
            )
        }
    }
}

async function ensureRevokedLeafIndex(db:any){
    const columns = await db.all(`PRAGMA table_info("revoked_secrets")`)
    const hasLeafIndex = columns.some((column:any) => column.name === "leaf_index")

    if(!hasLeafIndex){
        await db.exec(`
            ALTER TABLE "revoked_secrets"
            ADD COLUMN "leaf_index" INTEGER NOT NULL DEFAULT 0
        `)
    }
}

async function ensureRevokedSparseColumns(db:any){
    const columns = await db.all(`PRAGMA table_info("revoked_secrets")`)
    const hasSmtKey = columns.some((column:any) => column.name === "smt_key")

    if(!hasSmtKey){
        await db.exec(`
            ALTER TABLE "revoked_secrets"
            ADD COLUMN "smt_key" TEXT
        `)

        await db.exec(`
            ALTER TABLE "revoked_secrets"
            ADD COLUMN "revoked_value" INTEGER NOT NULL DEFAULT 1
        `)
    }
}

async function ensureSessionColumns(db:any){
    const columns = await db.all(`PRAGMA table_info("sessions")`)
    const hasPublicSignals = columns.some((column:any) => column.name === "public_signals")

    if(!hasPublicSignals){
        await db.exec(`
            ALTER TABLE "sessions"
            ADD COLUMN "public_signals" TEXT
        `)
    }
}

async function ensureOrgScopedColumns(db:any){
    const columns = await db.all(`PRAGMA table_info("agents")`)
    const hasOrgId = columns.some((column:any) => column.name === "org_id")

    if(!hasOrgId){
        await db.exec(`
            ALTER TABLE "agents"
            ADD COLUMN "org_id" INTEGER
        `)
    }
}

async function ensureOrganizationContractsTable(db:any){
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='organization_contracts'`)

    if(tables.length === 0){
        await db.exec(`
            CREATE TABLE organization_contracts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL,
                chain_id INTEGER NOT NULL,
                network_name TEXT NOT NULL,
                verifier_address TEXT NOT NULL,
                credential_registry_address TEXT NOT NULL,
                session_manager_address TEXT NOT NULL,
                agent_wallet_factory_address TEXT NOT NULL,
                agent_wallet_implementation_address TEXT NOT NULL,
                entry_point_address TEXT NOT NULL,
                deployment_tx_hashes TEXT,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                updated_at INTEGER DEFAULT (strftime('%s','now'))
            )
        `)
    }

    await ensureColumn(db, "organization_contracts", "entry_point_address", "TEXT")
}

async function ensureSharedContractsTable(db:any){
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='shared_contracts'`)

    if(tables.length === 0){
        await db.exec(`
            CREATE TABLE shared_contracts (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                verifier_address TEXT,
                agent_wallet_implementation_address TEXT,
                entry_point_address TEXT,
                deployment_tx_hashes TEXT,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                updated_at INTEGER DEFAULT (strftime('%s','now'))
            )
        `)
    }

    await ensureColumn(db, "shared_contracts", "entry_point_address", "TEXT")
}

async function ensureColumn(db:any, table:string, column:string, definition:string){
    assertSafeIdentifier(table, "table")
    assertSafeIdentifier(column, "column")
    assertSafeDefinition(definition)

    const columns = await db.all(`PRAGMA table_info("${table}")`)
    const hasColumn = columns.some((existing:any) => existing.name === column)

    if(!hasColumn){
        await db.exec(`
            ALTER TABLE "${table}"
            ADD COLUMN "${column}" ${definition}
        `)
    }
}

async function ensureManagedSecretColumn(db:any){
    await ensureColumn(db, "agents", "managed_secret", "TEXT")
}

async function ensureOrganizationOwnerWalletColumn(db:any){
    await ensureColumn(db, "organizations", "owner_wallet_address", "TEXT")
}

async function ensureWallet4337Columns(db:any){
    await ensureColumn(db, "wallets", "entry_point_address", "TEXT")
    await ensureColumn(db, "wallets", "factory_salt", "TEXT")
    await ensureColumn(db, "wallets", "wallet_kind", "TEXT NOT NULL DEFAULT 'erc4337'")
}

async function ensureExternalAgentTables(db:any){
    await db.exec(`
        CREATE TABLE IF NOT EXISTS external_agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id INTEGER NOT NULL,
            linked_agent_id INTEGER,
            agent_type TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            agent_endpoint TEXT,
            agent_api_key TEXT,
            agent_api_secret TEXT,
            status TEXT DEFAULT 'disconnected',
            is_active INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            last_heartbeat_at INTEGER,
            metadata TEXT DEFAULT '{}',
            FOREIGN KEY (org_id) REFERENCES organizations(id),
            FOREIGN KEY (linked_agent_id) REFERENCES agents(id)
        )
    `)

    await ensureColumn(db, "external_agents", "linked_agent_id", "INTEGER")
}

async function ensureAgentVaultCredentials(db:any){
    await db.exec(`
        CREATE TABLE IF NOT EXISTS agent_vault_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            external_agent_id INTEGER NOT NULL,
            credential_name TEXT NOT NULL,
            encrypted_value TEXT NOT NULL,
            credential_type TEXT DEFAULT 'api_key',
            is_secret INTEGER DEFAULT 1,
            expires_at INTEGER,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (external_agent_id) REFERENCES external_agents(id)
        )
    `)

    await ensureColumn(db, "agent_vault_credentials", "expires_at", "INTEGER")
}

async function ensureAgentFundingAccounts(db:any){
    await db.exec(`
        CREATE TABLE IF NOT EXISTS agent_funding_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            external_agent_id INTEGER NOT NULL,
            wallet_address TEXT NOT NULL,
            wallet_private_key_encrypted TEXT NOT NULL,
            balance TEXT DEFAULT '0',
            daily_limit TEXT DEFAULT '0',
            is_active INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (external_agent_id) REFERENCES external_agents(id)
        )
    `)
}

async function ensureAgentWhitelistedContracts(db:any){
    await db.exec(`
        CREATE TABLE IF NOT EXISTS agent_whitelisted_contracts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            external_agent_id INTEGER NOT NULL,
            contract_address TEXT NOT NULL,
            contract_name TEXT,
            contract_abi TEXT,
            is_enabled INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (external_agent_id) REFERENCES external_agents(id)
        )
    `)

    await ensureColumn(db, "agent_whitelisted_contracts", "contract_abi", "TEXT")
}

function assertSafeIdentifier(value:string, field:string){
    if(!SAFE_IDENTIFIER.test(value)){
        throw new Error(`unsafe ${field} identifier`)
    }
}

function assertSafeDefinition(value:string){
    if(!SAFE_DEFINITION.test(value)){
        throw new Error("unsafe column definition")
    }
}
