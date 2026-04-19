CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_wallet_address TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(org_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    agent_name TEXT,
    managed_secret TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(org_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    permissions INTEGER NOT NULL,
    expiry INTEGER NOT NULL,
    commitment TEXT NOT NULL,
    secret_hash TEXT,
    leaf_index INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    session_id TEXT,
    nullifier TEXT,
    proof TEXT,
    public_signals TEXT,
    tx_hash TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS merkle_tree (
    id INTEGER PRIMARY KEY,
    org_id INTEGER,
    level INTEGER,
    node_index INTEGER,
    hash TEXT
);

CREATE TABLE IF NOT EXISTS revoked_secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    org_id INTEGER,
    secret_hash TEXT NOT NULL UNIQUE,
    smt_key TEXT UNIQUE,
    revoked_value INTEGER NOT NULL DEFAULT 1,
    leaf_index INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS revoked_merkle_tree (
    id INTEGER PRIMARY KEY,
    org_id INTEGER,
    level INTEGER,
    node_index INTEGER,
    hash TEXT
);

CREATE TABLE IF NOT EXISTS proof_cache (
    key TEXT PRIMARY KEY,
    proof TEXT,
    public_signals TEXT,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    org_id INTEGER,
    owner_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL UNIQUE,
    session_manager_address TEXT NOT NULL,
    implementation_address TEXT,
    entry_point_address TEXT,
    factory_salt TEXT,
    wallet_kind TEXT NOT NULL DEFAULT 'erc4337',
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS contract_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER,
    contract_name TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    event_name TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    log_index INTEGER NOT NULL,
    session_id TEXT,
    wallet_address TEXT,
    payload TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS event_cursors (
    contract_key TEXT PRIMARY KEY,
    last_block INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_contracts (
    org_id INTEGER PRIMARY KEY,
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
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(org_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS shared_contracts (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    verifier_address TEXT,
    agent_wallet_implementation_address TEXT,
    entry_point_address TEXT,
    deployment_tx_hashes TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS action_authorizations (
    nonce TEXT PRIMARY KEY,
    org_id INTEGER NOT NULL,
    wallet_address TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
