import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, copyFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { randomBytes } from "crypto";
import { AGENTIX_HOME, loadConfig } from "../core/config";
import { getDatabase, runQuery, runExecute, runSingle } from "../core/database";
import { logger } from "../core/logger";

export interface BackupResult {
  success: boolean;
  backupId?: string;
  filename?: string;
  size?: number;
  checksum?: string;
  error?: string;
  details?: any;
}

/**
 * SHA-256 hex digest of a file's bytes.
 * Integrity stamp for the backup manifest, so a later restore can tell a
 * corrupted or tampered backup file from a good one.
 * @param filePath - Must exist and be readable; a missing file throws.
 * @returns 64-char lowercase hex digest.
 * @throws Throws (fs) if the file cannot be read; createBackup catches it.
 * Maps to: internal — createBackup.
 * Side effects: reads the whole file into memory; large files cost RAM.
 */
function checksumFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Snapshot the live DB, config and Merkle tree files into a new backup dir and record it.
 * Call before destructive work (restore, migration, tree rebuild) so there is a
 * point-in-time restore point; backups are cheap local copies, not archives.
 * @param description - Optional label stored in the manifest; defaults to "Manual backup".
 * @returns BackupResult with backupId, total size and manifest checksum; success:false + error on failure, never throws.
 * @throws Never throws: all failures are caught and returned as success:false.
 * Maps to: CLI 'agentix backup create' / MCP tool agentix_backup_create (dashboard-only).
 * Side effects: creates ~/.agentix/backups/<backupId>/, copies DB/config/trees, inserts a row in the backups table.
 * Security: the backup contains the full local DB (credential secrets included) — treat the backup dir as sensitive data.
 */
