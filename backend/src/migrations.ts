// FLAW 5 FIX: Database migration system
// Migrations are versioned SQL scripts that run once on database initialization
// Each migration has: version (number), name (string), up (SQL to apply)

import { PoolClient } from "pg"

export type Migration = {
    version: number
    name: string
    up: string
}

export const migrations: Migration[] = [
    {
        version: 1,
        name: "initial_schema",
        up: `
            CREATE TABLE IF NOT EXISTS organizations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                owner_wallet_address TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'owner',
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE TABLE IF NOT EXISTS agents (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                agent_name TEXT,
                managed_secret TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
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
            );
            CREATE INDEX IF NOT EXISTS idx_credentials_agent_id ON credentials(agent_id);
            CREATE INDEX IF NOT EXISTS idx_credentials_org_id ON credentials(org_id);
            CREATE INDEX IF NOT EXISTS idx_credentials_secret_hash ON credentials(secret_hash);
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                session_id TEXT,
                nullifier TEXT,
                proof TEXT,
                public_signals TEXT,
                tx_hash TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
        `
    },
    {
        version: 2,
        name: "merkle_and_wallets",
        up: `
            CREATE TABLE IF NOT EXISTS merkle_tree (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                level INTEGER NOT NULL,
                node_index INTEGER NOT NULL,
                hash TEXT NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_merkle_org_level_index ON merkle_tree(org_id, level, node_index);
            CREATE TABLE IF NOT EXISTS revoked_secrets (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                secret_hash TEXT NOT NULL,
                leaf_index INTEGER NOT NULL DEFAULT 0,
                smt_key TEXT,
                revoked_value INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_revoked_secret_hash ON revoked_secrets(secret_hash);
            CREATE INDEX IF NOT EXISTS idx_revoked_smt_key ON revoked_secrets(smt_key);
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
            );
            CREATE INDEX IF NOT EXISTS idx_wallets_agent_id ON wallets(agent_id);
            CREATE INDEX IF NOT EXISTS idx_wallets_org_id ON wallets(org_id);
            CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(wallet_address);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_address_unique ON wallets(wallet_address);
        `
    },
    {
        version: 3,
        name: "events_and_contracts",
        up: `
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                event_data TEXT NOT NULL,
                tx_hash TEXT,
                block_number INTEGER,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_events_org_id ON events(org_id);
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
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
            );
            CREATE INDEX IF NOT EXISTS idx_org_contracts_org_id ON organization_contracts(org_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_org_contracts_org_id_unique ON organization_contracts(org_id);
            CREATE TABLE IF NOT EXISTS shared_contracts (
                id SERIAL PRIMARY KEY CHECK (id = 1),
                verifier_address TEXT,
                agent_wallet_implementation_address TEXT,
                entry_point_address TEXT,
                deployment_tx_hashes TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
        `
    },
    {
        version: 4,
        name: "external_agents",
        up: `
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
            );
            CREATE INDEX IF NOT EXISTS idx_external_agents_org_id ON external_agents(org_id);
            CREATE INDEX IF NOT EXISTS idx_external_agents_linked_agent ON external_agents(linked_agent_id);
            CREATE TABLE IF NOT EXISTS agent_vault_credentials (
                id SERIAL PRIMARY KEY,
                external_agent_id INTEGER NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
                credential_name TEXT NOT NULL,
                encrypted_value TEXT NOT NULL,
                credential_type TEXT DEFAULT 'api_key',
                is_secret INTEGER DEFAULT 1,
                expires_at INTEGER,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_vault_creds_agent ON agent_vault_credentials(external_agent_id);
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
            );
            CREATE INDEX IF NOT EXISTS idx_funding_accounts_agent ON agent_funding_accounts(external_agent_id);
            CREATE TABLE IF NOT EXISTS agent_whitelisted_contracts (
                id SERIAL PRIMARY KEY,
                external_agent_id INTEGER NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
                contract_address TEXT NOT NULL,
                contract_name TEXT,
                contract_abi TEXT,
                is_enabled INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_whitelisted_contracts_agent ON agent_whitelisted_contracts(external_agent_id);
            CREATE INDEX IF NOT EXISTS idx_whitelisted_contracts_address ON agent_whitelisted_contracts(contract_address);
        `
    },
    {
        version: 5,
        name: "contract_events_and_proofs",
        up: `
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
            );
            CREATE INDEX IF NOT EXISTS idx_contract_events_org_id ON contract_events(org_id);
            CREATE INDEX IF NOT EXISTS idx_contract_events_block ON contract_events(block_number DESC, log_index DESC);
            CREATE INDEX IF NOT EXISTS idx_contract_events_session ON contract_events(session_id);
            CREATE INDEX IF NOT EXISTS idx_contract_events_wallet ON contract_events(wallet_address);
            CREATE TABLE IF NOT EXISTS proof_cache (
                id SERIAL PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                proof TEXT NOT NULL,
                public_signals TEXT NOT NULL,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                expires_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_proof_cache_key ON proof_cache(key);
            CREATE INDEX IF NOT EXISTS idx_proof_cache_expires ON proof_cache(expires_at);
        `
    },
    {
        version: 6,
        name: "action_authorizations",
        up: `
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
            );
            CREATE INDEX IF NOT EXISTS idx_action_auth_org ON action_authorizations(org_id);
            CREATE INDEX IF NOT EXISTS idx_action_auth_action ON action_authorizations(action, target);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_action_auth_nonce_unique ON action_authorizations(nonce);
        `
    },
    {
        version: 7,
        name: "merkle_and_event_tracking",
        up: `
            CREATE TABLE IF NOT EXISTS revoked_merkle_tree (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                leaf_index INTEGER NOT NULL,
                commitment TEXT NOT NULL,
                secret_hash TEXT,
                revoked_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_revoked_merkle_org ON revoked_merkle_tree(org_id);
            CREATE INDEX IF NOT EXISTS idx_revoked_merkle_leaf ON revoked_merkle_tree(leaf_index);
            CREATE TABLE IF NOT EXISTS event_cursors (
                id SERIAL PRIMARY KEY,
                contract_key TEXT NOT NULL UNIQUE,
                last_block INTEGER NOT NULL,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_event_cursors_key ON event_cursors(contract_key);
        `
    },
    {
        version: 8,
        name: "proof_jobs",
        up: `
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
            );
            CREATE INDEX IF NOT EXISTS idx_proof_jobs_job_id ON proof_jobs(job_id);
            CREATE INDEX IF NOT EXISTS idx_proof_jobs_agent_id ON proof_jobs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_proof_jobs_expires_at ON proof_jobs(expires_at);
        `
    },
    {
        version: 9,
        name: "ai_agents",
        up: `
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
            );
            CREATE INDEX IF NOT EXISTS idx_ai_agents_org_id ON ai_agents(org_id);
            CREATE TABLE IF NOT EXISTS ai_agent_runs (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                prompt TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                output TEXT,
                error TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                completed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_id ON ai_agent_runs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_status ON ai_agent_runs(status);
        `
    },
    {
        version: 10,
        name: "audit_log",
        up: `
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id);
            CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
            CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at);
        `
    },
    {
        version: 11,
        name: "merkle_tree_state_cache",
        up: `
            CREATE TABLE IF NOT EXISTS merkle_tree_state (
                id SERIAL PRIMARY KEY,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                tree_type TEXT NOT NULL DEFAULT 'active',
                root TEXT NOT NULL,
                leaf_count INTEGER NOT NULL DEFAULT 0,
                serialized_tree TEXT,
                updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                UNIQUE(org_id, tree_type)
            );
            CREATE INDEX IF NOT EXISTS idx_merkle_tree_state_org ON merkle_tree_state(org_id, tree_type);
        `
    },
    {
        version: 13,
        name: "agent_execution_logs",
        up: `
            CREATE TABLE IF NOT EXISTS agent_execution_logs (
                id SERIAL PRIMARY KEY,
                external_agent_id INTEGER NOT NULL,
                org_id INTEGER NOT NULL,
                request_id TEXT NOT NULL UNIQUE,
                action TEXT NOT NULL,
                params TEXT NOT NULL,
                proof TEXT,
                result TEXT,
                success BOOLEAN NOT NULL DEFAULT FALSE,
                error_message TEXT,
                execution_time_ms INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_execution_logs_agent ON agent_execution_logs(external_agent_id);
            CREATE INDEX IF NOT EXISTS idx_execution_logs_org ON agent_execution_logs(org_id);
            CREATE INDEX IF NOT EXISTS idx_execution_logs_created ON agent_execution_logs(created_at DESC);
        `
    },
    {
        version: 14,
        name: "used_nullifiers",
        up: `
            CREATE TABLE IF NOT EXISTS used_nullifiers (
                id SERIAL PRIMARY KEY,
                nullifier TEXT NOT NULL UNIQUE,
                used_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_nullifiers_nullifier ON used_nullifiers(nullifier);
            CREATE INDEX IF NOT EXISTS idx_nullifiers_used_at ON used_nullifiers(used_at);
        `
    }
]

export async function runMigrations(client: PoolClient) {
    // Create migrations table if not exists
    await client.query(`
        CREATE TABLE IF NOT EXISTS migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
        )
    `)

    // Get applied migrations
    const result = await client.query('SELECT version FROM migrations')
    const appliedVersions = new Set(result.rows.map((r: any) => r.version))

    // Run pending migrations
    for (const migration of migrations) {
        if (!appliedVersions.has(migration.version)) {
            console.log(`[db] Running migration ${migration.version}: ${migration.name}`)
            await client.query(migration.up)
            await client.query(
                'INSERT INTO migrations (version, name) VALUES ($1, $2)',
                [migration.version, migration.name]
            )
            console.log(`[db] Migration ${migration.version} complete`)
        }
    }
}
