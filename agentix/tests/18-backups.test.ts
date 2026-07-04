import { describe, it, expect, beforeAll } from "vitest";
import { join } from "path";

describe("18. Backup Tests", () => {
  let BackupEngine: any;
  let backupPath: string;

  beforeAll(async () => {
    backupPath = join(process.env.AGENTIX_HOME!, "backups");
    const mod = await import("../packages/core/backup-engine");
    BackupEngine = mod.BackupEngine;
  });

  it("creates a backup", () => {
    const engine = new BackupEngine(backupPath);
    const backup = engine.create("Release validation backup");
    expect(backup).toBeDefined();
    expect(backup.backupId || backup.backup_id).toBeDefined();
    expect(backup.size).toBeGreaterThan(0);
  });

  it("lists backups", () => {
    const engine = new BackupEngine(backupPath);
    const backups = engine.list();
    expect(Array.isArray(backups)).toBe(true);
    expect(backups.length).toBeGreaterThan(0);
  });

  it("backup has checksum", () => {
    const engine = new BackupEngine(backupPath);
    const backups = engine.list();
    expect(backups[0]).toHaveProperty("checksum");
    expect(typeof backups[0].checksum).toBe("string");
    expect(backups[0].checksum.length).toBeGreaterThan(0);
  });

  it("backup has size", () => {
    const engine = new BackupEngine(backupPath);
    const backups = engine.list();
    expect(backups[0].size).toBeGreaterThan(0);
  });

  it("backup has timestamp", () => {
    const engine = new BackupEngine(backupPath);
    const backups = engine.list();
    const ts = backups[0].createdAt || backups[0].created_at;
    expect(ts).toBeDefined();
    expect(typeof ts).toBe("number");
  });
});
