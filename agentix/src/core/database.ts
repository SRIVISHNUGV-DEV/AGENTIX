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
  harness_id TEXT UNIQUE,
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

-- Per-session agent keypairs. The public address is registered on-chain as the
-- session's sessionKey; the private key is encrypted at rest (AES-256-GCM) so the
-- agent can sign UserOps autonomously without ever holding the owner key.
CREATE TABLE IF NOT EXISTS session_keys (
  session_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
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
  expires_at INTEGER NOT NULL DEFAULT 0,
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
  event_name TEXT,
  contract_name TEXT,
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

CREATE TABLE IF NOT EXISTS runtimes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  model_name TEXT DEFAULT '',
  api_key_hash TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  last_health_check INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_runtimes_org ON runtimes(organization_id);

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
    risk_json TEXT DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS owner_policies (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  daily_limit TEXT NOT NULL DEFAULT '0.1',
  per_tx_limit TEXT NOT NULL DEFAULT '0.05',
  allowed_targets TEXT NOT NULL DEFAULT '[]',
  allowed_actions TEXT NOT NULL DEFAULT '["erc20.transfer","erc20.approve","wallet.execute"]',
  forbidden_actions TEXT NOT NULL DEFAULT '[]',
  session_expiry INTEGER NOT NULL DEFAULT 86400,
  auto_create_sessions INTEGER NOT NULL DEFAULT 1,
  signed_by TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bundler_queue (
  id TEXT PRIMARY KEY,
  user_op_hash TEXT NOT NULL,
  signed_user_op TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bundler_status ON bundler_queue(status);
CREATE INDEX IF NOT EXISTS idx_bundler_wallet ON bundler_queue(wallet_address);
CREATE TABLE IF NOT EXISTS identities (
  identity_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  credential_id TEXT DEFAULT '0',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identities_wallet ON identities(wallet_address);

CREATE TABLE IF NOT EXISTS x402_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  amount TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  tx_hash TEXT DEFAULT '',
  user_op_hash TEXT DEFAULT '',
  scheme TEXT DEFAULT 'exact',
  network TEXT DEFAULT '',
  wallet_address TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_x402_payments_domain ON x402_payments(domain);
CREATE INDEX IF NOT EXISTS idx_x402_payments_created ON x402_payments(created_at);
CREATE INDEX IF NOT EXISTS idx_x402_payments_wallet ON x402_payments(wallet_address);

CREATE TABLE IF NOT EXISTS x402_incoming_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payer TEXT NOT NULL,
  amount TEXT NOT NULL,
  resource TEXT NOT NULL,
  tx_hash TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_x402_incoming_payer ON x402_incoming_payments(payer);
CREATE INDEX IF NOT EXISTS idx_x402_incoming_created ON x402_incoming_payments(created_at);

CREATE TABLE IF NOT EXISTS x402_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  amount TEXT NOT NULL,
  nonce TEXT UNIQUE NOT NULL,
  expiry INTEGER NOT NULL,
  resource TEXT NOT NULL,
  session_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  settlement_tx TEXT DEFAULT '',
  settled_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_x402_vouchers_status ON x402_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_x402_vouchers_wallet ON x402_vouchers(wallet);
CREATE INDEX IF NOT EXISTS idx_x402_vouchers_nonce ON x402_vouchers(nonce);

CREATE TABLE IF NOT EXISTS x402_used_nonces (
  nonce TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

let _db: Database.Database | null = null;

/**
 * Return the shared SQLite connection, opening and migrating it on first use.
 * WAL mode, foreign keys OFF, and the full schema are applied here; the connection is a process-wide singleton.
 * @returns The better-sqlite3 Database handle (same object on every call).
 * @throws Throws when the DB file cannot be opened or the schema/migration fails.
 * Maps to: internal — runQuery / runSingle / runExecute / runTransaction (every DB access).
 * Side effects: creates the DB directory/file, runs schema + migrateOldSchema, sets schema_version metadata.
 */
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

/**
 * Bring a pre-existing database up to the current schema (additive column/table migrations).
 * Idempotent and best-effort per step: a failed step logs a warning and the rest still run, so an old DB is never left half-migrated by one bad ALTER.
 * @param db — the open database to migrate; tables are rebuilt (not ALTERed) only when their SQL still contains a FOREIGN KEY.
 * @returns Nothing.
 * @throws Never throws — every step is wrapped in try/catch; failures are logged as warnings.
 * Maps to: internal — getDatabase (runs once per process start, after the schema exec).
 * Side effects: ALTER TABLE / CREATE TABLE / data copies on the live database file.
 */
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
        // NB: [^)]+ cannot match these CREATEs — every one contains
        // DEFAULT (unixepoch()), whose inner ')' truncates the match and leaves
        // an unexecutable statement (table already dropped above). Match through
        // the closing paren on its own line instead.
        const createSql = SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]*?\\n\\)`, "i"))?.[0];
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
  if (!credColNames.includes("leaf_index")) {
    // Dense, collision-free active-tree position (per organization). Replaces the
    // old commitment%2^depth placement which silently overwrote colliding leaves.
    // -1 = unassigned (back-filled on first tree load for legacy rows).
    db.exec(`ALTER TABLE credentials ADD COLUMN leaf_index INTEGER DEFAULT -1`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_leaf ON credentials(organization_id, leaf_index)`);
    logger.info("database", "Added leaf_index column to credentials");
  }

  const orgColumns = db.prepare(`PRAGMA table_info(organizations)`).all() as any[];
  const orgColNames = orgColumns.map((c: any) => c.name);
  if (!orgColNames.includes("org_numeric_id")) {
    db.exec(`ALTER TABLE organizations ADD COLUMN org_numeric_id INTEGER DEFAULT 0`);
    logger.info("database", "Added org_numeric_id column to organizations");
  }

  const walletColumns = db.prepare(`PRAGMA table_info(wallets)`).all() as any[];
  const walletColNames = walletColumns.map((c: any) => c.name);
  if (!walletColNames.includes("harness_id")) {
    db.exec(`ALTER TABLE wallets ADD COLUMN harness_id TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_harness ON wallets(harness_id) WHERE harness_id IS NOT NULL`);
    logger.info("database", "Added harness_id column to wallets");
  }

  try {
    const reqColumns = db.prepare(`PRAGMA table_info(organization_requests)`).all() as any[];
    const reqColNames = reqColumns.map((c: any) => c.name);
    if (!reqColNames.includes("expires_at")) {
      db.exec(`ALTER TABLE organization_requests ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0`);
      logger.info("database", "Added expires_at column to organization_requests");
    }
  } catch (e: any) {
    logger.warn("database", `Migration check for organization_requests.expires_at: ${e.message}`);
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

  // Migrate transactions table: add event_name and contract_name if missing
  try {
    const txColumns = db.prepare(`PRAGMA table_info(transactions)`).all() as any[];
    const txColNames = txColumns.map((c: any) => c.name);
    if (!txColNames.includes("event_name")) {
      db.exec(`ALTER TABLE transactions ADD COLUMN event_name TEXT`);
      logger.info("database", "Added event_name column to transactions");
    }
    if (!txColNames.includes("contract_name")) {
      db.exec(`ALTER TABLE transactions ADD COLUMN contract_name TEXT`);
      logger.info("database", "Added contract_name column to transactions");
    }
  } catch (e: any) {
    logger.warn("database", `Migration check for transactions: ${e.message}`);
  }

  // Migrate execution_plans: add risk_json (full multi-dimensional risk assessment)
  try {
    const planCols = db.prepare(`PRAGMA table_info(execution_plans)`).all() as any[];
    const planColNames = planCols.map((c: any) => c.name);
    if (planColNames.length > 0 && !planColNames.includes("risk_json")) {
      db.exec(`ALTER TABLE execution_plans ADD COLUMN risk_json TEXT DEFAULT '{}'`);
      logger.info("database", "Added risk_json column to execution_plans");
    }
  } catch (e: any) {
    logger.warn("database", `Migration check for execution_plans: ${e.message}`);
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

  // Migrate x402_payments: add new columns if they don't exist
  try {
    const hasX402 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='x402_payments'`).get();
    if (hasX402) {
      const x402Cols = db.prepare(`PRAGMA table_info(x402_payments)`).all() as any[];
      const x402ColNames = x402Cols.map((c: any) => c.name);
      if (!x402ColNames.includes("user_op_hash")) {
        db.exec(`ALTER TABLE x402_payments ADD COLUMN user_op_hash TEXT DEFAULT ''`);
        logger.info("database", "Added user_op_hash column to x402_payments");
      }
      if (!x402ColNames.includes("wallet_address")) {
        db.exec(`ALTER TABLE x402_payments ADD COLUMN wallet_address TEXT DEFAULT ''`);
        logger.info("database", "Added wallet_address column to x402_payments");
      }
    }
  } catch (e: any) {
    logger.warn("database", `Migration check for x402_payments: ${e.message}`);
  }
}

/**
 * Close the shared SQLite connection and drop the cached handle.
 * The next getDatabase call reopens the file; call at graceful shutdown so WAL data is checkpointed.
 * @returns Nothing; a no-op when no connection is open.
 * @throws Never throws (better-sqlite3 close on an open handle).
 * Maps to: internal — shutdown / tests (counterpart of getDatabase).
 * Side effects: closes the DB file handle.
 */
export function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Run a SELECT and return all matching rows.
 * The read primitive for the whole runtime: every list/query path goes through here (and the camelCase variants).
 * @param sql — the statement; `params` — positional bind values (always bind, never interpolate).
 * @returns The rows as T[]; [] when nothing matches.
 * @throws Throws on SQL errors (bad table/column, bad binding) — callers must not assume an empty result means "no rows".
 * Maps to: internal — src/tools, src/mcp/server, src/runtime/server (all read paths).
 * Security: params are bound, not interpolated — but the `sql` string itself is caller-controlled, so never build it from user input.
 */
export function runQuery<T = any>(sql: string, ...params: any[]): T[] {
  const db = getDatabase();
  return db.prepare(sql).all(...params) as T[];
}

/**
 * Run a SELECT and return the first row, if any.
 * The single-row read primitive: lookups by id/address and aggregate queries (COUNT/SUM) use this.
 * @param sql — the statement; `params` — positional bind values.
 * @returns The first row as T, or undefined when nothing matches.
 * @throws Throws on SQL errors.
 * Maps to: internal — src/tools, src/mcp/server, src/runtime/server (single-row lookups).
 * Security: params are bound, not interpolated — but the `sql` string itself is caller-controlled, so never build it from user input.
 */
export function runSingle<T = any>(sql: string, ...params: any[]): T | undefined {
  const db = getDatabase();
  return db.prepare(sql).get(...params) as T | undefined;
}

/**
 * Run a write statement (INSERT/UPDATE/DELETE) and return its result.
 * The write primitive for the whole runtime; for multi-statement atomicity use runTransaction instead.
 * @param sql — the statement; `params` — positional bind values.
 * @returns The RunResult { changes, lastInsertRowid }.
 * @throws Throws on SQL errors (constraint violations, bad table/column).
 * Maps to: internal — src/tools, src/mcp/server, src/runtime/server (all write paths).
 * Side effects: mutates the database file (not atomic across calls — see runTransaction).
 * Security: params are bound, not interpolated — but the `sql` string itself is caller-controlled, so never build it from user input.
 */
export function runExecute(sql: string, ...params: any[]): Database.RunResult {
  const db = getDatabase();
  return db.prepare(sql).run(...params);
}

/**
 * Run a callback inside a single SQLite transaction (all-or-nothing).
 * Use whenever two or more writes must land together; a throw inside fn rolls everything back.
 * @param fn — the work, receiving the raw Database handle for direct prepare/run calls.
 * @returns Whatever fn returns.
 * @throws Re-throws fn's error after rolling back; also throws on transaction setup failure.
 * Maps to: internal — multi-write flows that need atomicity (see runExecute for single writes).
 * Side effects: the writes fn performs, committed or rolled back as one unit.
 */
export function runTransaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDatabase();
  const tx = db.transaction(() => fn(db));
  return tx();
}

/**
 * Convert one snake_case identifier to camelCase (first segment unchanged, later segments capitalised).
 * The key-mapping step that lets the DB speak snake_case while the code speaks camelCase.
 * @param str — a snake_case name; strings without underscores come back unchanged.
 * @returns The camelCase name.
 * @throws Never throws.
 * Maps to: internal — convertKeys (row-key conversion).
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Return a shallow copy of a row with every key converted from snake_case to camelCase.
 * Values are passed through untouched — only top-level keys are renamed.
 * @param obj — a raw DB row; an empty object returns an empty object.
 * @returns The converted row (the input is not mutated).
 * @throws Never throws.
 * Maps to: internal — runQueryCamel / runSingleCamel (camelCase read variants).
 */
function convertKeys(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value;
  }
  return result;
}

/**
 * Run a SELECT and return all rows with camelCase keys.
 * The read primitive for modules that model rows as camelCase interfaces (owner-policy, bundler-service).
 * @param sql — the statement; `params` — positional bind values.
 * @returns The rows as T[] with converted keys; [] when nothing matches.
 * @throws Throws on SQL errors.
 * Maps to: internal — owner-policy getOwnerPolicy / checkPolicy and bundler-service reads.
 */
export function runQueryCamel<T = any>(sql: string, ...params: any[]): T[] {
  const rows = runQuery<Record<string, any>>(sql, ...params);
  return rows.map(convertKeys) as T[];
}

/**
 * Run a SELECT and return the first row with camelCase keys, if any.
 * The single-row camelCase read primitive; see runSingle for the snake_case form.
 * @param sql — the statement; `params` — positional bind values.
 * @returns The first row as T, or undefined when nothing matches.
 * @throws Throws on SQL errors.
 * Maps to: internal — owner-policy getOwnerPolicy / checkPolicy (single-row lookups).
 */
export function runSingleCamel<T = any>(sql: string, ...params: any[]): T | undefined {
  const row = runSingle<Record<string, any>>(sql, ...params);
  return row ? (convertKeys(row) as T) : undefined;
}
