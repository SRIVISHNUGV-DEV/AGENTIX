import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { runQuery, runSingle, runExecute } from "../database";
import { generateId, checksum } from "../../shared/utils";
import type { Backup } from "../../shared/types";

export class BackupEngine {
  private backupDir: string;

  /**
   * Creates a backup engine rooted at a directory, creating the directory if needed.
   * Why: all backup files live in one place so list/get/restore can find them by filename alone.
   * @param backupDir Directory for `<backupId>.json` files; created recursively when missing.
   * @returns A BackupEngine bound to that directory.
   * @throws Throws when the directory cannot be created (e.g. permission denied) — the engine is unusable without it.
   * Maps to: internal — BackupEngine.create (the directory every backup lands in).
   * Side effects: creates the directory on disk when it does not exist.
   */
  constructor(backupDir: string) {
    this.backupDir = backupDir;
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  }

  /**
   * Snapshots every table to a new JSON file and records it in the backups table.
   * Why: the only way to get a restorable full-state snapshot; the checksum lets restore detect tampering or corruption later.
   * @param description Optional human note, stored as JSON metadata on the backup row.
   * @returns The Backup record for the new snapshot, including its real DB row id, filename, byte size (string length) and SHA-256 checksum.
   * @throws Throws on disk write failure or DB insert failure — no backup row is left behind in a half-written state by the caller, but a file may exist without a row if the insert fails after the write.
   * Maps to: MCP tool agentix_backup_create.
   * Side effects: writes `<backupId>.json` to the backup dir and inserts a row into `backups`; reads every table via exportAll.
   */
  create(description?: string): Backup {
    const backupId = `backup_${generateId()}`;
    const filename = `${backupId}.json`;
    const filepath = join(this.backupDir, filename);

    const data = this.exportAll();
    const content = JSON.stringify(data, null, 2);
    const checksumVal = checksum(content);

    writeFileSync(filepath, content);

    const result = runExecute(
      "INSERT INTO backups (backup_id, filename, size, checksum, metadata) VALUES (?, ?, ?, ?, ?)",
      backupId, filename, content.length, checksumVal,
      description ? JSON.stringify({ description }) : null
    );

    return {
      id: Number(result.lastInsertRowid),
      backupId,
      filename,
      size: content.length,
      checksum: checksumVal,
      createdAt: Math.floor(Date.now() / 1000),
      metadata: description ? { description } : undefined,
    };
  }

  /**
   * Returns every recorded backup, newest first.
   * Why: operators need the inventory before choosing one to restore or export.
   * @returns All rows from `backups` ordered by created_at DESC; empty array when none exist.
   * @throws Throws on DB failure.
   * Maps to: MCP tool agentix_backup_list.
   */
  list(): Backup[] {
    return runQuery<Backup>("SELECT * FROM backups ORDER BY created_at DESC");
  }

  /**
   * Returns one backup's record by its backup id.
   * Why: restore/export first resolve the id to a filename and checksum — never trust a caller-supplied filename directly.
   * @param backupId The `backup_<id>` string from create/list.
   * @returns The Backup row, or undefined when no such id is recorded.
   * @throws Throws on DB failure.
   * Maps to: internal — BackupEngine.restore / exportToFile (both resolve the id through here first).
   */
  get(backupId: string): Backup | undefined {
    return runSingle<Backup>("SELECT * FROM backups WHERE backup_id = ?", backupId);
  }