export async function createBackup(description?: string): Promise<BackupResult> {
  try {
    const backupId = `backup-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    mkdirSync(backupDir, { recursive: true });

    logger.info("backup", `Creating backup: ${backupId}`);

    const dbPath = loadConfig().database.path;
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, join(backupDir, "agentix.db"));
    }

    const configPath = join(AGENTIX_HOME, "config", "agentix.config.json");
    if (existsSync(configPath)) {
      copyFileSync(configPath, join(backupDir, "agentix.config.json"));
    }

    const treeDir = join(AGENTIX_HOME, "trees");
    if (existsSync(treeDir)) {
      const treeFiles = readdirSync(treeDir);
      for (const f of treeFiles) {
        copyFileSync(join(treeDir, f), join(backupDir, `tree-${f}`));
      }
    }

    const manifest = {
      backupId,
      description: description || "Manual backup",
      createdAt: Date.now(),
      files: readdirSync(backupDir),
    };
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    let totalSize = 0;
    for (const f of readdirSync(backupDir)) {
      totalSize += statSync(join(backupDir, f)).size;
    }

    const checksum = checksumFile(join(backupDir, "manifest.json"));

    runExecute(
      `INSERT INTO backups (backup_id, filename, size, checksum, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      backupId,
      `${backupId}.tar.gz`,
      totalSize,
      checksum,
      Math.floor(Date.now() / 1000),
      JSON.stringify({ description, fileCount: manifest.files.length })
    );

    logger.info("backup", `Backup created: ${backupId} (${totalSize} bytes)`);

    return {
      success: true,
      backupId,
      filename: `${backupId}/`,
      size: totalSize,
      checksum,
    };
  } catch (e: any) {
    logger.error("backup", `Failed to create backup: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Every recorded backup, newest first.
 * Use it to pick a restore or export target; it reads the backups table, not the disk,
 * so a backup dir deleted by hand still shows up until its row is removed.
 * @returns BackupResult[] (empty when none exist); a DB failure yields a single-element [{success:false, error}] array.
 * @throws Never throws: failures are returned, not raised.
 * Maps to: CLI 'agentix backup list'.
 * Side effects: read-only DB query.
 */
export async function listBackups(): Promise<BackupResult[]> {
  try {
    const rows = runQuery<any>(
      "SELECT * FROM backups ORDER BY created_at DESC"
    );

    return rows.map((r) => ({
      success: true,
      backupId: r.backup_id,
      filename: r.filename,
      size: r.size,
      checksum: r.checksum,
      details: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}

/**
 * Overwrite the live DB, config and Merkle tree files from a backup dir.
 * The recovery path after corruption or a bad migration — run doctor afterwards
 * to confirm the restored state is consistent.
 * @param backupId - Backup directory name under ~/.agentix/backups, e.g. backup-<ts>-<hex>.
 * @returns BackupResult with details.restored on success; success:false if the backup is missing or a copy fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix backup restore <id>'.
 * Side effects: DESTRUCTIVE — overwrites the live DB, config and tree files; not atomic, so a mid-restore disk failure can leave a half-restored state.
 * Security: restores exactly what the backup contained, including since-revoked credentials — verify the backup's provenance before restoring.
 */
export async function restoreBackup(backupId: string): Promise<BackupResult> {
  try {
    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    if (!existsSync(backupDir)) return { success: false, error: `Backup not found: ${backupId}` };

    logger.info("backup", `Restoring backup: ${backupId}`);

    const dbFile = join(backupDir, "agentix.db");
    if (existsSync(dbFile)) {
      const targetDb = loadConfig().database.path;
      const targetDir = join(targetDb, "..");
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      copyFileSync(dbFile, targetDb);
    }

    const configFile = join(backupDir, "agentix.config.json");
    if (existsSync(configFile)) {
      const targetConfig = join(AGENTIX_HOME, "config", "agentix.config.json");
      copyFileSync(configFile, targetConfig);
    }

    const treeDir = join(AGENTIX_HOME, "trees");
    if (!existsSync(treeDir)) mkdirSync(treeDir, { recursive: true });

    for (const f of readdirSync(backupDir)) {
      if (f.startsWith("tree-")) {
        copyFileSync(join(backupDir, f), join(treeDir, f.replace("tree-", "")));
      }
    }

    logger.info("backup", `Backup restored: ${backupId}`);

    return {
      success: true,
      backupId,
      details: { restored: true },
    };
  } catch (e: any) {
    logger.error("backup", `Failed to restore backup: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Copy a backup's manifest.json to an arbitrary path.
 * Only the manifest is copied — the DB, config and tree files stay in the backup
 * dir — so this alone does not migrate a backup to another machine.
 * @param backupId - Backup directory name under ~/.agentix/backups.
 * @param outputPath - Destination file; overwritten silently if it exists.
 * @returns BackupResult with details.outputPath; success:false if the backup or its manifest is missing.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix backup export <id> --file <path>'.
 * Side effects: writes outputPath (disk I/O).
 */
export async function exportBackup(backupId: string, outputPath: string): Promise<BackupResult> {
  try {
    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    if (!existsSync(backupDir)) return { success: false, error: `Backup not found: ${backupId}` };

    const data = readFileSync(join(backupDir, "manifest.json"));
    writeFileSync(outputPath, data);

    return {
      success: true,
      backupId,
      details: { outputPath },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Register an exported manifest file as a local backup.
 * Only the manifest is stored — the DB/config/tree files are NOT imported — so a
 * restoreBackup of an imported backup finds no agentix.db to copy.
 * @param inputPath - Path to a manifest JSON; its backupId is reused, or imported-<ts> when absent.
 * @returns BackupResult with the (possibly new) backupId; success:false if the file is missing or the JSON is invalid.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix backup import --file <path>'.
 * Side effects: creates ~/.agentix/backups/<backupId>/ and writes manifest.json.
 */
export async function importBackup(inputPath: string): Promise<BackupResult> {
  try {
    if (!existsSync(inputPath)) return { success: false, error: `File not found: ${inputPath}` };

    const data = JSON.parse(readFileSync(inputPath, "utf-8"));
    const backupId = data.backupId || `imported-${Date.now()}`;

    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    mkdirSync(backupDir, { recursive: true });

    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(data, null, 2));

    return {
      success: true,
      backupId,
      details: { imported: true },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
