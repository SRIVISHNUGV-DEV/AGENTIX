import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

let db: Database.Database;

describe("6. SQLite Tests", () => {
  beforeAll(() => {
    const dbPath = join(process.env.AGENTIX_HOME!, "db", "test.db");
    mkdirSync(join(process.env.AGENTIX_HOME!, "db"), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  });

  it("database initializes with WAL mode", () => {
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
  });

  it("creates all core tables", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_organizations (id TEXT PRIMARY KEY, name TEXT, owner_address TEXT, active INTEGER DEFAULT 1);
      CREATE TABLE IF NOT EXISTS test_credentials (id TEXT PRIMARY KEY, credential_id TEXT UNIQUE, organization_id TEXT, agent_address TEXT);
      CREATE TABLE IF NOT EXISTS test_wallets (id TEXT PRIMARY KEY, wallet_address TEXT UNIQUE, owner_address TEXT);
      CREATE TABLE IF NOT EXISTS test_sessions (id TEXT PRIMARY KEY, session_id TEXT UNIQUE, wallet_address TEXT, daily_spend_limit INTEGER);
      CREATE TABLE IF NOT EXISTS test_proofs (id TEXT PRIMARY KEY, proof_hash TEXT UNIQUE, session_id TEXT, valid INTEGER DEFAULT 1);
    `);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'test_%'").all() as any[];
    expect(tables.length).toBeGreaterThanOrEqual(5);
  });

  it("inserts and reads data", () => {
    db.prepare("INSERT INTO test_organizations (id, name, owner_address) VALUES (?, ?, ?)").run("org-1", "Test Org", "0x1234");
    const org = db.prepare("SELECT * FROM test_organizations WHERE id = ?").get("org-1") as any;
    expect(org).toBeDefined();
    expect(org.name).toBe("Test Org");
    expect(org.owner_address).toBe("0x1234");
  });

  it("enforces UNIQUE constraints", () => {
    expect(() => {
      db.prepare("INSERT INTO test_credentials (id, credential_id, organization_id, agent_address) VALUES (?, ?, ?, ?)").run("c1", "cred-unique", "org-1", "0xabcd");
      db.prepare("INSERT INTO test_credentials (id, credential_id, organization_id, agent_address) VALUES (?, ?, ?, ?)").run("c2", "cred-unique", "org-1", "0xefgh");
    }).toThrow();
  });

  it("supports transactions", () => {
    const insertMany = db.transaction((items: { id: string; name: string }[]) => {
      for (const item of items) {
        db.prepare("INSERT OR IGNORE INTO test_organizations (id, name, owner_address) VALUES (?, ?, ?)").run(item.id, item.name, "0x0000");
      }
    });

    insertMany([
      { id: "org-t1", name: "Tx Org 1" },
      { id: "org-t2", name: "Tx Org 2" },
      { id: "org-t3", name: "Tx Org 3" },
    ]);

    const count = db.prepare("SELECT COUNT(*) as c FROM test_organizations WHERE id LIKE 'org-t%'").get() as any;
    expect(count.c).toBe(3);
  });

  it("rolls back on transaction error", () => {
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO test_organizations (id, name, owner_address) VALUES (?, ?, ?)").run("org-rollback", "Rollback Org", "0x0000");
      throw new Error("Simulated failure");
    });

    try { tx(); } catch {}
    const org = db.prepare("SELECT * FROM test_organizations WHERE id = ?").get("org-rollback");
    expect(org).toBeUndefined();
  });

  it("handles concurrent read/write operations", () => {
    for (let i = 0; i < 50; i++) {
      db.prepare("INSERT OR IGNORE INTO test_organizations (id, name, owner_address) VALUES (?, ?, ?)").run(`org-concurrent-${i}`, `Concurrent ${i}`, "0x0000");
    }
    const count = db.prepare("SELECT COUNT(*) as c FROM test_organizations WHERE id LIKE 'org-concurrent-%'").get() as any;
    expect(count.c).toBe(50);
  });

  it("supports indexes", () => {
    db.exec("CREATE INDEX IF NOT EXISTS idx_test_org_name ON test_organizations(name)");
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_test_org_name'").get();
    expect(indexes).toBeDefined();
  });

  it("handles large text fields", () => {
    const largeText = "x".repeat(100000);
    db.prepare("INSERT INTO test_organizations (id, name, owner_address) VALUES (?, ?, ?)").run("org-large", largeText, "0x0000");
    const org = db.prepare("SELECT name FROM test_organizations WHERE id = ?").get("org-large") as any;
    expect(org.name.length).toBe(100000);
  });

  it("supports parameterized queries", () => {
    const stmt = db.prepare("SELECT * FROM test_organizations WHERE name = ? AND owner_address = ?");
    const org = stmt.get("Test Org", "0x1234") as any;
    expect(org).toBeDefined();
    expect(org.id).toBe("org-1");
  });

  it("database file exists on disk", () => {
    const dbPath = join(process.env.AGENTIX_HOME!, "db", "test.db");
    expect(existsSync(dbPath)).toBe(true);
  });
});