  /**
   * Replaces current DB state with a backup's contents after verifying its checksum.
   * Why: the recovery path after corruption or a bad migration — the checksum gate is what stops a tampered or truncated file from silently overwriting live state.
   * @param backupId The `backup_<id>` string to restore.
   * @returns `{ success: true }` on a full import, or `{ success: false, error }` when the id is unknown, the file is missing, the checksum mismatches, or the JSON/import fails.
   * @throws Nothing — all failures are returned as `{ success: false, error }`.
   * Maps to: internal — BackupEngine.importFromFile (the other import path into live state).
   * Side effects: overwrites rows in all ten tables via importAll (INSERT OR REPLACE) — destructive and not transactional, so a mid-import failure can leave a partially restored DB.
   * Security note: the file's checksum is verified against the recorded one before import, but importAll builds SQL from the file's own keys — only restore files this engine created.
   */
  restore(backupId: string): { success: boolean; error?: string } {
    const backup = this.get(backupId);
    if (!backup) return { success: false, error: `Backup ${backupId} not found` };

    const filepath = join(this.backupDir, backup.filename);
    if (!existsSync(filepath)) return { success: false, error: `Backup file not found: ${backup.filename}` };

    try {
      const content = readFileSync(filepath, "utf-8");
      const currentChecksum = checksum(content);
      if (currentChecksum !== backup.checksum) {
        return { success: false, error: "Checksum mismatch — backup may be corrupted" };
      }

      const data = JSON.parse(content);
      this.importAll(data);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Copies a recorded backup's file to an arbitrary destination path.
   * Why: lets an operator move a snapshot off the backup dir (e.g. to external storage) without re-exporting the DB.
   * @param backupId The `backup_<id>` string to copy.
   * @param filepath Destination path; parent directories must already exist — they are not created.
   * @returns `{ success: true }` on copy, or `{ success: false, error }` when the id is unknown, the source file is missing, or the write fails.
   * @throws Nothing — failures are returned, not thrown.
   * Maps to: internal — BackupEngine.create (the file it copies was written there).
   * Side effects: writes a file at `filepath`, overwriting any existing file there.
   */
  exportToFile(backupId: string, filepath: string): { success: boolean; error?: string } {
    const backup = this.get(backupId);
    if (!backup) return { success: false, error: `Backup ${backupId} not found` };

    const src = join(this.backupDir, backup.filename);
    if (!existsSync(src)) return { success: false, error: "Backup file not found" };

    try {
      const content = readFileSync(src, "utf-8");
      writeFileSync(filepath, content);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Imports an external backup JSON file: stores a copy, records it, and applies it to the live DB.
   * Why: the counterpart to exportToFile — a snapshot taken elsewhere can be brought back into this instance.
   * @param filepath Path of the backup JSON to import; must exist and parse as a backup document.
   * @returns `{ success: true, backupId }` with the newly recorded id, or `{ success: false, error }` when the file is missing, unparsable, or the import fails.
   * @throws Nothing — failures are returned, not thrown.
   * Maps to: internal — BackupEngine.restore (the other path that applies a snapshot to live state).
   * Side effects: writes a copy into the backup dir, inserts a `backups` row (metadata notes the source path), and overwrites live rows via importAll — destructive and not transactional.
   * Security note: unlike restore, there is no recorded checksum to verify against, so the file is trusted as-is — only import files from a trusted source, as a crafted file's keys flow into SQL via importAll.
   */
  importFromFile(filepath: string): { success: boolean; backupId?: string; error?: string } {
    if (!existsSync(filepath)) return { success: false, error: "File not found" };

    try {
      const content = readFileSync(filepath, "utf-8");
      const data = JSON.parse(content);

      const backupId = `backup_${generateId()}`;
      const filename = `${backupId}.json`;
      const dest = join(this.backupDir, filename);
      const checksumVal = checksum(content);

      writeFileSync(dest, content);
      runExecute(
        "INSERT INTO backups (backup_id, filename, size, checksum, metadata) VALUES (?, ?, ?, ?, ?)",
        backupId, filename, content.length, checksumVal,
        JSON.stringify({ importedFrom: filepath })
      );

      this.importAll(data);
      return { success: true, backupId };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Dumps all ten state tables into one versioned snapshot document.
   * Why: create() needs a single self-describing payload (version + timestamp + every table) so restore can rebuild state without knowing the schema version at dump time.
   * @returns `{ version: "2.0.0", timestamp, organizations, credentials, wallets, sessions, proofs, capabilities, delegations, agent_actions, config, metadata }`, each table as a full row array.
   * @throws Throws on DB failure.
   * Maps to: internal — BackupEngine.create (the only caller).
   * Side effects: reads the whole DB into memory — size is unbounded by table growth, so very large states are held entirely in RAM.
   * Security note: the dump includes credential secrets verbatim — the resulting file must be treated as sensitive material, not a plain log.
   */
  private exportAll(): Record<string, any> {
    return {
      version: "2.0.0",
      timestamp: Date.now(),
      organizations: runQuery("SELECT * FROM organizations"),
      credentials: runQuery("SELECT * FROM credentials"),
      wallets: runQuery("SELECT * FROM wallets"),
      sessions: runQuery("SELECT * FROM sessions"),
      proofs: runQuery("SELECT * FROM proofs"),
      capabilities: runQuery("SELECT * FROM capabilities"),
      delegations: runQuery("SELECT * FROM delegations"),
      agent_actions: runQuery("SELECT * FROM agent_actions"),
      config: runQuery("SELECT * FROM config"),
      metadata: runQuery("SELECT * FROM metadata"),
    };
  }

  /**
   * Applies a snapshot document to the live DB, table by table, row by row.
   * Why: the shared import half of restore/importFromFile — one implementation so both paths rebuild state identically.
   * @param data Snapshot document as produced by exportAll; tables absent from it are skipped, rows are upserted.
   * @returns Nothing.
   * @throws Throws on DB failure part-way through — earlier tables stay applied, so callers must treat a failure as a partial restore.
   * Maps to: internal — BackupEngine.restore / importFromFile (the callers that apply snapshots).
   * Side effects: INSERT OR REPLACE into each listed table; not wrapped in a transaction.
   * Security note: column names come from the document's own keys and are interpolated into SQL, not bound — only feed it documents this engine produced or that were checksum-verified.
   */
  private importAll(data: Record<string, any>): void {
    const tables = [
      "organizations", "credentials", "wallets", "sessions",
      "proofs", "capabilities", "delegations", "agent_actions",
      "config", "metadata",
    ];

    for (const table of tables) {
      if (!data[table]) continue;
      for (const row of data[table]) {
        const keys = Object.keys(row);
        const placeholders = keys.map(() => "?").join(", ");
        const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
        runExecute(sql, ...Object.values(row));
      }
    }
  }
}
