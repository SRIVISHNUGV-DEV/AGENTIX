export const COMPILER_SCHEMA = `
CREATE TABLE IF NOT EXISTS compilation_cache (
    content_hash TEXT PRIMARY KEY,
    intent_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ttl INTEGER NOT NULL DEFAULT 300
);

CREATE TABLE IF NOT EXISTS execution_plans (
    plan_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    intent_json TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    risk_score INTEGER NOT NULL,
    risk_category TEXT NOT NULL,
    risk_json TEXT DEFAULT '{}',
    explanation_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    compiled_by TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS policy_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    policy_hash TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    compiled_by TEXT
);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    contract_name TEXT PRIMARY KEY,
    last_block INTEGER NOT NULL,
    processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    attempts INTEGER NOT NULL DEFAULT 0,
    backoff_ms INTEGER NOT NULL DEFAULT 1000,
    backoff_multiplier REAL NOT NULL DEFAULT 2.0,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    status TEXT NOT NULL DEFAULT 'pending',
    on_complete_event TEXT,
    on_failure_event TEXT,
    created_at INTEGER NOT NULL,
    last_attempt_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plans_status ON execution_plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_hash ON execution_plans(content_hash);
CREATE INDEX IF NOT EXISTS idx_plans_created ON execution_plans(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_created ON compilation_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_status ON scheduler_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_scheduled ON scheduler_jobs(scheduled_at);
`;
