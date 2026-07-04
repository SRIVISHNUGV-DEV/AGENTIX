import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { runQuery, runSingle, runExecute } from "../database";
import { generateId, checksum } from "../../shared/utils";
import type { Backup } from "../../shared/types";

export class BackupEngine {
  private backupDir: string;

  constructor(backupDir: string) {
    this.backupDir = backupDir;
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  }

  create(description?: string): Backup {
    const backupId = `backup_${generateId()}`;
    const filename = `${backupId}.json`;
    const filepath = join(this.backupDir, filename);

    const data = this.exportAll();
    const content = JSON.stringify(data, null, 2);
    const checksumVal = checksum(content);

    writeFileSync(filepath, content);

    runExecute(
      "INSERT INTO backups (backup_id, filename, size, checksum, metadata) VALUES (?, ?, ?, ?, ?)",
      backupId, filename, content.length, checksumVal,
      description ? JSON.stringify({ description }) : null
    );

    return {
      id: 0,
      backupId,
      filename,
      size: content.length,
      checksum: checksumVal,
      createdAt: Math.floor(Date.now() / 1000),
      metadata: description ? { description } : undefined,
    };
  }

  list(): Backup[] {
    return runQuery<Backup>("SELECT * FROM backups ORDER BY created_at DESC");
  }

  get(backupId: string): Backup | undefined {
    return runSingle<Backup>("SELECT * FROM backups WHERE backup_id = ?", backupId);
  }

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
