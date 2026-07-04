import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "./config";
import { logger } from "./logger";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  credential_anchor TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS credential_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  root TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  tree_snapshot TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS revocation_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  root TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  tree_snapshot TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT UNIQUE NOT NULL,
  organization_id TEXT NOT NULL,
  agent_id INTEGER NOT NULL,
  nullifier TEXT UNIQUE NOT NULL,
  secret TEXT NOT NULL,
  permissions INTEGER NOT NULL DEFAULT 1,
  expiry INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT UNIQUE NOT NULL,
  owner_address TEXT NOT NULL,
  organization_id TEXT,
  agent_id INTEGER,
  entry_point TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  wallet_address TEXT NOT NULL,
  session_key TEXT NOT NULL,
  organization_id TEXT,
  session_type INTEGER NOT NULL DEFAULT 0,
  max_value TEXT NOT NULL DEFAULT '0',
  daily_spend_limit TEXT NOT NULL DEFAULT '0',
  daily_tx_limit INTEGER NOT NULL DEFAULT 0,
  expiry INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proof_hash TEXT UNIQUE NOT NULL,
  session_id TEXT,
  nullifier TEXT,
  root TEXT,
  revoked_root TEXT,
  public_signals TEXT,
  proof_data TEXT,
  valid INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_id TEXT UNIQUE NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id TEXT UNIQUE NOT NULL,
  organization_id TEXT NOT NULL,
  delegator TEXT NOT NULL,
  delegatee TEXT NOT NULL,
  scope TEXT NOT NULL,
  max_value TEXT NOT NULL DEFAULT '0',
  expiry INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_id TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS merkle_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  tree_type TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  root TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  agent TEXT,
  tool TEXT NOT NULL,
  intent TEXT DEFAULT '',
  session_id TEXT,
  wallet_address TEXT,
  risk_level TEXT DEFAULT 'LOW',
  tx_hash TEXT,
  execution_time INTEGER,
  success INTEGER DEFAULT 1,
  failure_reason TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS organization_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  eip712_signature TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS harnesses (
  harness_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  version TEXT DEFAULT '',
  capabilities TEXT DEFAULT '[]',
  mcp_version TEXT DEFAULT '',
  config_path TEXT DEFAULT '',
  status TEXT DEFAULT 'detected',
  detected_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT,
  tx_hash TEXT,
  to_address TEXT,
  value TEXT DEFAULT '0',
  data TEXT DEFAULT '0x',
  status TEXT DEFAULT 'pending',
  block_number INTEGER,
  gas_used INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  tx_hash TEXT,
  block_number INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS indexed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_name TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  args TEXT DEFAULT '{}',
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_ie_contract ON indexed_events(contract_name);
CREATE INDEX IF NOT EXISTS idx_ie_event ON indexed_events(event_name);
CREATE INDEX IF NOT EXISTS idx_ie_block ON indexed_events(block_number);
CREATE INDEX IF NOT EXISTS idx_ie_tx ON indexed_events(tx_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ie_tx_log ON indexed_events(tx_hash, log_index);

CREATE INDEX IF NOT EXISTS idx_credentials_org ON credentials(organization_id);
CREATE INDEX IF NOT EXISTS idx_credentials_agent ON credentials(agent_id);
CREATE INDEX IF NOT EXISTS idx_credentials_nullifier ON credentials(nullifier);
CREATE INDEX IF NOT EXISTS idx_sessions_wallet ON sessions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_proofs_session ON proofs(session_id);
CREATE INDEX IF NOT EXISTS idx_proofs_nullifier ON proofs(nullifier);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_component ON logs(component);
CREATE INDEX IF NOT EXISTS idx_agent_actions_wallet ON agent_actions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_agent_actions_timestamp ON agent_actions(timestamp);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Compiler tables
CREATE TABLE IF NOT EXISTS compilation_cache (
    content_hash TEXT PRIMARY KEY,
    intent_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    ttl INTEGER NOT NULL DEFAULT 300
);

CREATE TABLE IF NOT EXISTS execution_plans (
    plan_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    intent_json TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    capability_graph_json TEXT DEFAULT '{}',
    simulation_json TEXT DEFAULT '{}',
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_category TEXT NOT NULL DEFAULT 'LOW',
    explanation_json TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    compiled_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER,
    executed_at INTEGER,
    completed_at INTEGER,
    tx_hash TEXT,
    rejection_reason TEXT
);

CREATE TABLE IF NOT EXISTS policy_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    policy_hash TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
    compiled_by TEXT
);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    contract_name TEXT PRIMARY KEY,
    last_block INTEGER NOT NULL,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS scheduler_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL DEFAULT (unixepoch()),
    max_attempts INTEGER NOT NULL DEFAULT 3,
    attempts INTEGER NOT NULL DEFAULT 0,
    backoff_ms INTEGER NOT NULL DEFAULT 1000,
    backoff_multiplier REAL NOT NULL DEFAULT 2.0,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    status TEXT NOT NULL DEFAULT 'pending',
    on_complete_event TEXT,
    on_failure_event TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_attempt_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plans_status ON execution_plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_hash ON execution_plans(content_hash);
CREATE INDEX IF NOT EXISTS idx_plans_created ON execution_plans(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_created ON compilation_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_status ON scheduler_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_scheduled ON scheduler_jobs(scheduled_at);
`;

let _db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (_db) return _db;

  const config = loadConfig();
  const dbPath = config.database.path;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = OFF");

  _db.exec(SCHEMA);

  migrateOldSchema(_db);

  const meta = _db.prepare("SELECT value FROM metadata WHERE key = ?").get("schema_version") as any;
  if (!meta) {
    _db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("schema_version", "1.1.0");
    _db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("created_at", String(Math.floor(Date.now() / 1000)));
  } else {
    _db.prepare("UPDATE metadata SET value = ? WHERE key = ?").run("1.2.0", "schema_version");
  }

  logger.info("database", `Connected to ${dbPath}`);
  return _db;
}

function migrateOldSchema(db: Database.Database): void {
  const tablesToCheck = [
    "credential_roots", "revocation_roots", "sessions",
    "capabilities", "delegations"
  ];

  for (const table of tablesToCheck) {
    try {
      const info = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as any;
      if (info && info.sql && info.sql.includes("FOREIGN KEY")) {
        logger.info("database", `Migrating ${table}: removing FOREIGN KEY constraint`);
        db.exec(`CREATE TABLE IF NOT EXISTS ${table}_new AS SELECT * FROM ${table}`);
        db.exec(`DROP TABLE IF EXISTS ${table}`);
        const createSql = SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([^)]+\\)`, "i"))?.[0];
        if (createSql) {
          db.exec(createSql);
          db.exec(`INSERT INTO ${table} SELECT * FROM ${table}_new`);
        }
        db.exec(`DROP TABLE IF EXISTS ${table}_new`);
      }
    } catch (e: any) {
      logger.warn("database", `Migration check for ${table}: ${e.message}`);
    }
  }

  const credColumns = db.prepare(`PRAGMA table_info(credentials)`).all() as any[];
  const credColNames = credColumns.map((c: any) => c.name);
  if (!credColNames.includes("wallet_address")) {
    db.exec(`ALTER TABLE credentials ADD COLUMN wallet_address TEXT DEFAULT ''`);
    logger.info("database", "Added wallet_address column to credentials");
  }
  if (!credColNames.includes("budget_limit")) {
    db.exec(`ALTER TABLE credentials ADD COLUMN budget_limit TEXT DEFAULT '0'`);
    logger.info("database", "Added budget_limit column to credentials");
  }
  if (!credColNames.includes("credential_version")) {
    db.exec(`ALTER TABLE credentials ADD COLUMN credential_version INTEGER DEFAULT 1`);
    logger.info("database", "Added credential_version column to credentials");
  }
  if (!credColNames.includes("commitment")) {
    db.exec(`ALTER TABLE credentials ADD COLUMN commitment TEXT DEFAULT ''`);
    logger.info("database", "Added commitment column to credentials");
  }

  const orgColumns = db.prepare(`PRAGMA table_info(organizations)`).all() as any[];
  const orgColNames = orgColumns.map((c: any) => c.name);
  if (!orgColNames.includes("org_numeric_id")) {
    db.exec(`ALTER TABLE organizations ADD COLUMN org_numeric_id INTEGER DEFAULT 0`);
    logger.info("database", "Added org_numeric_id column to organizations");
  }

  // Ensure indexed_events table exists for existing databases
  const hasIndexed = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='indexed_events'`).get();
  if (!hasIndexed) {
    db.exec(`CREATE TABLE IF NOT EXISTS indexed_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_name TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      event_name TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      args TEXT DEFAULT '{}',
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ie_contract ON indexed_events(contract_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ie_event ON indexed_events(event_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ie_block ON indexed_events(block_number)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ie_tx ON indexed_events(tx_hash)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ie_tx_log ON indexed_events(tx_hash, log_index)`);
    logger.info("database", "Created indexed_events table");
  }

  const hasEvents = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='events'`).get();
  if (!hasEvents) {
    db.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      tx_hash TEXT,
      block_number INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`);
    logger.info("database", "Created events table");
  }
}

export function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function runQuery<T = any>(sql: string, ...params: any[]): T[] {
  const db = getDatabase();
  return db.prepare(sql).all(...params) as T[];
}

export function runSingle<T = any>(sql: string, ...params: any[]): T | undefined {
  const db = getDatabase();
  return db.prepare(sql).get(...params) as T | undefined;
}

export function runExecute(sql: string, ...params: any[]): Database.RunResult {
  const db = getDatabase();
  return db.prepare(sql).run(...params);
}

export function runTransaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDatabase();
  const tx = db.transaction(() => fn(db));
  return tx();
}
