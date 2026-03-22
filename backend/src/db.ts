import sqlite3 from "sqlite3"
import { open } from "sqlite"
import fs from "fs"
import path from "path"

const DB_PATH = path.resolve(__dirname, "../db/database.sqlite")
const SCHEMA_PATH = path.resolve(__dirname, "../db/schema.sql")
const REVOCATION_KEY_SPACE = 1n << 20n

export async function initDB() {

    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    })

    await db.exec(`
        PRAGMA journal_mode = WAL;
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

    return db
}

async function ensureLeafIndex(db:any){

    const columns = await db.all(`PRAGMA table_info(credentials)`)
    const hasLeafIndex = columns.some((column:any) => column.name === "leaf_index")

    if(!hasLeafIndex){
        await db.exec(`
            ALTER TABLE credentials
            ADD COLUMN leaf_index INTEGER NOT NULL DEFAULT 0
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

    const columns = await db.all(`PRAGMA table_info(credentials)`)
    const hasSecretHash = columns.some((column:any) => column.name === "secret_hash")

    if(!hasSecretHash){
        await db.exec(`
            ALTER TABLE credentials
            ADD COLUMN secret_hash TEXT
        `)
    }
}

async function ensureRevokedLeafIndex(db:any){

    const columns = await db.all(`PRAGMA table_info(revoked_secrets)`)
    const hasLeafIndex = columns.some((column:any) => column.name === "leaf_index")

    if(columns.length > 0 && !hasLeafIndex){
        await db.exec(`
            ALTER TABLE revoked_secrets
            ADD COLUMN leaf_index INTEGER NOT NULL DEFAULT 0
        `)
    }
}

async function ensureRevokedSparseColumns(db:any){

    const columns = await db.all(`PRAGMA table_info(revoked_secrets)`)
    const hasSmtKey = columns.some((column:any) => column.name === "smt_key")
    const hasRevokedValue = columns.some((column:any) => column.name === "revoked_value")

    if(columns.length > 0 && !hasSmtKey){
        await db.exec(`
            ALTER TABLE revoked_secrets
            ADD COLUMN smt_key TEXT
        `)
    }

    if(columns.length > 0 && !hasRevokedValue){
        await db.exec(`
            ALTER TABLE revoked_secrets
            ADD COLUMN revoked_value INTEGER NOT NULL DEFAULT 1
        `)
    }

    await db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_revoked_secrets_smt_key
        ON revoked_secrets(smt_key)
    `)

    if(columns.length > 0){
        const revokedSecrets = await db.all(`
            SELECT id, secret_hash, smt_key
            FROM revoked_secrets
            WHERE smt_key IS NULL AND secret_hash IS NOT NULL
        `)

        for (const entry of revokedSecrets) {
            const smtKey = (BigInt(entry.secret_hash) % REVOCATION_KEY_SPACE).toString()

            await db.run(
                `
                UPDATE revoked_secrets
                SET smt_key = ?, revoked_value = COALESCE(revoked_value, 1)
                WHERE id = ?
                `,
                smtKey,
                entry.id
            )
        }
    }
}

async function ensureSessionColumns(db:any){

    const columns = await db.all(`PRAGMA table_info(sessions)`)
    const hasSessionId = columns.some((column:any) => column.name === "session_id")
    const hasTxHash = columns.some((column:any) => column.name === "tx_hash")

    if(!hasSessionId){
        await db.exec(`
            ALTER TABLE sessions
            ADD COLUMN session_id TEXT
        `)
    }

    if(!hasTxHash){
        await db.exec(`
            ALTER TABLE sessions
            ADD COLUMN tx_hash TEXT
        `)
    }
}

async function ensureOrgScopedColumns(db:any){
    await ensureColumn(db, "merkle_tree", "org_id", "INTEGER")
    await ensureColumn(db, "revoked_secrets", "org_id", "INTEGER")
    await ensureColumn(db, "revoked_merkle_tree", "org_id", "INTEGER")
    await ensureColumn(db, "wallets", "org_id", "INTEGER")
    await ensureColumn(db, "contract_events", "org_id", "INTEGER")

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_merkle_tree_org_level_index
        ON merkle_tree(org_id, level, node_index)
    `)

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_revoked_merkle_tree_org_level_index
        ON revoked_merkle_tree(org_id, level, node_index)
    `)

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wallets_org_id
        ON wallets(org_id)
    `)

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_contract_events_org_id
        ON contract_events(org_id)
    `)

    await db.exec(`
        UPDATE revoked_secrets
        SET org_id = (
            SELECT org_id FROM credentials WHERE credentials.agent_id = revoked_secrets.agent_id
        )
        WHERE org_id IS NULL
    `)

    await db.exec(`
        UPDATE wallets
        SET org_id = (
            SELECT org_id FROM agents WHERE agents.id = wallets.agent_id
        )
        WHERE org_id IS NULL AND agent_id IS NOT NULL
    `)

    await db.exec(`
        UPDATE merkle_tree
        SET org_id = COALESCE(org_id, 0)
        WHERE org_id IS NULL
    `)

    await db.exec(`
        UPDATE revoked_merkle_tree
        SET org_id = COALESCE(org_id, 0)
        WHERE org_id IS NULL
    `)
}

async function ensureOrganizationContractsTable(db:any){
    await db.exec(`
        CREATE TABLE IF NOT EXISTS organization_contracts (
            org_id INTEGER PRIMARY KEY,
            chain_id INTEGER NOT NULL,
            network_name TEXT NOT NULL,
            verifier_address TEXT NOT NULL,
            credential_registry_address TEXT NOT NULL,
            session_manager_address TEXT NOT NULL,
            agent_wallet_factory_address TEXT NOT NULL,
            agent_wallet_implementation_address TEXT NOT NULL,
            deployment_tx_hashes TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
    `)
}

async function ensureSharedContractsTable(db:any){
    await db.exec(`
        CREATE TABLE IF NOT EXISTS shared_contracts (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            verifier_address TEXT,
            agent_wallet_implementation_address TEXT,
            deployment_tx_hashes TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
    `)
}

async function ensureColumn(db:any, table:string, column:string, definition:string){
    const columns = await db.all(`PRAGMA table_info(${table})`)
    const hasColumn = columns.some((existing:any) => existing.name === column)

    if(!hasColumn){
        await db.exec(`
            ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}
        `)
    }
}

async function ensureManagedSecretColumn(db:any){
    await ensureColumn(db, "agents", "managed_secret", "TEXT")
}

async function ensureOrganizationOwnerWalletColumn(db:any){
    await ensureColumn(db, "organizations", "owner_wallet_address", "TEXT")
}
